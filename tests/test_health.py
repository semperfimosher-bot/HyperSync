import asyncio

import pytest
from httpx import ASGITransport, AsyncClient
from pytest import MonkeyPatch

from backend.app import main as main_module
from backend.app.api.routes import health as health_route
from backend.app.config import get_settings
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
    assert response.json()["application"] == get_settings().app_name


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
async def test_lifespan_runs_database_and_resume_startup_steps(
    monkeypatch: MonkeyPatch,
) -> None:
    calls: list[str] = []

    async def fake_database_ready() -> None:
        calls.append("database-ready")

    async def fake_catalog_resume():
        calls.append("catalog-resume")
        return None

    async def fake_on_demand_resume() -> int:
        calls.append("on-demand-resume")
        return 0

    async def fake_keepalive() -> None:
        return None

    async def fake_retention() -> None:
        return None

    async def fake_media_identity() -> None:
        return None

    async def fake_shutdown() -> None:
        calls.append("shutdown")

    async def fake_reset() -> None:
        calls.append("reset")

    async def fake_close() -> None:
        calls.append("close")

    monkeypatch.setattr(main_module, "wait_for_database_ready", fake_database_ready)
    monkeypatch.setattr(main_module, "resume_catalog_scan_on_startup", fake_catalog_resume)
    monkeypatch.setattr(main_module, "resume_on_demand_ingests_on_startup", fake_on_demand_resume)
    monkeypatch.setattr(main_module, "keep_database_warm", fake_keepalive)
    monkeypatch.setattr(main_module, "run_message_retention_cleanup", fake_retention)
    monkeypatch.setattr(main_module, "run_media_identity_backfill", fake_media_identity)
    monkeypatch.setattr(main_module, "shutdown_background_tasks", fake_shutdown)
    monkeypatch.setattr(main_module, "reset_transient_state", fake_reset)
    monkeypatch.setattr(main_module, "close_database", fake_close)

    async with main_module.lifespan(app):
        assert calls[:3] == [
            "database-ready",
            "catalog-resume",
            "on-demand-resume",
        ]

    assert calls[-3:] == ["shutdown", "reset", "close"]


@pytest.mark.asyncio
async def test_lifespan_keeps_database_warm(
    monkeypatch: MonkeyPatch,
) -> None:
    database_checks = 0
    second_check_happened = asyncio.Event()

    async def fake_database_check() -> None:
        nonlocal database_checks
        database_checks += 1
        if database_checks >= 2:
            second_check_happened.set()

    monkeypatch.setattr(main_module, "check_database", fake_database_check)
    monkeypatch.setattr(main_module, "DATABASE_KEEPALIVE_SECONDS", 0.01)

    task = asyncio.create_task(main_module.keep_database_warm())
    try:
        await asyncio.wait_for(second_check_happened.wait(), timeout=0.2)
        assert database_checks >= 2
    finally:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task


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
