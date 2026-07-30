import asyncio
import ssl
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

from backend.app.config import get_settings
from backend.app.models import Base


config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    settings = get_settings()
    database_url = settings.sqlalchemy_migration_url

    if not database_url:
        raise RuntimeError(
            "MIGRATION_DATABASE_URL is not configured."
        )

    context.configure(
        url=database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={
            "paramstyle": "named",
        },
        compare_type=True,
        compare_server_default=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        compare_server_default=True,
    )

    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    settings = get_settings()
    database_url = settings.sqlalchemy_migration_url

    if not database_url:
        raise RuntimeError(
            "MIGRATION_DATABASE_URL is not configured."
        )

    engine = create_async_engine(
        database_url,
        poolclass=pool.NullPool,
        connect_args={
            "ssl": ssl.create_default_context(),
        },
    )

    try:
        async with engine.connect() as connection:
            await connection.run_sync(
                run_migrations,
            )
    finally:
        await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_async_migrations())