import asyncio
from collections.abc import AsyncIterator
from contextlib import (
    asynccontextmanager,
    suppress,
)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.router import api_router
from .config import get_settings
from .database import (
    check_database,
    close_database,
    ensure_demo_data,
)

DATABASE_KEEPALIVE_SECONDS = 240.0


async def keep_database_warm() -> None:
    while True:
        await asyncio.sleep(
            DATABASE_KEEPALIVE_SECONDS,
        )

        try:
            await check_database()
        except Exception:
            # A temporary database/network failure
            # should not kill the FastAPI process.
            continue


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    await ensure_demo_data()

    # Pay any database wake-up/connection cost
    # during backend startup instead of login.
    await check_database()

    keepalive_task = asyncio.create_task(
        keep_database_warm(),
    )

    try:
        yield
    finally:
        keepalive_task.cancel()

        with suppress(
            asyncio.CancelledError,
        ):
            await keepalive_task

        await close_database()


settings = get_settings()

app = FastAPI(
    title=f"{settings.app_name} API",
    version=settings.app_version,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)


@app.get("/")
async def root() -> dict[str, str]:
    return {
        "application": settings.app_name,
        "status": "online",
        "documentation": "/docs",
    }
