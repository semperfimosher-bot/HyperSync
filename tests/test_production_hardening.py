from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.requests import Request
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

import backend.app.database as database_module
from backend.app.api.routes.audio import (
    resolve_local_audio_fallback,
)
from backend.app.api.routes.auth import (
    set_refresh_cookie,
)
from backend.app.config import (
    get_settings,
)
from backend.app.database import get_session_factory
from backend.app.main import app
from backend.app.models.system import RateLimitBucket
from backend.app.security.rate_limit import (
    cleanup_stale_rate_limits,
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


@pytest.fixture(autouse=True)
async def rate_limit_database_schema():
    await reset_rate_limits()

    yield

    await reset_rate_limits()


@pytest.mark.asyncio
async def test_auth_rate_limit_blocks_after_budget() -> None:
    request = request_for()

    await enforce_rate_limit(
        request,
        scope="test-login",
        identity="user@example.com",
        limit=2,
        window_seconds=60,
    )

    await enforce_rate_limit(
        request,
        scope="test-login",
        identity="user@example.com",
        limit=2,
        window_seconds=60,
    )

    with pytest.raises(
        HTTPException,
    ) as exc_info:
        await enforce_rate_limit(
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


@pytest.mark.asyncio
async def test_rate_limit_serializes_concurrent_requests() -> None:
    request = request_for()

    async def hit() -> int:
        try:
            await enforce_rate_limit(
                request,
                scope="test-concurrent-limit",
                identity="same-user@example.com",
                limit=5,
                window_seconds=60,
            )
        except HTTPException as exc:
            return exc.status_code

        return 200

    statuses = await asyncio.gather(
        *(hit() for _ in range(12))
    )

    assert statuses.count(200) == 5
    assert statuses.count(429) == 7


@pytest.mark.asyncio
async def test_rate_limit_cleanup_removes_only_expired_buckets() -> None:
    reference = datetime.now(
        UTC,
    )
    session_factory = get_session_factory()

    async with session_factory() as session:
        session.add_all(
            [
                RateLimitBucket(
                    key="test-stale",
                    window_started_at=(
                        reference
                        - timedelta(
                            days=3,
                        )
                    ),
                    request_count=1,
                    updated_at=(
                        reference
                        - timedelta(
                            days=3,
                        )
                    ),
                ),
                RateLimitBucket(
                    key="test-fresh",
                    window_started_at=reference,
                    request_count=1,
                    updated_at=reference,
                ),
            ]
        )
        await session.commit()

    await cleanup_stale_rate_limits(
        now=reference,
    )

    async with session_factory() as session:
        result = await session.execute(
            select(
                RateLimitBucket.key,
            )
        )

        keys = set(
            result.scalars().all()
        )

    assert "test-stale" not in keys
    assert "test-fresh" in keys


@pytest.mark.asyncio
async def test_auth_rate_limit_separates_identity_buckets() -> None:
    request = request_for()

    await enforce_rate_limit(
        request,
        scope="test-login",
        identity="first@example.com",
        limit=1,
        window_seconds=60,
    )

    await enforce_rate_limit(
        request,
        scope="test-login",
        identity="second@example.com",
        limit=1,
        window_seconds=60,
    )



@pytest.mark.asyncio
async def test_identity_rate_limit_cannot_be_reset_by_changing_ip() -> None:
    await enforce_rate_limit(
        request_for(
            "203.0.113.10",
        ),
        scope="test-account-limit",
        identity="same-user@example.com",
        include_client=False,
        limit=1,
        window_seconds=60,
    )

    with pytest.raises(
        HTTPException,
    ) as exc_info:
        await enforce_rate_limit(
            request_for(
                "198.51.100.25",
            ),
            scope="test-account-limit",
            identity="same-user@example.com",
            include_client=False,
            limit=1,
            window_seconds=60,
        )

    assert (
        exc_info.value.status_code
        == 429
    )


@pytest.mark.asyncio
async def test_spoofed_forwarded_headers_do_not_change_rate_limit_client() -> None:
    base_scope = {
        "type": "http",
        "http_version": "1.1",
        "method": "POST",
        "scheme": "https",
        "path": "/api/auth/login",
        "raw_path": b"/api/auth/login",
        "query_string": b"",
        "client": (
            "203.0.113.44",
            443,
        ),
        "server": (
            "api.hypersynced.app",
            443,
        ),
    }

    first = Request({
        **base_scope,
        "headers": [
            (
                b"x-forwarded-for",
                b"1.1.1.1",
            ),
        ],
    })

    second = Request({
        **base_scope,
        "headers": [
            (
                b"x-forwarded-for",
                b"8.8.8.8",
            ),
            (
                b"cf-connecting-ip",
                b"9.9.9.9",
            ),
        ],
    })

    await enforce_rate_limit(
        first,
        scope="test-forwarded-header",
        limit=1,
        window_seconds=60,
    )

    with pytest.raises(
        HTTPException,
    ) as exc_info:
        await enforce_rate_limit(
            second,
            scope="test-forwarded-header",
            limit=1,
            window_seconds=60,
        )

    assert (
        exc_info.value.status_code
        == 429
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


def test_refresh_cookie_ignores_untrusted_forwarded_proto(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(
        "ENVIRONMENT",
        "development",
    )

    get_settings.cache_clear()


def test_production_database_requires_explicit_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        database_module,
        "get_settings",
        lambda: SimpleNamespace(
            environment="production",
            sqlalchemy_database_url="",
        ),
    )

    with pytest.raises(
        RuntimeError,
        match="DATABASE_URL is required",
    ):
        database_module.resolve_database_url()


def test_test_database_requires_explicit_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        database_module,
        "get_settings",
        lambda: SimpleNamespace(
            environment="test",
            sqlalchemy_database_url="",
        ),
    )

    with pytest.raises(
        RuntimeError,
        match="DATABASE_URL is required",
    ):
        database_module.resolve_database_url()

    request = Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": "POST",
            "scheme": "http",
            "path": "/api/auth/login",
            "raw_path": b"/api/auth/login",
            "query_string": b"",
            "headers": [
                (
                    b"x-forwarded-proto",
                    b"https",
                ),
            ],
            "client": (
                "203.0.113.44",
                443,
            ),
            "server": (
                "api.hypersynced.app",
                443,
            ),
        }
    )

    from fastapi import Response

    response = Response()

    set_refresh_cookie(
        response,
        "test-refresh-token",
        request,
    )

    cookie = response.headers[
        "set-cookie"
    ]

    assert "HttpOnly" in cookie
    assert "SameSite=lax" in cookie
    assert "Secure" not in cookie

    get_settings.cache_clear()


def test_refresh_cookie_is_always_secure_in_production(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(
        "ENVIRONMENT",
        "production",
    )
    monkeypatch.setenv(
        "DATABASE_URL",
        "postgresql://verification:disposable-ci-only@127.0.0.1:5432/verification",
    )

    get_settings.cache_clear()

    request = Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": "POST",
            "scheme": "http",
            "path": "/api/auth/login",
            "raw_path": b"/api/auth/login",
            "query_string": b"",
            "headers": [],
            "client": (
                "127.0.0.1",
                443,
            ),
            "server": (
                "api.hypersynced.app",
                443,
            ),
        }
    )

    from fastapi import Response

    response = Response()

    set_refresh_cookie(
        response,
        "test-refresh-token",
        request,
    )

    cookie = response.headers[
        "set-cookie"
    ]

    assert "Secure" in cookie

    get_settings.cache_clear()
