from pydantic import ValidationError

import pytest

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
