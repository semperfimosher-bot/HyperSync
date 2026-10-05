"""Authentication domain helpers and session lifecycle operations."""

import hmac
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from hashlib import sha256
from secrets import randbelow

from fastapi import HTTPException, Request, Response, status
from sqlalchemy import and_, delete, func, or_, select, text
from sqlalchemy.orm import selectinload

from ..config import get_settings
from ..models.account import AccountType, User, UserRole, UserSession
from ..security.passwords import hash_password
from ..security.tokens import create_refresh_token, hash_refresh_token
from ..time_utils import as_utc_aware as _as_utc_aware
from ..api.schemas.auth import UserResponse

REFRESH_ROTATION_GRACE_SECONDS = 120

def normalize_username(username: str) -> str:
    return username.strip().lower()


def missing_account_detail(
    identifier: str,
) -> str:
    if "@" in identifier:
        return (
            "No account exists with that "
            "email address."
        )

    return (
        "No account exists with that "
        "username."
    )


def _password_recovery_secret() -> bytes:
    settings = get_settings()

    secret = (
        settings.password_recovery_secret
        or settings.jwt_secret
    ).strip()

    if len(secret) < 32:
        raise HTTPException(
            status_code=(
                status.HTTP_503_SERVICE_UNAVAILABLE
            ),
            detail=(
                "Password recovery security "
                "is not configured."
            ),
        )

    return secret.encode(
        "utf-8",
    )


def _hash_recovery_otp(
    recovery_id,
    otp: str,
) -> str:
    return hmac.new(
        _password_recovery_secret(),
        f"{recovery_id}:{otp}".encode(),
        sha256,
    ).hexdigest()


def _hash_recovery_reset_token(
    token: str,
) -> str:
    return sha256(
        token.encode(
            "utf-8",
        )
    ).hexdigest()


def _generate_recovery_code() -> str:
    return (
        f"{randbelow(1_000_000):06d}"
    )


async def _registered_user_for_identifier(
    database_session,
    identifier: str,
    *,
    load_profile: bool = False,
) -> User | None:
    statement = (
        select(
            User,
        )
        .where(
            User.account_type
            == AccountType.REGISTERED,
            or_(
                User.username_normalized
                == identifier.lower(),
                func.lower(
                    User.email,
                )
                == identifier.lower(),
            ),
        )
    )

    if load_profile:
        statement = statement.options(
            selectinload(
                User.profile,
            )
        )

    result = await database_session.execute(
        statement
    )

    return result.scalar_one_or_none()


def resolve_registration_role(
    *,
    create_admin: bool,
    provided_admin_password: str | None,
    configured_admin_password: str,
) -> UserRole:
    if not create_admin:
        return UserRole.USER

    configured_password = (
        configured_admin_password
        .strip()
    )

    if (
        len(
            configured_password,
        ) < 24
        or configured_password
        .casefold()
        .startswith(
            "replace-with-",
        )
    ):
        raise HTTPException(
            status_code=(
                status.HTTP_503_SERVICE_UNAVAILABLE
            ),
            detail=(
                "Administrator account creation "
                "requires a strong server-side secret."
            ),
        )

    provided_password = (
        provided_admin_password
        or ""
    )

    if not hmac.compare_digest(
        provided_password,
        configured_password,
    ):
        raise HTTPException(
            status_code=(
                status.HTTP_403_FORBIDDEN
            ),
            detail=(
                "Invalid administrator "
                "verification password."
            ),
        )

    return UserRole.ADMIN


def enforce_admin_creation_authorization(
    *,
    existing_admin: bool,
    requester_role: UserRole | None,
) -> None:
    if (
        existing_admin
        and requester_role
        != UserRole.ADMIN
    ):
        raise HTTPException(
            status_code=(
                status.HTTP_403_FORBIDDEN
            ),
            detail=(
                "Creating additional administrator "
                "accounts requires an authenticated "
                "administrator."
            ),
        )


async def _lock_admin_registration(
    session,
) -> None:
    bind = session.get_bind()

    if (
        bind is not None
        and bind.dialect.name
        == "postgresql"
    ):
        await session.execute(
            text(
                "SELECT pg_advisory_xact_lock("
                "487583953)"
            )
        )


@lru_cache
def _dummy_password_hash() -> str:
    return hash_password(
        "hypersync-dummy-password-value",
    )


def make_user_response(
    user: User,
) -> UserResponse:
    avatar_url = None

    if user.profile is not None and user.profile.avatar_object_key and user.username:
        avatar_url = f"/api/users/{user.username}/avatar"

    return UserResponse(
        id=str(user.id),
        username=user.username or "",
        email=user.email or "",
        display_name=(user.profile.display_name if user.profile else user.username or ""),
        role=user.role.value,
        account_type=user.account_type.value,
        avatar_url=avatar_url,
    )


