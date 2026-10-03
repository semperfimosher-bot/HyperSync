import ssl
from collections.abc import AsyncIterator
from functools import lru_cache

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from .config import get_settings
from .models.base import Base


def resolve_database_url() -> str:
    settings = get_settings()
    database_url = settings.sqlalchemy_database_url.strip()

    if database_url:
        return database_url

    if settings.environment == "production":
        raise RuntimeError(
            "DATABASE_URL is required in production; "
            "refusing to fall back to local SQLite."
        )

    return "sqlite+aiosqlite:///./local_dev.db"


@lru_cache
def get_engine() -> AsyncEngine:
    settings = get_settings()
    database_url = resolve_database_url()

    engine_kwargs = {
        "pool_pre_ping": True,
        "pool_recycle": 300,
        "pool_use_lifo": True,
    }

    if database_url.startswith("sqlite"):
        engine_kwargs["connect_args"] = {
            "check_same_thread": False,
        }
    else:
        ssl_context = ssl.create_default_context()

        engine_kwargs.update(
            {
                "pool_size":
                    max(
                        1,
                        int(
                            settings
                            .db_pool_size,
                        ),
                    ),
                "max_overflow":
                    max(
                        0,
                        int(
                            settings
                            .db_max_overflow,
                        ),
                    ),
                "pool_timeout":
                    max(
                        1,
                        int(
                            settings
                            .db_pool_timeout_seconds,
                        ),
                    ),
            }
        )

        engine_kwargs["connect_args"] = {
            "ssl": ssl_context,
            "command_timeout": max(1, int(settings.db_command_timeout_seconds)),
            # Server-side limits still apply if a client task is stalled or
            # cancelled. These bound runaway SQL, lock waits, and abandoned
            # open transactions on PostgreSQL/Neon.
            "server_settings": {
                "statement_timeout": str(max(1, int(settings.db_statement_timeout_ms))),
                "lock_timeout": str(max(1, int(settings.db_lock_timeout_ms))),
                "idle_in_transaction_session_timeout": str(
                    max(1, int(settings.db_idle_transaction_timeout_ms))
                ),
            },
        }

    return create_async_engine(
        database_url,
        **engine_kwargs,
    )


@lru_cache
def get_session_factory() -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(
        bind=get_engine(),
        class_=AsyncSession,
        expire_on_commit=False,
        autoflush=False,
    )


async def get_database_session() -> AsyncIterator[AsyncSession]:
    session_factory = get_session_factory()

    async with session_factory() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise



async def ensure_local_database() -> None:
    settings = get_settings()
    database_url = settings.sqlalchemy_database_url

    # Local SQLite development gets its schema from the models. Real
    # PostgreSQL/Neon schema changes must always come from Alembic.
    if not database_url.startswith("sqlite"):
        return

    async with get_engine().begin() as connection:
        await connection.run_sync(Base.metadata.create_all)


async def check_database() -> None:
    async with get_engine().connect() as connection:
        await connection.execute(text("SELECT 1"))


async def close_database() -> None:
    if get_engine.cache_info().currsize:
        await get_engine().dispose()
        get_engine.cache_clear()
        get_session_factory.cache_clear()
