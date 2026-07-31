from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from secrets import token_urlsafe
from uuid import UUID, uuid4

import jwt
from jwt.exceptions import InvalidTokenError

from ..config import get_settings


class InvalidAccessTokenError(ValueError):
    """Raised when an access token is invalid or expired."""


@dataclass(frozen=True, slots=True)
class AccessTokenClaims:
    user_id: UUID
    session_id: UUID
    role: str


def create_access_token(
    *,
    user_id: UUID,
    session_id: UUID,
    role: str,
) -> tuple[str, int]:
    """Create a signed access token and return it with its TTL."""

    settings = get_settings()
    secret = _validated_jwt_secret()

    now = datetime.now(UTC)
    expires_in = settings.access_token_ttl_minutes * 60
    expires_at = now + timedelta(
        seconds=expires_in,
    )

    payload = {
        "sub": str(user_id),
        "sid": str(session_id),
        "role": role,
        "type": "access",
        "jti": str(uuid4()),
        "iat": now,
        "nbf": now,
        "exp": expires_at,
        "iss": settings.jwt_issuer,
        "aud": settings.jwt_audience,
    }

    token = jwt.encode(
        payload,
        secret,
        algorithm=settings.jwt_algorithm,
    )

    return token, expires_in


def decode_access_token(
    token: str,
) -> AccessTokenClaims:
    """Verify an access token and return its identity claims."""

    settings = get_settings()

    try:
        payload = jwt.decode(
            token,
            _validated_jwt_secret(),
            algorithms=[
                settings.jwt_algorithm,
            ],
            audience=settings.jwt_audience,
            issuer=settings.jwt_issuer,
            options={
                "require": [
                    "sub",
                    "sid",
                    "role",
                    "type",
                    "jti",
                    "iat",
                    "nbf",
                    "exp",
                    "iss",
                    "aud",
                ]
            },
        )

        if payload["type"] != "access":
            raise InvalidAccessTokenError("Token is not an access token.")

        return AccessTokenClaims(
            user_id=UUID(payload["sub"]),
            session_id=UUID(payload["sid"]),
            role=str(payload["role"]),
        )
    except (
        InvalidTokenError,
        KeyError,
        TypeError,
        ValueError,
    ) as exc:
        if isinstance(
            exc,
            InvalidAccessTokenError,
        ):
            raise

        raise InvalidAccessTokenError("Access token is invalid or expired.") from exc


def create_refresh_token() -> str:
    """Create a random opaque refresh token."""

    return token_urlsafe(48)


def hash_refresh_token(
    token: str,
) -> str:
    """Hash a refresh token before storing it."""

    return sha256(token.encode("utf-8")).hexdigest()


def _validated_jwt_secret() -> str:
    secret = get_settings().jwt_secret

    if len(secret) < 32:
        raise RuntimeError(
            "JWT_SECRET must contain at least 32 characters before authentication is used."
        )

    return secret
