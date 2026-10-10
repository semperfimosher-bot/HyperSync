"""Owned local PostgreSQL databases for tests and verification."""

import re
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

ROOT = Path(__file__).resolve().parents[2]
_LOCAL_HOSTS = {"127.0.0.1", "::1", "localhost"}
_RUN_ID = re.compile(r"[a-f0-9]{32}")
_PREFIX = re.compile(r"[a-z][a-z0-9_]{1,20}")


def validate_local_postgres_service(database_url: str) -> str:
    value = database_url.strip()
    target = urlsplit(value)
    if (
        target.scheme not in {"postgres", "postgresql"}
        or target.hostname not in _LOCAL_HOSTS
        or target.query
        or target.fragment
        or not target.path.strip("/")
    ):
        raise ValueError(
            "An explicit disposable local PostgreSQL service is required"
        )
    return value


def owned_database_name(run_id: str, prefix: str) -> str:
    if not _RUN_ID.fullmatch(run_id):
        raise ValueError("Invalid database ownership identifier")
    if not _PREFIX.fullmatch(prefix):
        raise ValueError("Invalid database prefix")
    return f"{prefix}_{run_id}"


def database_url_for_owned_database(
    database_url: str,
    run_id: str,
    prefix: str,
) -> str:
    source = urlsplit(
        validate_local_postgres_service(database_url)
    )
    name = owned_database_name(run_id, prefix)
    return urlunsplit(
        (
            "postgresql+asyncpg",
            source.netloc,
            "/" + name,
            "",
            "",
        )
    )


def _owner_marker(run_id: str, prefix: str) -> str:
    owned_database_name(run_id, prefix)
    return f"hypersync:{prefix}:{run_id}"


async def create_owned_database(
    database_url: str,
    run_id: str,
    prefix: str,
) -> str:
    import asyncpg

    service_url = validate_local_postgres_service(
        database_url
    )
    name = owned_database_name(run_id, prefix)
    marker = _owner_marker(run_id, prefix)
    admin = await asyncpg.connect(
        service_url,
        timeout=5,
        ssl=False,
    )
    try:
        await admin.execute(
            f'CREATE DATABASE "{name}"'
        )
        await admin.execute(
            f"COMMENT ON DATABASE \"{name}\" IS '{marker}'"
        )
    finally:
        await admin.close(timeout=5)

    return database_url_for_owned_database(
        service_url,
        run_id,
        prefix,
    )


async def drop_owned_database(
    database_url: str,
    run_id: str,
    prefix: str,
) -> None:
    import asyncpg

    service_url = validate_local_postgres_service(
        database_url
    )
    name = owned_database_name(run_id, prefix)
    marker = _owner_marker(run_id, prefix)
    admin = await asyncpg.connect(
        service_url,
        timeout=5,
        ssl=False,
    )
    try:
        row = await admin.fetchrow(
            "SELECT shobj_description(oid, 'pg_database') AS owner "
            "FROM pg_database WHERE datname=$1",
            name,
        )
        if row is None:
            return
        if row["owner"] != marker:
            raise RuntimeError(
                "Database ownership changed; cleanup refused"
            )
        await admin.execute(
            f'DROP DATABASE "{name}" WITH (FORCE)',
            timeout=10,
        )
    finally:
        await admin.close(timeout=5)


async def upgrade_database_to_head(
    database_url: str,
) -> None:
    from alembic import command
    from alembic.config import Config
    from sqlalchemy.ext.asyncio import create_async_engine
    from sqlalchemy.pool import NullPool

    engine = create_async_engine(
        database_url,
        poolclass=NullPool,
        connect_args={"ssl": False},
    )
    config = Config(str(ROOT / "alembic.ini"))
    try:
        async with engine.begin() as connection:

            def upgrade(sync_connection) -> None:
                config.attributes["connection"] = sync_connection
                command.upgrade(config, "head")

            await connection.run_sync(upgrade)
    finally:
        await engine.dispose()


def create_postgres_test_engine(**engine_kwargs):
    """Create a test engine against pytest's owned PostgreSQL database."""

    from sqlalchemy.ext.asyncio import create_async_engine

    from backend.app.database import resolve_database_url

    connect_args = {
        "ssl": False,
        **engine_kwargs.pop("connect_args", {}),
    }
    return create_async_engine(
        resolve_database_url(),
        connect_args=connect_args,
        **engine_kwargs,
    )
