import logging
import re

import pytest
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from httpx import ASGITransport, AsyncClient

from backend.app.main import app as production_app
from backend.app.middleware.request_diagnostics import (
    RequestDiagnosticsMiddleware,
)


def make_app(status_code: int = 200) -> FastAPI:
    app = FastAPI()
    app.add_middleware(
        RequestDiagnosticsMiddleware,
        slow_request_ms=0,
    )

    @app.get("/items/{item_id}")
    async def item(item_id: str) -> JSONResponse:
        return JSONResponse(
            status_code=status_code,
            content={"item": item_id},
        )

    @app.get("/explode/{item_id}")
    async def explode(item_id: str) -> JSONResponse:
        raise RuntimeError("do not expose this exception message")

    return app


@pytest.mark.asyncio
async def test_request_id_header_and_privacy_safe_slow_log(
    caplog: pytest.LogCaptureFixture,
) -> None:
    app = make_app()
    caplog.set_level(
        logging.INFO,
        logger="backend.app.middleware.request_diagnostics",
    )

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        response = await client.get(
            "/items/private-user-id?token=secret-query-value",
        )

    request_id = response.headers.get("x-request-id", "")
    assert re.fullmatch(r"[0-9a-f]{32}", request_id)
    assert response.status_code == 200

    diagnostic_records = [
        record.getMessage()
        for record in caplog.records
        if record.name == "backend.app.middleware.request_diagnostics"
    ]
    assert any("http_request_slow" in message for message in diagnostic_records)
    assert any("route=/items/{item_id}" in message for message in diagnostic_records)
    assert all("secret-query-value" not in message for message in diagnostic_records)
    assert all("private-user-id" not in message for message in diagnostic_records)


@pytest.mark.asyncio
async def test_server_error_is_logged_without_query_or_body(
    caplog: pytest.LogCaptureFixture,
) -> None:
    app = make_app(status_code=503)
    caplog.set_level(
        logging.WARNING,
        logger="backend.app.middleware.request_diagnostics",
    )

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        response = await client.get(
            "/items/abc?signature=signed-url-secret",
        )

    assert response.status_code == 503
    assert response.headers.get("x-request-id")
    messages = [
        record.getMessage()
        for record in caplog.records
        if record.name == "backend.app.middleware.request_diagnostics"
    ]
    assert any("http_request_failed" in message for message in messages)
    assert any("status=503" in message for message in messages)
    assert all("signed-url-secret" not in message for message in messages)
    assert all("/items/abc" not in message for message in messages)



@pytest.mark.asyncio
async def test_unhandled_exception_returns_request_id_without_leaking_exception(
    caplog: pytest.LogCaptureFixture,
) -> None:
    app = make_app()
    caplog.set_level(
        logging.ERROR,
        logger="backend.app.middleware.request_diagnostics",
    )

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        response = await client.get(
            "/explode/private-user-id?token=secret-query-value",
        )

    request_id = response.headers.get("x-request-id", "")
    assert re.fullmatch(r"[0-9a-f]{32}", request_id)
    assert response.status_code == 500
    assert response.json() == {"detail": "Internal Server Error"}

    messages = [
        record.getMessage()
        for record in caplog.records
        if record.name == "backend.app.middleware.request_diagnostics"
    ]
    assert any(f"request_id={request_id}" in message for message in messages)
    assert all("do not expose this exception message" not in message for message in messages)
    assert all("secret-query-value" not in message for message in messages)
    assert all("private-user-id" not in message for message in messages)


@pytest.mark.asyncio
async def test_application_registers_request_diagnostics_middleware() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=production_app),
        base_url="http://test",
    ) as client:
        response = await client.get("/")

    assert response.status_code == 200
    request_id = response.headers.get("x-request-id", "")
    assert re.fullmatch(r"[0-9a-f]{32}", request_id)

@pytest.mark.asyncio
async def test_request_id_replaces_handler_supplied_identifier() -> None:
    app = FastAPI()
    app.add_middleware(RequestDiagnosticsMiddleware)

    @app.get("/spoof")
    async def spoof() -> JSONResponse:
        return JSONResponse(
            content={"ok": True},
            headers={"x-request-id": "caller-controlled"},
        )

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        response = await client.get("/spoof")

    request_ids = response.headers.get_list("x-request-id")
    assert len(request_ids) == 1
    assert re.fullmatch(r"[0-9a-f]{32}", request_ids[0])
    assert request_ids[0] != "caller-controlled"

