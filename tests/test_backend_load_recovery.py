"""Controlled API/real-Postgres pressure and recovery, never deployment capacity claims."""

import asyncio
from contextlib import asynccontextmanager

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy.exc import TimeoutError as PoolTimeout

from backend.app.api.router import api_router
from backend.app.api.routes import catalog
from backend.app.middleware.overload import (
    DatabaseAdmissionMiddleware,
    database_pool_timeout_handler,
)


@pytest.mark.asyncio
async def test_catalog_burst_and_database_failure_recover_without_leaked_admission(monkeypatch):
    app = FastAPI()
    app.include_router(api_router)
    app.add_middleware(
        DatabaseAdmissionMiddleware, max_concurrent_requests=2, admission_timeout_seconds=0.05
    )
    app.add_exception_handler(PoolTimeout, database_pool_timeout_handler)
    path = "/api/catalog/tracks?page_size=2"
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        responses = await asyncio.gather(*(client.get(path) for _ in range(40)))
        statuses = [response.status_code for response in responses]
        assert set(statuses) <= {200, 503}
        assert 200 in statuses
        for _ in range(5):
            assert (await client.get(path)).status_code == 200
        original = catalog.get_session_factory

        @asynccontextmanager
        async def unavailable():
            raise PoolTimeout("controlled disposable database outage")
            yield  # pragma: no cover

        monkeypatch.setattr(catalog, "get_session_factory", lambda: unavailable)
        failed = await client.get(path)
        assert failed.status_code == 503
        assert failed.headers["retry-after"] == "1"
        monkeypatch.setattr(catalog, "get_session_factory", original)
        recovered = await client.get(path)
        assert recovered.status_code == 200
        assert isinstance(recovered.json()["items"], list)
