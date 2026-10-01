from __future__ import annotations

import asyncio

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.exc import TimeoutError as SQLAlchemyTimeoutError

from backend.app.middleware.load_shed import (
    install_load_shedding_middleware,
)


@pytest.mark.asyncio
async def test_load_shedding_rejects_requests_when_admission_is_full() -> None:
    app = FastAPI()

    install_load_shedding_middleware(
        app,
        max_concurrent_requests=1,
        acquire_timeout_seconds=0.01,
        retry_after_seconds=2,
    )

    first_started = asyncio.Event()
    release_first = asyncio.Event()

    @app.get("/slow")
    async def slow() -> dict[str, bool]:
        first_started.set()
        await release_first.wait()
        return {"ok": True}

    transport = ASGITransport(app=app)

    async with AsyncClient(
        transport=transport,
        base_url="http://test",
    ) as client:
        first = asyncio.create_task(
            client.get("/slow"),
        )

        await first_started.wait()

        second = await client.get("/slow")

        assert second.status_code == 503
        assert second.headers["Retry-After"] == "2"

        release_first.set()
        first_response = await first

    assert first_response.status_code == 200


@pytest.mark.asyncio
async def test_database_pool_timeout_becomes_retryable_503() -> None:
    app = FastAPI()

    install_load_shedding_middleware(
        app,
        max_concurrent_requests=2,
        acquire_timeout_seconds=0.5,
        retry_after_seconds=3,
    )

    @app.get("/db-timeout")
    async def db_timeout() -> None:
        raise SQLAlchemyTimeoutError("QueuePool limit reached")

    transport = ASGITransport(app=app)

    async with AsyncClient(
        transport=transport,
        base_url="http://test",
    ) as client:
        response = await client.get("/db-timeout")

    assert response.status_code == 503
    assert response.headers["Retry-After"] == "3"
    assert "Database is busy" in response.json()["detail"]
