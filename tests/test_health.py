import pytest
from backend.app.main import app
from httpx import ASGITransport, AsyncClient
from pytest import MonkeyPatch

from backend.app.api.routes import health as health_route


@pytest.mark.asyncio
async def test_root() -> None:
    transport = ASGITransport(app=app)

    async with AsyncClient(
        transport=transport,
        base_url="http://test",
    ) as client:
        response = await client.get("/")

    assert response.status_code == 200
    assert response.json()["application"] == "HyperSync"


@pytest.mark.asyncio
async def test_live_health() -> None:
    transport = ASGITransport(app=app)

    async with AsyncClient(
        transport=transport,
        base_url="http://test",
    ) as client:
        response = await client.get("/health/live")

    assert response.status_code == 200
    assert response.json()["api"] == "healthy"


@pytest.mark.asyncio
async def test_ready_health_when_database_is_available(
    monkeypatch: MonkeyPatch,
) -> None:
    async def successful_check() -> None:
        return None

    monkeypatch.setattr(
        health_route,
        "check_database",
        successful_check,
    )

    transport = ASGITransport(app=app)

    async with AsyncClient(
        transport=transport,
        base_url="http://test",
    ) as client:
        response = await client.get("/health/ready")

    assert response.status_code == 200
    assert response.json()["database"] == "healthy"


@pytest.mark.asyncio
async def test_ready_health_when_database_is_unavailable(
    monkeypatch: MonkeyPatch,
) -> None:
    async def failed_check() -> None:
        raise RuntimeError("Database unavailable")

    monkeypatch.setattr(
        health_route,
        "check_database",
        failed_check,
    )

    transport = ASGITransport(app=app)

    async with AsyncClient(
        transport=transport,
        base_url="http://test",
    ) as client:
        response = await client.get("/health/ready")

    assert response.status_code == 503
    assert response.json()["database"] == "unhealthy"
