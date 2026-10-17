"""Real PostgreSQL checks; disposable database supplied by the CI harness."""

import asyncio
import os
import sys
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from migrations.coordination import MIGRATION_LOCK_ID, migration_lock
from scripts.verification.postgres_database import (
    ROOT,
    create_owned_database,
    create_postgres_test_engine,
    drop_owned_database,
)


@pytest.mark.asyncio
async def test_session_lock_serializes_connections_until_external_commit():
    engine = create_postgres_test_engine()
    try:
        async with engine.connect() as first, engine.connect() as second:
            transaction = await first.begin()
            assert first.sync_connection is not None
            guard = migration_lock(first.sync_connection)
            await first.run_sync(lambda _: guard.__enter__())
            assert not await second.scalar(
                text("SELECT pg_try_advisory_lock(:key)"),
                {"key": MIGRATION_LOCK_ID},
            )
            await first.run_sync(lambda _: guard.__exit__(None, None, None))
            # Session lock released, but caller has not committed DDL/version yet.
            assert not await second.scalar(
                text("SELECT pg_try_advisory_lock(:key)"),
                {"key": MIGRATION_LOCK_ID},
            )
            await transaction.commit()
            assert await second.scalar(
                text("SELECT pg_try_advisory_lock(:key)"),
                {"key": MIGRATION_LOCK_ID},
            )
            await second.execute(
                text("SELECT pg_advisory_unlock(:key)"),
                {"key": MIGRATION_LOCK_ID},
            )
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_failed_owned_migration_releases_session_lock():
    engine = create_postgres_test_engine()
    try:
        async with engine.connect() as first, engine.connect() as second:

            def fail(connection):
                with migration_lock(connection):
                    connection.execute(text("SELECT 1 / 0"))

            with pytest.raises(DBAPIError):
                await first.run_sync(fail)
            assert await second.scalar(
                text("SELECT pg_try_advisory_lock(:key)"),
                {"key": MIGRATION_LOCK_ID},
            )
            await second.execute(
                text("SELECT pg_advisory_unlock(:key)"),
                {"key": MIGRATION_LOCK_ID},
            )
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_concurrent_alembic_invocations_commit_schema_and_version():
    from alembic.config import Config
    from alembic.script import ScriptDirectory
    from sqlalchemy.ext.asyncio import create_async_engine
    from sqlalchemy.pool import NullPool

    service = os.environ["HYPERSYNC_TEST_POSTGRES_URL"]
    run_id = uuid4().hex
    prefix = "hs_migrate"
    database_url = await create_owned_database(service, run_id, prefix)
    processes = []
    try:
        for _ in range(2):
            processes.append(
                await asyncio.create_subprocess_exec(
                    sys.executable,
                    "-m",
                    "alembic",
                    "-c",
                    str(ROOT / "alembic.ini"),
                    "upgrade",
                    "head",
                    cwd=ROOT,
                    env={
                        **os.environ,
                        "ENVIRONMENT": "test",
                        "DATABASE_URL": database_url,
                        "MIGRATION_DATABASE_URL": database_url,
                    },
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.DEVNULL,
                )
            )
        results = await asyncio.wait_for(
            asyncio.gather(*(process.wait() for process in processes)),
            timeout=60,
        )
        assert results == [0, 0], "Concurrent disposable migration failed (output suppressed)"
        engine = create_async_engine(database_url, poolclass=NullPool, connect_args={"ssl": False})
        try:
            async with engine.connect() as connection:
                version = await connection.scalar(text("SELECT version_num FROM alembic_version"))
                assert (
                    version
                    == ScriptDirectory.from_config(
                        Config(str(ROOT / "alembic.ini")),
                    ).get_current_head()
                )
                assert await connection.scalar(text("SELECT to_regclass('public.users')"))
        finally:
            await engine.dispose()
    finally:
        for process in processes:
            if process.returncode is None:
                process.kill()
                await process.wait()
        await drop_owned_database(service, run_id, prefix)


@pytest.mark.asyncio
async def test_lost_session_lock_invalidates_connection_and_fails():
    engine = create_postgres_test_engine()
    try:
        async with engine.connect() as connection:

            def lose_lock(sync_connection):
                with migration_lock(sync_connection):
                    assert sync_connection.scalar(
                        text("SELECT pg_advisory_unlock(:key)"),
                        {"key": MIGRATION_LOCK_ID},
                    )
                    sync_connection.commit()

            with pytest.raises(RuntimeError, match="Migration advisory lock was not held"):
                await connection.run_sync(lose_lock)
            assert connection.invalidated
    finally:
        await engine.dispose()
