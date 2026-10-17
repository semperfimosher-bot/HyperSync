"""Actual dump/restore and killed-worker rehearsal on owned local PostgreSQL only.

Run as a module. PostgreSQL clients run inside the explicitly identified CI
service container, so client/server versions match without host installation.
"""

import argparse
import asyncio
import hashlib
import json
import multiprocessing
import os
import re
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from urllib.parse import unquote, urlsplit
from uuid import uuid4

from backend.app.services.thread_work import run_blocking
from scripts.verification.postgres_database import (
    create_owned_database,
    drop_owned_database,
    owned_database_name,
    upgrade_database_to_head,
    validate_local_postgres_service,
)

SOURCE = "hs_rehearsal"
RESTORED = "hs_restore"


def postgres_command(service_url, run_id, prefix, container, *, restore):
    validate_local_postgres_service(service_url)
    name = owned_database_name(run_id, prefix)
    if not re.fullmatch(r"[a-f0-9]{12,64}", container):
        raise ValueError("An explicit disposable PostgreSQL service container ID is required")
    target = urlsplit(service_url)
    env = dict(os.environ, PGPASSWORD=unquote(target.password or ""))
    command = ["docker", "exec", "-i", "-e", "PGPASSWORD", container]
    command += (["pg_restore", "--exit-on-error", "--no-owner", "--no-acl"] if restore
                else ["pg_dump", "--format=custom", "--no-owner", "--no-acl"])
    # These addresses are inside the service container. Never pass a URL or a
    # password as an argument, and never restore with --clean/--create.
    command += ["--host=127.0.0.1", "--username=" + unquote(target.username or "postgres"),
                "--dbname=" + name]
    return command, env


def stop_process(process):
    if process.is_alive():
        process.terminate()
    process.join(timeout=2)
    if process.is_alive():
        process.kill()
        process.join(timeout=2)
    if process.is_alive():
        raise RuntimeError("Owned rehearsal child did not stop")


async def snapshot(database_url):
    from sqlalchemy import func, select, text
    from sqlalchemy.ext.asyncio import create_async_engine

    from backend.app.models import Base

    engine = create_async_engine(database_url, connect_args={"ssl": False})
    try:
        async with engine.connect() as connection:
            counts = {}
            for table in Base.metadata.sorted_tables:
                counts[table.name] = (await connection.execute(
                    select(func.count()).select_from(table))).scalar_one()
            revision = (await connection.execute(
                text("SELECT version_num FROM alembic_version"))).scalar_one()
            members = (await connection.execute(text(
                "SELECT playlist_id::text, track_id::text, position FROM playlist_tracks "
                "ORDER BY playlist_id, position, track_id"))).all()
            jobs = (await connection.execute(text(
                "SELECT id::text, track_id::text, kind, attempts FROM maintenance_jobs "
                "WHERE completed_at IS NULL ORDER BY id"))).all()
            return {"counts": counts, "revision": revision,
                    "ordered_memberships": [list(row) for row in members],
                    "pending_jobs": [list(row) for row in jobs]}
    finally:
        await engine.dispose()


async def verify_ownership(service_url, run_id, prefix):
    import asyncpg

    name = owned_database_name(run_id, prefix)
    connection = await asyncpg.connect(service_url, timeout=5, ssl=False)
    try:
        marker = await connection.fetchval(
            "SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname=$1",
            name,
        )
        if marker != f"hypersync:{prefix}:{run_id}":
            raise RuntimeError("Database ownership changed; rehearsal refused")
    finally:
        await connection.close(timeout=5)


async def seed(database_url, objects):
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from backend.app.models import AccountType, Track, User
    from backend.app.models.playlist import Playlist, PlaylistTrack
    from backend.app.services.maintenance_jobs import enqueue_track_maintenance

    engine = create_async_engine(database_url, connect_args={"ssl": False})
    try:
        factory = async_sessionmaker(engine, expire_on_commit=False)
        async with factory() as session:
            user = User(id=uuid4(), account_type=AccountType.REGISTERED,
                        username="rehearsal", username_normalized="rehearsal",
                        email="rehearsal@example.test", password_hash="fixture-unused")
            session.add(user)
            await session.flush()
            playlist = Playlist(id=uuid4(), owner_id=user.id, title="Rehearsal",
                                visibility="private")
            tracks = [Track(id=uuid4(), title=f"Fixture {index}", artist="Rehearsal Artist",
                            b2_object_key=f"audio/fixture-{index}.mp3", is_published=True)
                      for index in range(3)]
            session.add_all([playlist, *tracks])
            await session.flush()
            for index, track in enumerate(reversed(tracks)):
                session.add(PlaylistTrack(playlist_id=playlist.id, track_id=track.id,
                                          position=index))
                path = objects / track.b2_object_key
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes((f"disposable media {index}\n" * 128).encode())
            await enqueue_track_maintenance(session, tracks[0].id, kinds=("playlists",))
            await session.commit()
    finally:
        await engine.dispose()


