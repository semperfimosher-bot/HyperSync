from pathlib import Path

from backend.app.config import Settings


def test_public_frontend_url_is_always_a_cors_origin() -> None:
    settings = Settings(
        frontend_origins="https://preview.example.com/",
        frontend_public_url="https://hypersynced.app/",
        _env_file=None,
    )

    assert settings.cors_origins == [
        "https://preview.example.com",
        "https://hypersynced.app",
    ]


def test_public_frontend_cors_origin_is_not_duplicated() -> None:
    settings = Settings(
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
    assert (
        "connect-src 'self' "
        "https://api.hypersynced.app "
        "wss://api.hypersynced.app "
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
    assert (
        "proxy_pass https://api.hypersynced.app;"
        in nginx
    )
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
