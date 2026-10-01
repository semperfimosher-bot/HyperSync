"""PostgreSQL checks run exclusively in a newly created owned local database."""

import asyncio
import re
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit
from uuid import uuid4

from .models import CheckResult

ROOT = Path(__file__).resolve().parents[2]


def validate_target(database_url: str, run_id: str) -> str:
    target = urlsplit(database_url)
    if (
        target.scheme not in {"postgres", "postgresql"}
        or target.hostname not in {"127.0.0.1", "::1", "localhost"}
        or target.query
        or target.fragment
        or not target.path.strip("/")
    ):
        raise ValueError("An explicit disposable local PostgreSQL service is required")
    if not re.fullmatch(r"[a-f0-9]{32}", run_id):
        raise ValueError("Invalid database ownership identifier")
    return "hs_verify_" + run_id


async def _exercise(database_url: str, run_id: str, log: Path) -> None:
    import asyncpg
    from alembic import command
    from alembic.config import Config
    from alembic.script import ScriptDirectory
    from fastapi import HTTPException
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from backend.app.api.dependencies import authenticate_access_token
    from backend.app.config import get_settings
    from backend.app.models import AccountType, User, UserProfile, UserSession
    from backend.app.models.jam import JamSession
    from backend.app.security.tokens import create_access_token
    from backend.app.services.jam_sessions import advance

    name = validate_target(database_url, run_id)
    admin = await asyncpg.connect(database_url, timeout=5, ssl=False)
    created = False
    engine = None
    try:
        await admin.execute(f'CREATE DATABASE "{name}"')
        created = True
        # Identifier and comment are restricted to generated hexadecimal names.
        await admin.execute(f"COMMENT ON DATABASE \"{name}\" IS '{run_id}'")
        parts = urlsplit(database_url)
        owned_url = urlunsplit(("postgresql+asyncpg", parts.netloc, "/" + name, "", ""))
        engine = create_async_engine(
            owned_url, pool_size=1, max_overflow=1, pool_timeout=2, connect_args={"ssl": False}
        )
        config = Config(str(ROOT / "alembic.ini"))
        script = ScriptDirectory.from_config(config)
        head = script.get_current_head()
        assert head is not None
        revision = script.get_revision(head)
        if revision is None or not isinstance(revision.down_revision, str):
            raise RuntimeError("Expected a single migration predecessor")

        async def migrate(target: str) -> None:
            async with engine.begin() as connection:

                def upgrade(sync_connection) -> None:
                    config.attributes["connection"] = sync_connection
                    command.upgrade(config, target)

                await connection.run_sync(upgrade)

        await migrate(revision.down_revision)
        user_id, auth_id = uuid4(), uuid4()
        # These account tables predate the current Jam migration.
        factory = async_sessionmaker(engine, expire_on_commit=False)
        async with factory() as session:
            session.add(
                User(
                    id=user_id,
                    account_type=AccountType.REGISTERED,
                    username="migration-survivor",
                    username_normalized="migration-survivor",
                    email="migration@example.com",
                    password_hash="test-only-unused",
                )
            )
            session.add(
                UserProfile(user_id=user_id, display_name="Before upgrade", bio="preserved")
            )
            session.add(
                UserSession(
                    id=auth_id,
                    user_id=user_id,
                    refresh_token_hash=uuid4().hex,
                    expires_at=datetime.now(UTC) + timedelta(hours=1),
                )
            )
            await session.commit()
        await migrate("head")
        async with factory() as session:
            saved_user = await session.get(User, user_id)
            assert saved_user is not None
            assert saved_user.username == "migration-survivor"
            assert (
                await session.execute(text("SELECT version_num FROM alembic_version"))
            ).scalar() == head
        with log.open("a") as output:
            output.write("Fresh database -> predecessor -> populated upgrade to head: passed\n")
            output.write("PostgreSQL " + str(await admin.fetchval("SHOW server_version")) + "\n")

        # Authentication must release its transaction, even while its request
        # session remains open; mutations on the attached user must persist.
        get_settings.cache_clear()
        token, _ = create_access_token(user_id=user_id, session_id=auth_id, role="user")
        async with factory() as session:
            user = await authenticate_access_token(session, token)
            assert not session.in_transaction()
            user.username = "after-authentication"
            await session.commit()
        async with factory() as session:
            saved_user = await session.get(User, user_id)
            assert saved_user is not None
            assert saved_user.username == "after-authentication"
            jam = JamSession(
                host_id=user_id,
                invite_hash=uuid4().hex,
                invite_expires_at=datetime.now(UTC) + timedelta(hours=1),
            )
            session.add(jam)
            await session.commit()
            jam_id = jam.id
        ready = asyncio.Event()
        count = 0

        async def writer() -> str:
            nonlocal count
            async with factory() as session:
                jam = await session.get(JamSession, jam_id)
                assert jam is not None
                revision_number = jam.revision
                count += 1
                if count == 2:
                    ready.set()
                await asyncio.wait_for(ready.wait(), timeout=5)
                try:
                    await advance(session, jam, revision_number)
                    await session.commit()
                    return "committed"
                except HTTPException as exc:
                    await session.rollback()
                    assert exc.status_code == 409
                    return "conflict"

        assert sorted(await asyncio.gather(writer(), writer())) == ["committed", "conflict"]
        with log.open("a") as output:
            output.write("Authentication transaction release and updates: passed\n")
            output.write("Concurrent Jam revision conflict: passed\n")
    finally:
        if engine is not None:
            await engine.dispose()
        try:
            if created:
                owner = await admin.fetchval(
                    "SELECT shobj_description(oid, 'pg_database') "
                    "FROM pg_database WHERE datname=$1",
                    name,
                )
                if owner != run_id:
                    raise RuntimeError("Database ownership changed; cleanup refused")
                await admin.execute(f'DROP DATABASE "{name}" WITH (FORCE)')
        finally:
            await admin.close()


