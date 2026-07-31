from collections.abc import Iterator
from uuid import uuid4

import pytest
from pytest import MonkeyPatch

from backend.app.config import get_settings
from backend.app.security.tokens import (
    InvalidAccessTokenError,
    create_access_token,
    create_refresh_token,
    decode_access_token,
    hash_refresh_token,
)


@pytest.fixture(autouse=True)
def authentication_settings(
    monkeypatch: MonkeyPatch,
) -> Iterator[None]:
    monkeypatch.setenv(
        "JWT_SECRET",
        ("test-secret-that-is-longer-than-thirty-two-characters"),
    )

    monkeypatch.setenv(
        "JWT_ISSUER",
        "hypersync-test",
    )

    monkeypatch.setenv(
        "JWT_AUDIENCE",
        "hypersync-test-client",
    )

    monkeypatch.setenv(
        "ACCESS_TOKEN_TTL_MINUTES",
        "60",
    )

    get_settings.cache_clear()

    yield

    get_settings.cache_clear()


def test_access_token_round_trip() -> None:
    user_id = uuid4()
    session_id = uuid4()

    token, expires_in = create_access_token(
        user_id=user_id,
        session_id=session_id,
        role="user",
    )

    claims = decode_access_token(token)

    assert expires_in == 3600
    assert claims.user_id == user_id
    assert claims.session_id == session_id
    assert claims.role == "user"


def test_tampered_access_token_is_rejected() -> None:
    token, _ = create_access_token(
        user_id=uuid4(),
        session_id=uuid4(),
        role="user",
    )

    header, payload, signature = token.split(".")

    replacement = "a" if signature[0] != "a" else "b"

    tampered_token = f"{header}.{payload}.{replacement}{signature[1:]}"

    with pytest.raises(InvalidAccessTokenError):
        decode_access_token(tampered_token)


def test_expired_access_token_is_rejected(
    monkeypatch: MonkeyPatch,
) -> None:
    monkeypatch.setenv(
        "ACCESS_TOKEN_TTL_MINUTES",
        "-1",
    )

    get_settings.cache_clear()

    token, _ = create_access_token(
        user_id=uuid4(),
        session_id=uuid4(),
        role="user",
    )

    with pytest.raises(InvalidAccessTokenError):
        decode_access_token(token)


def test_refresh_tokens_are_random_and_hashed() -> None:
    first_token = create_refresh_token()
    second_token = create_refresh_token()

    first_hash = hash_refresh_token(first_token)

    second_hash = hash_refresh_token(second_token)

    assert first_token != second_token
    assert len(first_token) >= 64

    assert len(first_hash) == 64

    assert first_hash == hash_refresh_token(first_token)

    assert first_hash != second_hash
