import io
import ssl
import wave
from collections.abc import AsyncIterator
from functools import lru_cache
from pathlib import Path

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from .config import get_settings
from .models.base import Base
from .models.media import Track


@lru_cache
def get_engine() -> AsyncEngine:
    settings = get_settings()
    database_url = settings.sqlalchemy_database_url or "sqlite+aiosqlite:///./local_dev.db"

    engine_kwargs = {
        "pool_pre_ping": True,
        "pool_recycle": 300,
    }

    if database_url.startswith("sqlite"):
        engine_kwargs["connect_args"] = {
            "check_same_thread": False,
        }
    else:
        ssl_context = ssl.create_default_context()

        engine_kwargs["connect_args"] = {
            "ssl": ssl_context,
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


def ensure_demo_audio_file() -> Path:
    settings = get_settings()
    path = Path(settings.demo_audio_path)
    path.parent.mkdir(parents=True, exist_ok=True)

    if path.exists():
        return path

    audio_buffer = io.BytesIO()
    with wave.open(audio_buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(22050)
        wav_file.writeframes(b"\x00\x00" * (22050 * 2))

    path.write_bytes(audio_buffer.getvalue())
    return path


async def ensure_demo_data() -> None:
    settings = get_settings()
    database_url = settings.sqlalchemy_database_url

    # Only bootstrap local SQLite databases.
    # PostgreSQL/Neon schema changes must come from Alembic migrations.
    if not database_url.startswith("sqlite"):
        return

    async with get_engine().begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    demo_audio_file = ensure_demo_audio_file()

    session_factory = get_session_factory()

    async with session_factory() as session:
        result = await session.execute(select(Track).limit(1))

        if result.scalar_one_or_none() is not None:
            return

        session.add(
            Track(
                title="Demo track",
                artist="Local demo artist",
                album="Local demo album",
                b2_object_key=demo_audio_file.name,
                mime_type="audio/wav",
                file_size=demo_audio_file.stat().st_size,
                duration_seconds=2,
                is_published=True,
            )
        )
        await session.commit()


async def check_database() -> None:
    async with get_engine().connect() as connection:
        await connection.execute(text("SELECT 1"))


async def close_database() -> None:
    if get_engine.cache_info().currsize:
        await get_engine().dispose()
        get_engine.cache_clear()
        get_session_factory.cache_clear()
