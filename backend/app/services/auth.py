"""Authentication domain helpers and session lifecycle operations."""

import asyncio
import hmac
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from secrets import randbelow

from fastapi import HTTPException, Request, Response, status
from sqlalchemy import and_, delete, func, or_, select, text
from sqlalchemy.orm import selectinload

from ..api.schemas.auth import UserResponse
from ..config import get_settings
from ..database import get_session_factory
from ..models.account import AccountType, User, UserProfile, UserRole, UserSession
from ..security.passwords import (
    hash_password_async,
    verify_password_async,
)
from ..security.tokens import create_refresh_token, hash_refresh_token
from ..time_utils import as_utc_aware as _as_utc_aware

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


_dummy_password_hash_value: str | None = None
_dummy_password_hash_lock = asyncio.Lock()


async def _dummy_password_hash() -> str:
    global _dummy_password_hash_value

    if _dummy_password_hash_value is not None:
        return _dummy_password_hash_value

    async with _dummy_password_hash_lock:
        if _dummy_password_hash_value is None:
            _dummy_password_hash_value = (
                await hash_password_async(
                    "hypersync-dummy-password-value",
                )
            )

    return _dummy_password_hash_value


async def register_account(
    *,
    username: str,
    email: str,
    password: str,
    create_admin: bool,
    admin_verification_password: str | None,
    requester_role: UserRole | None,
    request: Request,
) -> tuple[
    User,
    UserSession,
    str,
]:
    """Create a registered account and its browser session atomically."""

    settings = get_settings()

    normalized_username = normalize_username(
        username,
    )
    normalized_email = (
        email.strip().lower()
    )

    role = resolve_registration_role(
        create_admin=create_admin,
        provided_admin_password=(
            admin_verification_password
        ),
        configured_admin_password=(
            settings
            .admin_account_creation_password
        ),
    )

    # Argon2 completes before a database transaction is opened so CPU work
    # never occupies a connection from the application pool.
    password_hash = await hash_password_async(
        password,
    )

    session_factory = (
        get_session_factory()
    )

    async with session_factory() as session:
        existing = await session.execute(
            select(
                User,
            ).where(
                or_(
                    func.lower(
                        User.email,
                    )
                    == normalized_email,
                    User.username_normalized
                    == normalized_username,
                )
            )
        )

        if (
            existing.scalar_one_or_none()
            is not None
        ):
            raise HTTPException(
                status_code=(
                    status.HTTP_409_CONFLICT
                ),
                detail=(
                    "That email or username is "
                    "already registered."
                ),
            )

        if role == UserRole.ADMIN:
            await _lock_admin_registration(
                session,
            )

            existing_admin_result = (
                await session.execute(
                    select(
                        User.id,
                    )
                    .where(
                        User.role
                        == UserRole.ADMIN,
                        User.is_active.is_(
                            True,
                        ),
                    )
                    .limit(
                        1,
                    )
                )
            )

            enforce_admin_creation_authorization(
                existing_admin=(
                    existing_admin_result
                    .scalar_one_or_none()
                    is not None
                ),
                requester_role=requester_role,
            )

        user = User(
            account_type=(
                AccountType.REGISTERED
            ),
            email=normalized_email,
            username=username.strip(),
            username_normalized=(
                normalized_username
            ),
            password_hash=password_hash,
            role=role,
            is_active=True,
        )

        session.add(
            user,
        )

        await session.flush()

        profile = UserProfile(
            user_id=user.id,
            display_name=(
                username.strip()
            ),
        )

        session.add(
            profile,
        )

        user.profile = profile

        user_session, refresh_token = (
            await create_session(
                database_session=session,
                user=user,
                request=request,
            )
        )

        session.add(
            user_session,
        )

        user.last_login_at = (
            datetime.now(
                UTC,
            )
        )

        await session.commit()

        return (
            user,
            user_session,
            refresh_token,
        )


