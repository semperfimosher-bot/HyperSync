import pytest

from backend.app.config import Settings


DATABASE_URL = "postgresql://verification:verification@localhost/hypersync"
STRONG_SECRET = "stage-kB7aD9mQ3pX8vN2hL5rT1wZ6cF4sY0jR9uE7"


@pytest.mark.parametrize(
    "secret",
    [
        "",
        "short",
        "change-me",
        "your-production-secret",
        "development-secret",
        "test-secret-please-change-this",
    ],
)
@pytest.mark.parametrize("environment", ["staging", "production"])
def test_hosted_environments_reject_missing_short_or_placeholder_jwt_secrets(
    environment: str,
    secret: str,
) -> None:
    from pydantic import ValidationError

    with pytest.raises(ValidationError, match="JWT_SECRET"):
        Settings(
            environment=environment,
            database_url=DATABASE_URL,
            jwt_secret=secret,
        )


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("admin_database_delete_password", "short"),
        ("admin_account_creation_password", "change-me"),
        ("password_recovery_secret", "your-recovery-secret"),
    ],
)
def test_hosted_environments_reject_weak_configured_optional_secrets(
    field: str,
    value: str,
) -> None:
    with pytest.raises(ValidationError):
        Settings(
            environment="production",
            database_url=DATABASE_URL,
            jwt_secret=STRONG_SECRET,
            **{field: value},
        )


@pytest.mark.parametrize("environment", ["staging", "production"])
def test_hosted_environments_accept_unique_long_secrets(
    environment: str,
) -> None:
    settings = Settings(
        environment=environment,
        database_url=DATABASE_URL,
        jwt_secret=STRONG_SECRET,
        admin_database_delete_password="db-delete-unique-secret-123456",
        admin_account_creation_password="admin-create-unique-secret-123456",
        password_recovery_secret="recovery-unique-secret-1234567890",
    )

    assert settings.environment == environment
    assert settings.jwt_secret == STRONG_SECRET
