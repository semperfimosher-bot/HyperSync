from __future__ import annotations

import pytest
from fastapi import HTTPException
from fastapi.requests import Request
from httpx import ASGITransport, AsyncClient

from backend.app.api.routes.audio import (
    resolve_local_audio_fallback,
)
from backend.app.main import app
from backend.app.security.rate_limit import (
    enforce_rate_limit,
    reset_rate_limits,
)


def request_for(
    ip: str = "203.0.113.10",
) -> Request:
    return Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": "POST",
            "scheme": "https",
            "path": "/api/auth/login",
            "raw_path": b"/api/auth/login",
            "query_string": b"",
            "headers": [],
            "client": (
                ip,
                443,
            ),
            "server": (
                "api.hypersynced.app",
                443,
            ),
        }
    )


def test_auth_rate_limit_blocks_after_budget() -> None:
    reset_rate_limits()

    request = request_for()

    enforce_rate_limit(
        request,
        scope="test-login",
        identity="user@example.com",
        limit=2,
        window_seconds=60,
    )

    enforce_rate_limit(
        request,
        scope="test-login",
        identity="user@example.com",
        limit=2,
        window_seconds=60,
    )

    with pytest.raises(
        HTTPException,
    ) as exc_info:
        enforce_rate_limit(
            request,
            scope="test-login",
            identity="user@example.com",
            limit=2,
            window_seconds=60,
        )

    assert (
        exc_info.value.status_code
        == 429
    )

    assert (
        exc_info.value.headers
        is not None
    )

    assert int(
        exc_info.value.headers[
            "Retry-After"
        ]
    ) >= 1


def test_auth_rate_limit_separates_identity_buckets() -> None:
    reset_rate_limits()

    request = request_for()

    enforce_rate_limit(
        request,
        scope="test-login",
        identity="first@example.com",
        limit=1,
        window_seconds=60,
    )

    enforce_rate_limit(
        request,
        scope="test-login",
        identity="second@example.com",
        limit=1,
        window_seconds=60,
    )


def test_audio_fallback_rejects_absolute_and_traversal_paths() -> None:
    assert (
        resolve_local_audio_fallback(
            "/etc/passwd",
        )
        is None
    )

    assert (
        resolve_local_audio_fallback(
            "../../etc/passwd",
        )
        is None
    )


@pytest.mark.asyncio
async def test_api_docs_are_not_public_by_default_and_headers_are_present() -> None:
    assert app.docs_url is None
    assert app.openapi_url is None

    transport = ASGITransport(
        app=app,
    )

    async with AsyncClient(
        transport=transport,
        base_url="https://api.hypersynced.app",
    ) as client:
        response = await client.get(
            "/",
        )

    assert response.status_code == 200

    assert (
        response.headers[
            "x-content-type-options"
        ]
        == "nosniff"
    )

    assert (
        response.headers[
            "x-frame-options"
        ]
        == "DENY"
    )

    assert (
        response.headers[
            "referrer-policy"
        ]
        == "strict-origin-when-cross-origin"
    )
