from pathlib import Path
from typing import Any, cast

from backend.app.config import Settings


def test_public_frontend_url_is_always_a_cors_origin() -> None:
    settings = cast(Any, Settings)(
        frontend_origins="https://preview.example.com/",
        frontend_public_url="https://hypersynced.app/",
        _env_file=None,
    )

    assert settings.cors_origins == [
        "https://preview.example.com",
        "https://hypersynced.app",
    ]


def test_public_frontend_cors_origin_is_not_duplicated() -> None:
    settings = cast(Any, Settings)(
        frontend_origins=(
            "https://hypersynced.app/,"
            "http://localhost:5173/"
        ),
        frontend_public_url="https://hypersynced.app/",
        _env_file=None,
    )

    assert settings.cors_origins.count(
        "https://hypersynced.app",
    ) == 1


def test_frontend_csp_allows_production_realtime_and_beacon() -> None:
    policy = (
        Path(__file__).resolve().parents[1]
        / "frontend"
        / "security-headers.conf"
    ).read_text(
        encoding="utf-8",
    )

    assert (
        "script-src 'self' "
        "https://static.cloudflareinsights.com;"
        in policy
    )
    # The CSP is an Nginx template: the entrypoint substitutes the
    # configurable WebSocket origin while production origins remain allowed.
    assert (
        "connect-src 'self' "
        "https://api.hypersynced.app "
        "wss://api.hypersynced.app "
        "${FRONTEND_WS_ORIGIN} "
        "https://*.backblazeb2.com;"
        in policy
    )


def test_production_frontend_uses_same_origin_api_proxy() -> None:
    root = Path(__file__).resolve().parents[1]

    client = (
        root
        / "frontend"
        / "src"
        / "api"
        / "client.js"
    ).read_text(
        encoding="utf-8",
    )

    dockerfile = (
        root
        / "frontend"
        / "Dockerfile"
    ).read_text(
        encoding="utf-8",
    )

    nginx = (
        root
        / "frontend"
        / "nginx.conf"
    ).read_text(
        encoding="utf-8",
    )

    assert (
        "https://api.hypersynced.app/api"
        not in client
    )
    assert (
        "ENV VITE_API_BASE_URL=/api"
        in dockerfile
    )
    assert "location /api/" in nginx
    # Nginx routes through a configurable template; Docker's defaults must
    # preserve the current production API while staging can override it.
    assert "proxy_pass ${API_UPSTREAM_URL};" in nginx
    assert "proxy_set_header Host ${API_UPSTREAM_HOST};" in nginx
    assert "proxy_ssl_name ${API_UPSTREAM_HOST};" in nginx
    assert "ENV API_UPSTREAM_URL=https://api.hypersynced.app" in dockerfile
    assert "ENV API_UPSTREAM_HOST=api.hypersynced.app" in dockerfile
    assert (
        "proxy_set_header Upgrade $http_upgrade;"
        in nginx
    )
    assert (
        'proxy_set_header Connection "upgrade";'
        in nginx
    )


def test_backend_retries_startup_migrations() -> None:
    dockerfile = (
        Path(__file__).resolve().parents[1]
        / "Dockerfile.backend"
    ).read_text(
        encoding="utf-8",
    )

    assert (
        "until python -m alembic "
        "-c /app/alembic.ini upgrade head"
        in dockerfile
    )
    assert (
        "MIGRATION_MAX_ATTEMPTS:-12"
        in dockerfile
    )
    assert (
        "exec python -m uvicorn"
        in dockerfile
    )
