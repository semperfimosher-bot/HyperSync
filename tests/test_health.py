import asyncio

import pytest
from httpx import ASGITransport, AsyncClient
from pytest import MonkeyPatch

from backend.app import main as main_module
from backend.app.api.routes import health as health_route
from backend.app.main import app


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
async def test_lifespan_warms_database_before_serving(
    monkeypatch: MonkeyPatch,
) -> None:
    calls: list[str] = []

    async def fake_demo_data() -> None:
        calls.append("demo")

    async def fake_database_check() -> None:
        calls.append("database")

    async def fake_close_database() -> None:
        calls.append("close")

    monkeypatch.setattr(
        main_module,
        "ensure_demo_data",
        fake_demo_data,
    )

    monkeypatch.setattr(
        main_module,
        "check_database",
        fake_database_check,
        raising=False,
    )

    monkeypatch.setattr(
        main_module,
        "close_database",
        fake_close_database,
    )

    async with main_module.lifespan(app):
        assert calls == [
            "demo",
            "database",
        ]

    assert calls == [
        "demo",
        "database",
        "close",
    ]


@pytest.mark.asyncio
async def test_lifespan_keeps_database_warm(
    monkeypatch: MonkeyPatch,
) -> None:
    database_checks = 0

    second_check_happened = asyncio.Event()

    async def fake_demo_data() -> None:
        return None

    async def fake_database_check() -> None:
        nonlocal database_checks

        database_checks += 1

        if database_checks >= 2:
            second_check_happened.set()

    async def fake_close_database() -> None:
        return None

    monkeypatch.setattr(
        main_module,
        "ensure_demo_data",
        fake_demo_data,
    )

    monkeypatch.setattr(
        main_module,
        "check_database",
        fake_database_check,
    )

    monkeypatch.setattr(
        main_module,
        "close_database",
        fake_close_database,
    )

    monkeypatch.setattr(
        main_module,
        "DATABASE_KEEPALIVE_SECONDS",
        0.01,
        raising=False,
    )

    async with main_module.lifespan(app):
        try:
            await asyncio.wait_for(
                second_check_happened.wait(),
                timeout=0.2,
            )
        except TimeoutError:
            pass

        assert database_checks >= 2


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