def set_refresh_cookie(
    response: Response,
    refresh_token: str,
    request: Request,
) -> None:
    settings = get_settings()

    # Trust the ASGI request scheme only. Uvicorn applies
    # X-Forwarded-Proto itself when the immediate proxy is in
    # --forwarded-allow-ips. Reading the raw header here would
    # let an untrusted client influence cookie security.
    request_is_https = (
        request.url.scheme
        == "https"
    )

    response.set_cookie(
        key="hypersync_refresh",
        value=refresh_token,
        max_age=(settings.refresh_token_ttl_days * 24 * 60 * 60),
        httponly=True,
        secure=(
            settings.environment
            == "production"
            or request_is_https
        ),
        samesite="lax",
        path="/api/auth",
    )


async def purge_dead_user_sessions(
    database_session,
    *,
    user_id,
    now: datetime,
    keep_session_id=None,
) -> None:
    conditions = [
        UserSession.user_id == user_id,
        or_(
            UserSession.revoked_at.is_not(
                None,
            ),
            UserSession.expires_at <= now,
        ),
    ]

    if keep_session_id is not None:
        conditions.append(
            UserSession.id
            != keep_session_id
        )

    await database_session.execute(
        delete(
            UserSession,
        ).where(
            *conditions,
        )
    )


async def create_session(
    *,
    database_session,
    user: User,
    request: Request,
):
    settings = get_settings()
    now = datetime.now(
        UTC,
    )

    existing_refresh_token = (
        request.cookies.get(
            "hypersync_refresh",
        )
    )

    if existing_refresh_token:
        existing_token_hash = (
            hash_refresh_token(
                existing_refresh_token,
            )
        )

        existing_result = (
            await database_session.execute(
                select(
                    UserSession,
                )
                .where(
                    or_(
                        UserSession.refresh_token_hash
                        == existing_token_hash,
                        and_(
                            UserSession.previous_refresh_token_hash
                            == existing_token_hash,
                            UserSession.previous_refresh_valid_until
                            > now,
                        ),
                    )
                )
                .with_for_update()
            )
        )

        existing_session = (
            existing_result
            .scalar_one_or_none()
        )

        if existing_session is not None:
            existing_expires_at = (
                _as_utc_aware(
                    existing_session.expires_at,
                )
            )

            same_user = (
                existing_session.user_id
                == user.id
            )

            still_live = (
                existing_session.revoked_at
                is None
                and existing_expires_at
                is not None
                and existing_expires_at
                > now
            )

            if (
                same_user
                and still_live
            ):
                replacement_refresh_token = (
                    create_refresh_token()
                )

                existing_session.previous_refresh_token_hash = (
                    existing_session.refresh_token_hash
                )

                existing_session.previous_refresh_valid_until = (
                    now
                    + timedelta(
                        seconds=(
                            REFRESH_ROTATION_GRACE_SECONDS
                        ),
                    )
                )

                existing_session.refresh_token_hash = (
                    hash_refresh_token(
                        replacement_refresh_token,
                    )
                )

                existing_session.last_used_at = (
                    now
                )

                existing_session.expires_at = (
                    now
                    + timedelta(
                        days=(
                            settings
                            .refresh_token_ttl_days
                        ),
                    )
                )

                existing_session.user_agent = (
                    request.headers.get(
                        "user-agent",
                    )
                )

                existing_session.ip_address = (
                    request.client.host
                    if request.client
                    else None
                )

                await purge_dead_user_sessions(
                    database_session,
                    user_id=user.id,
                    now=now,
                    keep_session_id=(
                        existing_session.id
                    ),
                )

                return (
                    existing_session,
                    replacement_refresh_token,
                )

            # The cookie points at a dead
            # legacy session or this browser
            # is switching accounts. Delete
            # only the row represented by
            # this browser cookie.
            await database_session.delete(
                existing_session,
            )

            await database_session.flush()

    refresh_token = (
        create_refresh_token()
    )

    user_session = UserSession(
        user_id=user.id,
        refresh_token_hash=(
            hash_refresh_token(
                refresh_token,
            )
        ),
        expires_at=(
            now
            + timedelta(
                days=(
                    settings
                    .refresh_token_ttl_days
                ),
            )
        ),
        last_used_at=now,
        user_agent=request.headers.get(
            "user-agent",
        ),
        ip_address=(
            request.client.host
            if request.client
            else None
        ),
    )

    await purge_dead_user_sessions(
        database_session,
        user_id=user.id,
        now=now,
    )

    return (
        user_session,
        refresh_token,
    )
