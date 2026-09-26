from functools import lru_cache
from pathlib import Path
from typing import Literal
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent
ENV_FILE = BASE_DIR / ".env"


def _prepare_asyncpg_url(value: str) -> str:
    """Convert a Neon/Postgres URL into a SQLAlchemy asyncpg URL."""

    value = value.strip()
    if not value:
        return ""

    if value.startswith(("sqlite://", "sqlite+aiosqlite://", "sqlite:///")):
        return value

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
    app_name: str = "Hypersync"
    app_version: str = "0.1.0"
    environment: Literal["development", "test", "production"] = "development"

    backend_host: str = "127.0.0.1"
    backend_port: int = 8000
    frontend_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    frontend_public_url: str = "http://localhost:5173"
    api_docs_enabled: bool = False

    database_url: str = ""
    migration_database_url: str = ""
    db_pool_size: int = 5
    db_max_overflow: int = 10
    db_pool_timeout_seconds: int = 10
    db_command_timeout_seconds: int = 30

    jwt_secret: str = ""
    jwt_algorithm: str = "HS256"
    jwt_issuer: str = "hypersync-api"
    jwt_audience: str = "hypersync-web"
    access_token_ttl_minutes: int = 60
    refresh_token_ttl_days: int = 30

    auth_login_rate_limit: int = 10
    auth_login_rate_window_seconds: int = 300
    auth_login_ip_rate_limit: int = 60
    auth_register_rate_limit: int = 20
    auth_register_rate_window_seconds: int = 3600
    auth_admin_register_rate_limit: int = 5
    auth_admin_register_rate_window_seconds: int = 900
    auth_refresh_rate_limit: int = 120
    auth_refresh_rate_window_seconds: int = 300

    auth_password_recovery_rate_limit: int = 5
    auth_password_recovery_ip_rate_limit: int = 20
    auth_password_recovery_rate_window_seconds: int = 900
    password_recovery_ttl_minutes: int = 15
    password_recovery_max_attempts: int = 5
    password_recovery_secret: str = ""

    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from_email: str = ""
    smtp_from_name: str = "HyperSync"
    smtp_starttls: bool = True
    smtp_use_ssl: bool = False

    message_send_rate_limit: int = 60
    message_send_rate_window_seconds: int = 60

    web_push_vapid_public_key: str = ""
    web_push_vapid_private_key: str = ""
    web_push_vapid_subject: str = ""

    admin_database_delete_password: str = ""

    admin_account_creation_password: str = ""

    bot_jwt_secret: str = ""
    bot_jwt_audience: str = "hypersync-bot"
    bot_token_ttl_minutes: int = 60

    rclone_remote: str = "hypersync-b2"

    b2_endpoint: str = ""
    b2_key_id: str = ""
    b2_application_key: str = ""

    b2_bucket_name: str = ""
    b2_audio_prefix: str = "audio"
    b2_artwork_prefix: str = "artwork"
    b2_profile_prefix: str = "profiles"
    b2_presigned_url_ttl_seconds: int = 86400
    b2_media_source_ttl_seconds: int = 300
    b2_direct_upload_enabled: bool = True
    b2_direct_upload_ttl_seconds: int = 300

    audio_compression_enabled: bool = True
    audio_compression_mp3_vbr_quality: int = 2
    audio_compression_min_source_kbps: int = 224
    audio_compression_min_savings_percent: int = 10
    audio_compression_timeout_seconds: int = 180

    local_temp_root: str = "storage/temporary"
    local_upload_root: str = "storage/uploads"
    local_log_root: str = "storage/logs"
    demo_audio_path: str = "storage/demo/demo_track.wav"

    lrclib_base_url: str = "https://lrclib.net"
    lrclib_client_name: str = "HyperSync/0.1.0 (https://hypersynced.app)"
    lrclib_not_found_retry_hours: int = 24

    musicbrainz_base_url: str = "https://musicbrainz.org"
    musicbrainz_user_agent: str = (
        "HyperSynced/0.1.0 (https://hypersynced.app)"
    )
    musicbrainz_timeout_seconds: float = 8.0
    musicbrainz_min_interval_seconds: float = 1.1
    musicbrainz_cache_hours: int = 24

    apple_search_base_url: str = "https://itunes.apple.com"
    apple_search_country: str = "US"
    apple_search_timeout_seconds: float = 8.0
    apple_search_min_interval_seconds: float = 3.1
    apple_search_cache_hours: int = 24

    lastfm_base_url: str = "https://ws.audioscrobbler.com"
    lastfm_api_key: str = ""
    lastfm_timeout_seconds: float = 8.0
    lastfm_cache_hours: int = 24

    client_cache_hours: int = 24

    model_config = SettingsConfigDict(
        env_file=ENV_FILE,
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
