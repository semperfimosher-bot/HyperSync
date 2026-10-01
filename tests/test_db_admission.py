from __future__ import annotations

import asyncio
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.exc import TimeoutError as SQLAlchemyTimeoutError

from backend.app.api.dependencies import get_current_user
from backend.app.api.routes import on_demand
from backend.app.config import Settings
from backend.app.middleware.overload import (
    DatabaseAdmissionMiddleware,
    database_pool_timeout_handler,
)
from backend.app.models.account import AccountType


@pytest.mark.asyncio
async def test_admission_returns_retryable_503_and_keeps_liveness_open() -> None:
    test_app = FastAPI()
    test_app.add_middleware(
        DatabaseAdmissionMiddleware,
        max_concurrent_requests=1,
        admission_timeout_seconds=0.01,
    )
    started = asyncio.Event()
    release = asyncio.Event()

    @test_app.get("/work")
    async def work() -> dict[str, bool]:
        started.set()
        await release.wait()
        return {"ok": True}

    @test_app.get("/health/live")
    async def live() -> dict[str, bool]:
        return {"ok": True}

    @test_app.get("/health/ready")
    async def ready() -> dict[str, bool]:
        return {"ok": True}

    async with AsyncClient(
        transport=ASGITransport(app=test_app),
        base_url="http://test",
    ) as client:
        in_flight = asyncio.create_task(client.get("/work"))
        await started.wait()

        rejected = await client.get("/work")
        live_response = await client.get("/health/live")
        ready_response = await client.get("/health/ready")

        release.set()
        accepted = await in_flight

    assert rejected.status_code == 503
    assert rejected.headers["retry-after"] == "1"
    assert "pool" not in rejected.text.lower()
    assert live_response.status_code == 200
    assert ready_response.status_code == 200
    assert accepted.status_code == 200


@pytest.mark.asyncio
async def test_sqlalchemy_pool_timeout_is_returned_as_retryable_503() -> None:
    test_app = FastAPI()
    test_app.add_exception_handler(
        SQLAlchemyTimeoutError,
        database_pool_timeout_handler,
    )

    @test_app.get("/_test/db-pool-timeout")
    async def fail_with_pool_timeout() -> None:
        raise SQLAlchemyTimeoutError("internal pool diagnostic")

    async with AsyncClient(
        transport=ASGITransport(app=test_app),
        base_url="http://test",
    ) as client:
        response = await client.get("/_test/db-pool-timeout")

    assert response.status_code == 503
    assert response.headers["retry-after"] == "1"
    assert response.json() == {"detail": "The service is busy. Please retry shortly."}


@pytest.mark.asyncio
async def test_on_demand_search_rejects_unbounded_client_limit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    test_app = FastAPI()
    test_app.include_router(on_demand.router, prefix="/api")
    user = SimpleNamespace(
        id=uuid4(),
        account_type=AccountType.REGISTERED,
    )

    async def current_user() -> SimpleNamespace:
        return user

    async def allow_rate_limit(*_args, **_kwargs) -> None:
        return None

    requested_limits: list[int] = []

    async def search_and_remember(_query: str, *, limit: int, **_kwargs) -> list:
        requested_limits.append(limit)
        return []

    test_app.dependency_overrides[get_current_user] = current_user
    monkeypatch.setattr(on_demand, "enforce_rate_limit", allow_rate_limit)
    monkeypatch.setattr(on_demand, "search_and_remember", search_and_remember)

    async with AsyncClient(
        transport=ASGITransport(app=test_app),
        base_url="http://test",
    ) as client:
        default_response = await client.get(
            "/api/on-demand/search",
            params={"q": "artist"},
        )
        oversized_response = await client.get(
            "/api/on-demand/search",
            params={"q": "artist", "limit": 500},
        )
        oversized_artist_response = await client.get(
            "/api/on-demand/artist",
            params={"name": "artist", "limit": 500},
        )

    assert default_response.status_code == 200
    assert requested_limits == [100]
    assert oversized_response.status_code == 422
    assert oversized_artist_response.status_code == 422


def test_settings_reject_admission_capacity_that_uses_entire_pool() -> None:
    with pytest.raises(
        ValueError,
        match="leave at least two database connections",
    ):
        Settings(
            _env_file=None,
            db_pool_size=5,
            db_max_overflow=5,
            api_max_concurrent_requests=9,
        )
