import pytest
from pydantic import ValidationError

from backend.app.config import Settings


DATABASE_URL = "postgresql://verification:verification@localhost/hypersync"
VALID_SECRET = "kB7aD9mQ3pX8vN2hL5rT1wZ6cF4sY0jR9uE7xC3pV8nM2"


@pytest.mark.parametrize("environment", ["staging", "production"])
@pytest.mark.parametrize(
    "secret",
    [
        "",
        "short",
        "replace-with-a-long-random-secret",
        "your-jwt-secret",
        "test-secret-that-is-longer-than-thirty-two-characters",
    ],
)
def test_staging_and_production_reject_missing_or_placeholder_jwt_secrets(
    environment: str,
    secret: str,
) -> None:
    with pytest.raises(ValidationError, match="JWT_SECRET"):
        Settings(
            environment=environment,
            database_url=DATABASE_URL,
            jwt_secret=secret,
        )


@pytest.mark.parametrize("environment", ["staging", "production"])
def test_staging_and_production_accept_a_long_non_placeholder_jwt_secret(
    environment: str,
) -> None:
    settings = Settings(
        environment=environment,
        database_url=DATABASE_URL,
        jwt_secret=VALID_SECRET,
    )
    assert settings.jwt_secret == VALID_SECRET


@pytest.mark.parametrize("algorithm", ["none", "RS256", "HS1", ""])
def test_unsupported_jwt_algorithms_are_rejected(algorithm: str) -> None:
    with pytest.raises(ValidationError, match="JWT_ALGORITHM"):
        Settings(
            environment="development",
            database_url=DATABASE_URL,
            jwt_secret=VALID_SECRET,
            jwt_algorithm=algorithm,
        )


@pytest.mark.parametrize("field", ["jwt_issuer", "jwt_audience"])
def test_blank_jwt_issuer_or_audience_is_rejected(field: str) -> None:
    with pytest.raises(ValidationError, match="must not be empty"):
        Settings(
            environment="development",
            database_url=DATABASE_URL,
            jwt_secret=VALID_SECRET,
            **{field: "   "},
        )


def test_development_may_omit_jwt_secret_for_local_setup() -> None:
    settings = Settings(
        environment="development",
        database_url=DATABASE_URL,
        jwt_secret="",
    )
    assert settings.jwt_secret == ""


@pytest.mark.parametrize("environment", ["staging", "production"])
@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("admin_database_delete_password", "replace-with-admin-reset-password"),
        ("admin_database_delete_password", "short"),
        ("admin_account_creation_password", "replace-with-admin-account-creation-password"),
        ("admin_account_creation_password", "short"),
        ("password_recovery_secret", "replace-with-a-long-random-secret"),
        ("password_recovery_secret", "short"),
    ],
)
def test_staging_and_production_reject_weak_optional_secrets(
    environment: str,
    field: str,
    value: str,
) -> None:
    with pytest.raises(ValidationError, match=field.upper()):
        Settings(
            environment=environment,
            database_url=DATABASE_URL,
            jwt_secret=VALID_SECRET,
            **{field: value},
        )


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("admin_database_delete_password", "admin-reset-4vN8qX2dM9pR6tK3wB7sL1zF"),
        ("admin_account_creation_password", "admin-create-7cT3mQ8xN2vR5pL9wD6sH1zB"),
        ("password_recovery_secret", "password-recovery-5rK9xD2mV8qT4nL7wC1sB6zP"),
    ],
)
def test_strong_optional_secrets_are_accepted_in_production(
    field: str,
    value: str,
) -> None:
    settings = Settings(
        environment="production",
        database_url=DATABASE_URL,
        jwt_secret=VALID_SECRET,
        **{field: value},
    )
    assert getattr(settings, field) == value


def test_unset_optional_secrets_remain_disabled_or_use_jwt_fallback() -> None:
    settings = Settings(
        environment="production",
        database_url=DATABASE_URL,
        jwt_secret=VALID_SECRET,
    )
    assert settings.admin_database_delete_password == ""
    assert settings.admin_account_creation_password == ""
    assert settings.password_recovery_secret == ""