async def cleanup_owned_database(database_url: str, run_id: str) -> None:
    import asyncpg

    name = validate_target(database_url, run_id)
    admin = await asyncpg.connect(database_url, ssl=False, timeout=5)
    try:
        row = await admin.fetchrow(
            "SELECT shobj_description(oid, 'pg_database') AS owner "
            "FROM pg_database WHERE datname=$1", name,
        )
        if row is None:
            return
        if row["owner"] != run_id:
            raise RuntimeError("Database ownership changed; cleanup refused")
        await admin.execute(f'DROP DATABASE "{name}" WITH (FORCE)', timeout=10)
    finally:
        await admin.close(timeout=5)


def verify_postgres(database_url: str, run_id: str, report_dir: Path) -> list[CheckResult]:
    import sys
    import tempfile

    from .environment import child_environment, create_environment
    from .processes import run_check

    try:
        validate_target(database_url, run_id)
    except ValueError as exc:
        return [CheckResult("postgres", "blocked", 0, None, None, str(exc))]
    with tempfile.TemporaryDirectory(prefix="hypersync-postgres-") as temporary:
        environment = create_environment(Path(temporary) / "runtime")
        env = child_environment(environment)
        env["HYPERSYNC_TEST_POSTGRES_URL"] = database_url
        env["HYPERSYNC_VERIFICATION_RUN_ID"] = run_id
        env["HYPERSYNC_REPORT_DIR"] = str(report_dir.resolve())
        probe = run_check(
            [sys.executable, "-m", "scripts.verification.postgres", "--probe"],
            cwd=ROOT, env=env, timeout_seconds=15,
            log_path=report_dir / "postgres-prerequisite.log",
            secrets=(database_url, urlsplit(database_url).password or ""),
        )
        if probe.status != "passed":
            probe.status = "blocked" if probe.status != "interrupted" else "interrupted"
            probe.detail = "Disposable PostgreSQL service is unavailable or inaccessible"
            return [probe]
        results = []
        try:
            results.append(run_check(
                [sys.executable, "-m", "scripts.verification.postgres"],
                cwd=ROOT, env=env, timeout_seconds=210,
                log_path=report_dir / "postgres.log",
                secrets=(database_url, urlsplit(database_url).password or ""),
            ))
        finally:
            results.append(run_check(
                [sys.executable, "-m", "scripts.verification.postgres", "--cleanup"],
                cwd=ROOT, env=env, timeout_seconds=30,
                log_path=report_dir / "postgres-cleanup.log",
                secrets=(database_url, urlsplit(database_url).password or ""),
            ))
        return results



if __name__ == "__main__":
    import os
    import sys

    from backend.app.config import Settings, get_settings

    Settings.model_config["env_file"] = None
    get_settings.cache_clear()
    try:
        if "--probe" in sys.argv:
            async def probe_connection():
                import asyncpg

                connection = await asyncpg.connect(
                    os.environ["HYPERSYNC_TEST_POSTGRES_URL"], ssl=False, timeout=5,
                )
                await connection.close(timeout=5)

            asyncio.run(probe_connection())
            print("Disposable PostgreSQL service is reachable")
            raise SystemExit(0)
        if "--cleanup" in sys.argv:
            asyncio.run(cleanup_owned_database(
                os.environ["HYPERSYNC_TEST_POSTGRES_URL"],
                os.environ["HYPERSYNC_VERIFICATION_RUN_ID"],
            ))
            print("Owned PostgreSQL cleanup verified")
            raise SystemExit(0)
        asyncio.run(
            asyncio.wait_for(
                _exercise(
                    os.environ["HYPERSYNC_TEST_POSTGRES_URL"],
                    os.environ["HYPERSYNC_VERIFICATION_RUN_ID"],
                    Path(os.environ["HYPERSYNC_REPORT_DIR"]) / "postgres-details.log",
                ),
                timeout=180,
            )
        )
        print(
            "PostgreSQL migration, authentication and concurrent Jam checks passed; "
            "owned database removed"
        )
    except Exception as error:
        print(f"PostgreSQL verification failed: {type(error).__name__}")
        raise SystemExit(1) from None