def media_manifest(directory):
    return {str(path.relative_to(directory)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted(directory.rglob("*")) if path.is_file()}


async def _worker(database_url, sender, *, pause):
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from backend.app.config import Settings, get_settings

    Settings.model_config["env_file"] = None
    os.environ.update(ENVIRONMENT="test", DATABASE_URL=database_url,
                      JWT_SECRET="isolated-rehearsal-fixture-secret-at-least-32-characters")
    get_settings.cache_clear()
    from backend.app.database import close_database
    from backend.app.services import maintenance_jobs as jobs

    # Only this disposable child changes the lease constant. Production remains
    # 600 seconds; the report identifies the two-second rehearsal lease.
    jobs.LEASE_SECONDS = 2
    engine = create_async_engine(database_url, connect_args={"ssl": False})
    try:
        factory = async_sessionmaker(engine, expire_on_commit=False)
        deadline = time.monotonic() + 8
        claim = None
        while claim is None and time.monotonic() < deadline:
            claim = await jobs.claim_next_job(factory)
            if claim is None:
                await asyncio.sleep(0.05)
        if claim is None:
            raise RuntimeError("No expired job became reclaimable")
        if pause:
            sender.send(claim)
            await asyncio.Event().wait()
        else:
            # Expose the committed replacement token before completion so the
            # parent can prove fencing while this job is still incomplete.
            sender.send(claim)
            if not await run_blocking(sender.poll, 12) or sender.recv() != "continue":
                raise TimeoutError("Parent did not acknowledge active fencing")
            await jobs.execute_job(claim)
            if not await jobs.finish_job(factory, claim):
                raise RuntimeError("Restarted worker lost its claim")
            sender.send({"completed": True})
    finally:
        await engine.dispose()
        await close_database()


def worker_child(database_url, sender, pause):
    try:
        asyncio.run(asyncio.wait_for(_worker(database_url, sender, pause=pause), timeout=20))
    except Exception as error:
        # Do not emit a traceback containing configuration or database URLs.
        sender.send({"error": type(error).__name__})
        raise SystemExit(1) from None
    finally:
        sender.close()


async def verify_active_fencing(database_url, stale, replacement):
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from backend.app.models.maintenance import MaintenanceJob
    from backend.app.services.maintenance_jobs import finish_job

    engine = create_async_engine(database_url, connect_args={"ssl": False, "command_timeout": 5})
    try:
        factory = async_sessionmaker(engine, expire_on_commit=False)

        async def assert_active_replacement():
            async with factory() as session:
                current = await session.get(MaintenanceJob, replacement.id)
                if (current is None or current.completed_at is not None
                        or current.lock_token != replacement.lock_token):
                    raise AssertionError("Replacement ownership is not active and incomplete")

        await assert_active_replacement()
        if await finish_job(factory, stale):
            raise AssertionError("Stale worker acknowledged an active replacement claim")
        await assert_active_replacement()
    finally:
        await engine.dispose()


def child_claim(database_url, *, pause, stale=None):
    ctx = multiprocessing.get_context("spawn")
    receiver, sender = ctx.Pipe(duplex=True)
    process = ctx.Process(target=worker_child, args=(database_url, sender, pause))
    process.start()
    sender.close()
    deadline = time.monotonic() + 25
    try:
        if not receiver.poll(25):
            raise TimeoutError("Owned worker deadline exceeded")
        value = receiver.recv()
        if isinstance(value, dict):
            raise RuntimeError("Owned worker failed: " + value["error"])
        if pause:
            # Actual SIGKILL/TerminateProcess, bypassing handler/finally cleanup.
            process.kill()
        else:
            if stale is None:
                raise ValueError("A previous claim is required to verify restart fencing")
            asyncio.run(asyncio.wait_for(verify_active_fencing(database_url, stale, value),
                                        timeout=10))
            receiver.send("continue")
            if not receiver.poll(max(0, deadline - time.monotonic())):
                raise TimeoutError("Restarted worker completion deadline exceeded")
            if receiver.recv() != {"completed": True}:
                raise RuntimeError("Restarted worker did not complete after active fencing")
        process.join(timeout=2)
        if process.is_alive() or (not pause and process.exitcode != 0):
            raise RuntimeError("Owned worker failed to exit")
        return value
    finally:
        receiver.close()
        stop_process(process)


async def exercise(service_url, container, run_id, root, report):
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import create_async_engine

    source = await create_owned_database(service_url, run_id, SOURCE)
    restored = await create_owned_database(service_url, run_id, RESTORED)
    report["phase"] = "migrate_and_seed"
    await upgrade_database_to_head(source)
    objects = root / "objects"
    objects.mkdir()
    await seed(source, objects)
    expected = await snapshot(source)
    before_media = media_manifest(objects)
    dump = root / "fixture.dump"
    start = time.monotonic()
    report["phase"] = "backup"
    await verify_ownership(service_url, run_id, SOURCE)
    command, env = postgres_command(service_url, run_id, SOURCE, container, restore=False)
    with dump.open("wb") as output:
        await run_blocking(subprocess.run, command, env=env, stdin=subprocess.DEVNULL,
                           stdout=output, stderr=subprocess.DEVNULL, check=True, timeout=45)
    report["backup_seconds"] = round(time.monotonic() - start, 4)
    report["dump_bytes"] = dump.stat().st_size
    start = time.monotonic()
    report["phase"] = "restore"
    await verify_ownership(service_url, run_id, RESTORED)
    command, env = postgres_command(service_url, run_id, RESTORED, container, restore=True)
    with dump.open("rb") as backup:
        await run_blocking(subprocess.run, command, env=env, stdin=backup,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           check=True, timeout=45)
    restored_objects = root / "restored-objects"
    shutil.copytree(objects, restored_objects)
    actual = await snapshot(restored)
    if actual != expected or media_manifest(restored_objects) != before_media:
        raise AssertionError("Restored schema, memberships, jobs or media hashes differ")
    report.update(restore_seconds=round(time.monotonic() - start, 4),
                  restored=actual, media_hashes=before_media, restore_verified=True)
    start = time.monotonic()
    report["phase"] = "killed_worker_restart"
    first = await run_blocking(child_claim, restored, pause=True)
    after_kill = await snapshot(restored)
    if len(after_kill["pending_jobs"]) != 1 or after_kill["pending_jobs"][0][3] != 1:
        raise AssertionError("Killed worker did not leave its durable claim")
    second = await run_blocking(child_claim, restored, pause=False, stale=first)
    if first.id != second.id or first.lock_token == second.lock_token or second.attempts != 2:
        raise AssertionError("Restart did not reclaim the same job with new ownership")
    engine = create_async_engine(restored, connect_args={"ssl": False})
    try:
        async with engine.connect() as connection:
            completed = (await connection.execute(text(
                "SELECT count(*) FROM maintenance_jobs WHERE completed_at IS NOT NULL"
            ))).scalar_one()
            duplicate_groups = (await connection.execute(text(
                "SELECT count(*) FROM (SELECT playlist_id, track_id FROM playlist_tracks "
                "GROUP BY playlist_id, track_id HAVING count(*) > 1) duplicates"
            ))).scalar_one()
        if completed != 1 or duplicate_groups:
            raise AssertionError("Restart did not produce exactly one completed job")
    finally:
        await engine.dispose()
    report.update(worker_restart_verified=True, stale_acknowledgement_rejected=True,
                  fencing_checked_while_replacement_incomplete=True,
                  completed_jobs=completed, duplicate_memberships=duplicate_groups,
                  restart_seconds=round(time.monotonic() - start, 4), test_lease_seconds=2)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--postgres-container", required=True)
    parser.add_argument("--output", type=Path, default=Path("verification-results/operations.json"))
    args = parser.parse_args()
    from backend.app.config import Settings, get_settings

    Settings.model_config["env_file"] = None
    os.environ["ENVIRONMENT"] = "test"
    get_settings.cache_clear()
    service_url = os.environ.get("HYPERSYNC_TEST_POSTGRES_URL", "")
    run_id = uuid4().hex
    try:
        postgres_command(service_url, run_id, SOURCE, args.postgres_container, restore=False)
    except ValueError as error:
        parser.exit(2, str(error) + "\n")
    report = {"evidence": "disposable PostgreSQL dump/restore and actual killed worker; "
              "fixture media only, not live B2 or production capacity", "passed": False}
    report.update(exercise_budget_seconds=180, blocking_settlement_budget_seconds=45,
                  database_cleanup_budget_seconds=40)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    try:
        with tempfile.TemporaryDirectory(prefix="hs-rehearsal-") as temporary:
            root = Path(temporary)
            root.chmod(0o700)
            asyncio.run(asyncio.wait_for(exercise(service_url, args.postgres_container,
                                                run_id, root, report), timeout=180))
        report.update(passed=True, phase="completed")
    except Exception as error:
        report["error"] = type(error).__name__
    finally:
        cleanup_errors = []
        for prefix in (RESTORED, SOURCE):
            try:
                asyncio.run(asyncio.wait_for(drop_owned_database(service_url, run_id, prefix),
                                            timeout=20))
            except Exception as error:
                cleanup_errors.append(type(error).__name__)
        report["owned_database_cleanup_verified"] = not cleanup_errors
        if cleanup_errors:
            report.update(passed=False, cleanup_errors=cleanup_errors)
        args.output.write_text(json.dumps(report, indent=2) + "\n")
    print("Isolated operational rehearsal: " + ("passed" if report["passed"] else "failed"))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
