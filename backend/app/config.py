from functools import lru_cache
from typing import Literal
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from pydantic_settings import BaseSettings, SettingsConfigDict


def _prepare_asyncpg_url(value: str) -> str:
    """Convert a Neon/Postgres URL into a SQLAlchemy asyncpg URL."""

    value = value.strip()
    if not value:
        return ""

    if value.startswith("postgres://"):
        value = "postgresql://" + value.removeprefix("postgres://")

    if value.startswith("postgresql://"):
        value = "postgresql+asyncpg://" + value.removeprefix("postgresql://")

    parts = urlsplit(value)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))

    # Neon provides libpq-style options in copied URLs. asyncpg does not
    # accept these as connect() keyword arguments. TLS is configured with
    # an SSLContext in database.py instead.
    query.pop("sslmode", None)
    query.pop("channel_binding", None)

    return urlunsplit(
        (
            parts.scheme,
            parts.netloc,
            parts.path,
            urlencode(query),
            parts.fragment,
        )
    )


class Settings(BaseSettings):
    app_name: str = "HyperSync"
    app_version: str = "0.1.0"
    environment: Literal["development", "test", "production"] = "development"

    backend_host: str = "127.0.0.1"
    backend_port: int = 8000
    frontend_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    database_url: str = ""
    migration_database_url: str = ""

    jwt_secret: str = ""
    jwt_algorithm: str = "HS256"
    jwt_issuer: str = "hypersync-api"
    jwt_audience: str = "hypersync-web"
    access_token_ttl_minutes: int = 60
    refresh_token_ttl_days: int = 30

    bot_jwt_secret: str = ""
    bot_jwt_audience: str = "hypersync-bot"
    bot_token_ttl_minutes: int = 60

    rclone_remote: str = "hypersync-b2"
    b2_bucket_name: str = ""
    b2_audio_prefix: str = "audio"
    b2_artwork_prefix: str = "artwork"
    b2_profile_prefix: str = "profiles"

    local_temp_root: str = "storage/temporary"
    local_upload_root: str = "storage/uploads"
    local_log_root: str = "storage/logs"

    lrclib_base_url: str = "https://lrclib.net"
    lrclib_client_name: str = "HyperSync/0.1.0 (https://hypersynced.app)"

    client_cache_hours: int = 24

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    @property
    def cors_origins(self) -> list[str]:
        return [
            origin.strip().rstrip("/")
            for origin in self.frontend_origins.split(",")
            if origin.strip()
        ]

    @property
    def sqlalchemy_database_url(self) -> str:
        return _prepare_asyncpg_url(self.database_url)

    @property
    def sqlalchemy_migration_url(self) -> str:
        source = self.migration_database_url or self.database_url
        return _prepare_asyncpg_url(source)


@lru_cache
def get_settings() -> Settings:
    return Settings()