async def authenticate_password_account(
    *,
    identifier: str,
    password: str,
    request: Request,
) -> tuple[
    User,
    UserSession,
    str,
]:
    """Authenticate a registered account and create/reuse its browser session."""

    session_factory = (
        get_session_factory()
    )

    async with session_factory() as session:
        user = await _registered_user_for_identifier(
            session,
            identifier,
            load_profile=True,
        )

        # Finish the read transaction before Argon2 verification. Application
        # sessions use expire_on_commit=False, so the loaded account remains
        # usable while the connection returns to the pool.
        await session.commit()

        password_hash = (
            user.password_hash
            if (
                user is not None
                and user.password_hash
            )
            else await _dummy_password_hash()
        )

        password_ok = (
            await verify_password_async(
                password,
                password_hash,
            )
        )

        if (
            user is None
            or not user.is_active
            or not user.password_hash
            or not password_ok
        ):
            raise HTTPException(
                status_code=(
                    status.HTTP_401_UNAUTHORIZED
                ),
                detail=(
                    "Invalid username/email "
                    "or password."
                ),
            )

        user_session, refresh_token = (
            await create_session(
                database_session=session,
                user=user,
                request=request,
            )
        )

        session.add(
            user_session,
        )

        user.last_login_at = (
            datetime.now(
                UTC,
            )
        )

        await session.commit()

        return (
            user,
            user_session,
            refresh_token,
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


async def _refresh_session_for_token(
    database_session,
    refresh_token: str,
    *,
    now: datetime,
    lock: bool = False,
) -> UserSession | None:
    presented_token_hash = (
        hash_refresh_token(
            refresh_token,
        )
    )

    statement = select(
        UserSession,
    ).where(
        or_(
            UserSession.refresh_token_hash
            == presented_token_hash,
            and_(
                UserSession.previous_refresh_token_hash
                == presented_token_hash,
                UserSession.previous_refresh_valid_until
                > now,
            ),
        )
    )

    if lock:
        statement = (
            statement
            .with_for_update()
        )

    result = await database_session.execute(
        statement,
    )

    return (
        result
        .scalar_one_or_none()
    )


async def _rotate_refresh_session_secret(
    database_session,
    user_session: UserSession,
    request: Request,
    *,
    now: datetime,
) -> str:
    settings = get_settings()

    replacement_refresh_token = (
        create_refresh_token()
    )

    user_session.previous_refresh_token_hash = (
        user_session.refresh_token_hash
    )

    user_session.previous_refresh_valid_until = (
        now
        + timedelta(
            seconds=(
                REFRESH_ROTATION_GRACE_SECONDS
            ),
        )
    )

    user_session.refresh_token_hash = (
        hash_refresh_token(
            replacement_refresh_token,
        )
    )

    user_session.last_used_at = now

    user_session.expires_at = (
        now
        + timedelta(
            days=(
                settings
                .refresh_token_ttl_days
            ),
        )
    )

    user_session.user_agent = (
        request.headers.get(
            "user-agent",
        )
    )

    user_session.ip_address = (
        request.client.host
        if request.client
        else None
    )

    await purge_dead_user_sessions(
        database_session,
        user_id=user_session.user_id,
        now=now,
        keep_session_id=(
            user_session.id
        ),
    )

    return replacement_refresh_token


async def refresh_authenticated_session(
    *,
    database_session,
    refresh_token: str,
    request: Request,
) -> tuple[
    User,
    UserSession,
    str,
]:
    now = datetime.now(
        UTC,
    )

    current_session = (
        await _refresh_session_for_token(
            database_session,
            refresh_token,
            now=now,
            lock=True,
        )
    )

    if current_session is None:
        raise HTTPException(
            status_code=(
                status.HTTP_401_UNAUTHORIZED
            ),
            detail=(
                "Refresh token is invalid."
            ),
        )

    if (
        current_session.revoked_at
        is not None
    ):
        await database_session.delete(
            current_session,
        )

        await database_session.commit()

        raise HTTPException(
            status_code=(
                status.HTTP_401_UNAUTHORIZED
            ),
            detail=(
                "Refresh session is no longer active."
            ),
        )

    current_expires_at = (
        _as_utc_aware(
            current_session.expires_at,
        )
    )

    if (
        current_expires_at
        is None
        or current_expires_at
        <= now
    ):
        await database_session.delete(
            current_session,
        )

        await database_session.commit()

        raise HTTPException(
            status_code=(
                status.HTTP_401_UNAUTHORIZED
            ),
            detail=(
                "Refresh token has expired."
            ),
        )

    user_result = await database_session.execute(
        select(
            User,
        )
        .options(
            selectinload(
                User.profile,
            ),
        )
        .where(
            User.id
            == current_session.user_id,
            User.is_active.is_(
                True,
            ),
        )
    )

    user = (
        user_result
        .scalar_one_or_none()
    )

    if user is None:
        await database_session.delete(
            current_session,
        )

        await database_session.commit()

        raise HTTPException(
            status_code=(
                status.HTTP_401_UNAUTHORIZED
            ),
            detail=(
                "User account is unavailable."
            ),
        )

    replacement_refresh_token = (
        await _rotate_refresh_session_secret(
            database_session,
            current_session,
            request,
            now=now,
        )
    )

    await database_session.commit()

    return (
        user,
        current_session,
        replacement_refresh_token,
    )


async def delete_refresh_session(
    *,
    database_session,
    refresh_token: str,
) -> None:
    now = datetime.now(
        UTC,
    )

    current_session = (
        await _refresh_session_for_token(
            database_session,
            refresh_token,
            now=now,
            lock=True,
        )
    )

    if current_session is None:
        return

    await database_session.delete(
        current_session,
    )

    await database_session.commit()


async def delete_all_refresh_sessions(
    *,
    database_session,
    refresh_token: str,
) -> None:
    now = datetime.now(
        UTC,
    )

    current_session = (
        await _refresh_session_for_token(
            database_session,
            refresh_token,
            now=now,
            lock=True,
        )
    )

    if current_session is None:
        return

    await database_session.execute(
        delete(
            UserSession,
        ).where(
            UserSession.user_id
            == current_session.user_id,
        )
    )

    await database_session.commit()


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
        existing_session = (
            await _refresh_session_for_token(
                database_session,
                existing_refresh_token,
                now=now,
                lock=True,
            )
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
                    await _rotate_refresh_session_secret(
                        database_session,
                        existing_session,
                        request,
                        now=now,
                    )
                )

                return (
                    existing_session,
                    replacement_refresh_token,
                )

            # The cookie points at a dead legacy session or this browser
            # is switching accounts. Delete only the row represented by
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
