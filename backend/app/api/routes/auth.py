from datetime import UTC, datetime, timedelta
from hashlib import sha256
import hmac
from secrets import randbelow, token_urlsafe
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.orm import selectinload

from ...config import get_settings
from ...database import get_session_factory
from ...models.account import (
    AccountType,
    PasswordRecovery,
    User,
    UserProfile,
    UserRole,
    UserSession,
)
from ...security.passwords import hash_password, verify_password
from ...security.rate_limit import (
    enforce_rate_limit,
)
from ...services.admin_notifications import (
    record_admin_activity,
)
from ...services.email import (
    EmailDeliveryError,
    send_password_recovery_email,
)
from ...security.tokens import (
    create_access_token,
    create_refresh_token,
    hash_refresh_token,
)

router = APIRouter(
    prefix="/auth",
    tags=["authentication"],
)


REFRESH_ROTATION_GRACE_SECONDS = 120


class RegisterRequest(BaseModel):
    username: str = Field(
        min_length=3,
        max_length=32,
    )

    email: EmailStr

    password: str = Field(
        min_length=8,
        max_length=128,
    )

    create_admin: bool = False

    admin_verification_password: str | None = Field(
        default=None,
        max_length=256,
    )


class LoginRequest(BaseModel):
    username: str = Field(
        min_length=1,
        max_length=320,
    )

    password: str = Field(
        min_length=1,
        max_length=128,
    )


class PasswordRecoveryRequest(BaseModel):
    identifier: str = Field(
        min_length=1,
        max_length=320,
    )


class PasswordRecoveryOtpRequest(BaseModel):
    identifier: str = Field(
        min_length=1,
        max_length=320,
    )

    otp: str = Field(
        min_length=6,
        max_length=6,
        pattern=r"^\d{6}$",
    )


class PasswordResetRequest(BaseModel):
    token: str = Field(
        min_length=20,
        max_length=512,
    )

    new_password: str = Field(
        min_length=8,
        max_length=128,
    )


class RecoveryDispatchResponse(BaseModel):
    detail: str
    expires_in: int


class MessageResponse(BaseModel):
    detail: str


class UserResponse(BaseModel):
    id: str
    username: str
    email: str
    display_name: str
    role: str
    account_type: str
    avatar_url: str | None = None


class AuthResponse(BaseModel):
    access_token: str
    token_type: str
    expires_in: int
    user: UserResponse


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
        f"{recovery_id}:{otp}".encode(
            "utf-8",
        ),
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

    if not configured_password:
        raise HTTPException(
            status_code=(
                status.HTTP_503_SERVICE_UNAVAILABLE
            ),
            detail=(
                "Administrator account creation "
                "is not configured."
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

    forwarded_proto = (
        request.headers.get(
            "x-forwarded-proto",
        )
        or ""
    )

    request_is_https = (
        request.url.scheme
        == "https"
        or forwarded_proto
        .split(
            ",",
            1,
        )[0]
        .strip()
        .lower()
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


def _as_utc_aware(
    value: datetime | None,
) -> datetime | None:
    if value is None:
        return None

    if value.tzinfo is None:
        return value.replace(
            tzinfo=UTC,
        )

    return value.astimezone(
        UTC,
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


@router.post(
    "/register",
    response_model=AuthResponse,
    status_code=status.HTTP_201_CREATED,
)
async def register(
    payload: RegisterRequest,
    request: Request,
    response: Response,
):
    settings = get_settings()

    enforce_rate_limit(
        request,
        scope="auth-register",
        limit=(
            settings
            .auth_register_rate_limit
        ),
        window_seconds=(
            settings
            .auth_register_rate_window_seconds
        ),
    )

    if payload.create_admin:
        enforce_rate_limit(
            request,
            scope="auth-admin-register",
            limit=(
                settings
                .auth_admin_register_rate_limit
            ),
            window_seconds=(
                settings
                .auth_admin_register_rate_window_seconds
            ),
        )

    session_factory = get_session_factory()

    username = normalize_username(
        payload.username,
    )

    email = str(payload.email).strip().lower()

    async with session_factory() as session:
        existing = await session.execute(
            select(User).where(
                (
                    func.lower(
                        User.email,
                    )
                    == email
                )
                | (User.username_normalized == username)
            )
        )

        if existing.scalar_one_or_none() is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=("That email or username is already registered."),
            )

        role = resolve_registration_role(
            create_admin=(
                payload.create_admin
            ),
            provided_admin_password=(
                payload
                .admin_verification_password
            ),
            configured_admin_password=(
                settings
                .admin_account_creation_password
            ),
        )

        user = User(
            account_type=AccountType.REGISTERED,
            email=email,
            username=payload.username.strip(),
            username_normalized=username,
            password_hash=hash_password(
                payload.password,
            ),
            role=role,
            is_active=True,
        )

        session.add(user)

        await session.flush()

        profile = UserProfile(
            user_id=user.id,
            display_name=payload.username.strip(),
        )

        session.add(profile)

        user.profile = profile

        user_session, refresh_token = await create_session(
            database_session=session,
            user=user,
            request=request,
        )

        session.add(user_session)

        user.last_login_at = datetime.now(UTC)

        await session.commit()

        await record_admin_activity(
            kind="account",
            title="New user created",
            body=(
                "@"
                + str(
                    user.username
                    or "unknown",
                )
                + " created a registered "
                + user.role.value
                + " account."
            ),
            actor_user_id=user.id,
            actor_username=user.username,
        )

        access_token, expires_in = create_access_token(
            user_id=user.id,
            session_id=user_session.id,
            role=user.role.value,
        )

        set_refresh_cookie(
            response,
            refresh_token,
            request,
        )

        return AuthResponse(
            access_token=access_token,
            token_type="bearer",
            expires_in=expires_in,
            user=make_user_response(user),
        )


@router.post(
    "/login",
    response_model=AuthResponse,
)
async def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
):
    settings = get_settings()

    identifier = payload.username.strip()

    enforce_rate_limit(
        request,
        scope="auth-login-ip",
        limit=(
            settings
            .auth_login_ip_rate_limit
        ),
        window_seconds=(
            settings
            .auth_login_rate_window_seconds
        ),
    )

    enforce_rate_limit(
        request,
        scope="auth-login-identity",
        identity=identifier,
        limit=(
            settings
            .auth_login_rate_limit
        ),
        window_seconds=(
            settings
            .auth_login_rate_window_seconds
        ),
    )

    session_factory = get_session_factory()

    async with session_factory() as session:
        user = await _registered_user_for_identifier(
            session,
            identifier,
            load_profile=True,
        )

        if user is None:
            raise HTTPException(
                status_code=(
                    status.HTTP_404_NOT_FOUND
                ),
                detail=missing_account_detail(
                    identifier,
                ),
            )

        if not user.is_active:
            raise HTTPException(
                status_code=(
                    status.HTTP_403_FORBIDDEN
                ),
                detail=(
                    "This account is disabled."
                ),
            )

        if not user.password_hash:
            raise HTTPException(
                status_code=(
                    status.HTTP_409_CONFLICT
                ),
                detail=(
                    "This account does not have "
                    "a password set."
                ),
            )

        if not verify_password(
            payload.password,
            user.password_hash,
        ):
            raise HTTPException(
                status_code=(
                    status.HTTP_401_UNAUTHORIZED
                ),
                detail=(
                    "Incorrect password."
                ),
            )

        user_session, refresh_token = await create_session(
            database_session=session,
            user=user,
            request=request,
        )

        session.add(user_session)

        user.last_login_at = datetime.now(UTC)

        await session.commit()

        access_token, expires_in = create_access_token(
            user_id=user.id,
            session_id=user_session.id,
            role=user.role.value,
        )

        set_refresh_cookie(
            response,
            refresh_token,
            request,
        )

        return AuthResponse(
            access_token=access_token,
            token_type="bearer",
            expires_in=expires_in,
            user=make_user_response(user),
        )


@router.post(
    "/password-recovery/request",
    response_model=RecoveryDispatchResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def request_password_recovery(
    payload: PasswordRecoveryRequest,
    request: Request,
):
    settings = get_settings()
    identifier = payload.identifier.strip()

    enforce_rate_limit(
        request,
        scope="password-recovery-request-ip",
        limit=(
            settings
            .auth_password_recovery_ip_rate_limit
        ),
        window_seconds=(
            settings
            .auth_password_recovery_rate_window_seconds
        ),
    )

    enforce_rate_limit(
        request,
        scope="password-recovery-request-identity",
        identity=identifier,
        limit=(
            settings
            .auth_password_recovery_rate_limit
        ),
        window_seconds=(
            settings
            .auth_password_recovery_rate_window_seconds
        ),
    )

    session_factory = get_session_factory()

    async with session_factory() as session:
        user = await _registered_user_for_identifier(
            session,
            identifier,
        )

        if user is None:
            raise HTTPException(
                status_code=(
                    status.HTTP_404_NOT_FOUND
                ),
                detail=missing_account_detail(
                    identifier,
                ),
            )

        if not user.is_active:
            raise HTTPException(
                status_code=(
                    status.HTTP_403_FORBIDDEN
                ),
                detail=(
                    "This account is disabled."
                ),
            )

        if not user.email:
            raise HTTPException(
                status_code=(
                    status.HTTP_409_CONFLICT
                ),
                detail=(
                    "This account does not have "
                    "an email address."
                ),
            )

        ttl_minutes = max(
            1,
            int(
                settings
                .password_recovery_ttl_minutes
            ),
        )

        now = datetime.now(
            UTC,
        )

        recovery_id = uuid4()
        otp_code = (
            _generate_recovery_code()
        )
        reset_token = (
            token_urlsafe(
                32,
            )
        )

        recovery = PasswordRecovery(
            id=recovery_id,
            user_id=user.id,
            otp_hash=(
                _hash_recovery_otp(
                    recovery_id,
                    otp_code,
                )
            ),
            reset_token_hash=(
                _hash_recovery_reset_token(
                    reset_token,
                )
            ),
            expires_at=(
                now
                + timedelta(
                    minutes=ttl_minutes,
                )
            ),
            attempts=0,
        )

        await session.execute(
            delete(
                PasswordRecovery,
            ).where(
                PasswordRecovery.user_id
                == user.id,
            )
        )

        session.add(
            recovery,
        )

        await session.commit()

        try:
            await send_password_recovery_email(
                recipient_email=user.email,
                username=(
                    user.username
                    or "HyperSync user"
                ),
                otp_code=otp_code,
                reset_token=reset_token,
                expires_minutes=ttl_minutes,
            )
        except EmailDeliveryError as exc:
            await session.execute(
                delete(
                    PasswordRecovery,
                ).where(
                    PasswordRecovery.id
                    == recovery_id,
                )
            )

            await session.commit()

            raise HTTPException(
                status_code=(
                    status.HTTP_503_SERVICE_UNAVAILABLE
                ),
                detail=(
                    "Recovery email could not "
                    "be sent. Try again shortly."
                ),
            ) from exc

        return RecoveryDispatchResponse(
            detail=(
                "A recovery code and password "
                "reset link were sent to the "
                "email address on this account."
            ),
            expires_in=(
                ttl_minutes
                * 60
            ),
        )


@router.post(
    "/password-recovery/verify-otp",
    response_model=AuthResponse,
)
async def verify_password_recovery_otp(
    payload: PasswordRecoveryOtpRequest,
    request: Request,
    response: Response,
):
    settings = get_settings()
    identifier = payload.identifier.strip()

    enforce_rate_limit(
        request,
        scope="password-recovery-verify-ip",
        limit=(
            max(
                settings
                .auth_password_recovery_ip_rate_limit,
                1,
            )
            * 2
        ),
        window_seconds=(
            settings
            .auth_password_recovery_rate_window_seconds
        ),
    )

    enforce_rate_limit(
        request,
        scope="password-recovery-verify-identity",
        identity=identifier,
        limit=(
            max(
                settings
                .auth_password_recovery_rate_limit,
                1,
            )
            * 2
        ),
        window_seconds=(
            settings
            .auth_password_recovery_rate_window_seconds
        ),
    )

    session_factory = get_session_factory()

    async with session_factory() as session:
        user = await _registered_user_for_identifier(
            session,
            identifier,
            load_profile=True,
        )

        if user is None:
            raise HTTPException(
                status_code=(
                    status.HTTP_404_NOT_FOUND
                ),
                detail=missing_account_detail(
                    identifier,
                ),
            )

        if not user.is_active:
            raise HTTPException(
                status_code=(
                    status.HTTP_403_FORBIDDEN
                ),
                detail=(
                    "This account is disabled."
                ),
            )

        recovery_result = (
            await session.execute(
                select(
                    PasswordRecovery,
                )
                .where(
                    PasswordRecovery.user_id
                    == user.id,
                    PasswordRecovery.consumed_at
                    .is_(
                        None,
                    ),
                )
                .order_by(
                    PasswordRecovery.created_at
                    .desc()
                )
                .limit(
                    1,
                )
                .with_for_update()
            )
        )

        recovery = (
            recovery_result
            .scalar_one_or_none()
        )

        now = datetime.now(
            UTC,
        )

        if recovery is None:
            raise HTTPException(
                status_code=(
                    status.HTTP_410_GONE
                ),
                detail=(
                    "No active recovery code "
                    "exists. Request a new one."
                ),
            )

        expires_at = _as_utc_aware(
            recovery.expires_at,
        )

        if (
            expires_at is None
            or expires_at <= now
        ):
            await session.execute(
                delete(
                    PasswordRecovery,
                ).where(
                    PasswordRecovery.id
                    == recovery.id,
                )
            )
            await session.commit()

            raise HTTPException(
                status_code=(
                    status.HTTP_410_GONE
                ),
                detail=(
                    "Recovery code has expired. "
                    "Request a new one."
                ),
            )

        max_attempts = max(
            1,
            int(
                settings
                .password_recovery_max_attempts
            ),
        )

        if recovery.attempts >= max_attempts:
            raise HTTPException(
                status_code=(
                    status.HTTP_429_TOO_MANY_REQUESTS
                ),
                detail=(
                    "Too many incorrect recovery "
                    "codes. Request a new code."
                ),
            )

        expected_hash = (
            _hash_recovery_otp(
                recovery.id,
                payload.otp,
            )
        )

        if not hmac.compare_digest(
            expected_hash,
            recovery.otp_hash,
        ):
            recovery.attempts += 1
            await session.commit()

            if recovery.attempts >= max_attempts:
                raise HTTPException(
                    status_code=(
                        status.HTTP_429_TOO_MANY_REQUESTS
                    ),
                    detail=(
                        "Too many incorrect recovery "
                        "codes. Request a new code."
                    ),
                )

            raise HTTPException(
                status_code=(
                    status.HTTP_401_UNAUTHORIZED
                ),
                detail=(
                    "Recovery code is incorrect."
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

        user.last_login_at = now
        user.is_email_verified = True

        await session.execute(
            delete(
                PasswordRecovery,
            ).where(
                PasswordRecovery.user_id
                == user.id,
            )
        )

        await session.commit()

        access_token, expires_in = (
            create_access_token(
                user_id=user.id,
                session_id=user_session.id,
                role=user.role.value,
            )
        )

        set_refresh_cookie(
            response,
            refresh_token,
            request,
        )

        return AuthResponse(
            access_token=access_token,
            token_type="bearer",
            expires_in=expires_in,
            user=make_user_response(
                user,
            ),
        )


@router.post(
    "/password-recovery/reset",
    response_model=MessageResponse,
)
async def reset_password_from_recovery_link(
    payload: PasswordResetRequest,
    request: Request,
    response: Response,
):
    settings = get_settings()
    token = payload.token.strip()

    enforce_rate_limit(
        request,
        scope="password-recovery-reset-ip",
        limit=(
            settings
            .auth_password_recovery_ip_rate_limit
        ),
        window_seconds=(
            settings
            .auth_password_recovery_rate_window_seconds
        ),
    )

    enforce_rate_limit(
        request,
        scope="password-recovery-reset-token",
        identity=token,
        limit=(
            max(
                settings
                .auth_password_recovery_rate_limit,
                1,
            )
        ),
        window_seconds=(
            settings
            .auth_password_recovery_rate_window_seconds
        ),
    )

    session_factory = get_session_factory()

    async with session_factory() as session:
        recovery_result = (
            await session.execute(
                select(
                    PasswordRecovery,
                )
                .where(
                    PasswordRecovery.reset_token_hash
                    == _hash_recovery_reset_token(
                        token,
                    ),
                    PasswordRecovery.consumed_at
                    .is_(
                        None,
                    ),
                )
                .limit(
                    1,
                )
                .with_for_update()
            )
        )

        recovery = (
            recovery_result
            .scalar_one_or_none()
        )

        now = datetime.now(
            UTC,
        )

        if recovery is None:
            raise HTTPException(
                status_code=(
                    status.HTTP_410_GONE
                ),
                detail=(
                    "This password reset link "
                    "is invalid or has expired."
                ),
            )

        expires_at = _as_utc_aware(
            recovery.expires_at,
        )

        if (
            expires_at is None
            or expires_at <= now
        ):
            await session.execute(
                delete(
                    PasswordRecovery,
                ).where(
                    PasswordRecovery.id
                    == recovery.id,
                )
            )
            await session.commit()

            raise HTTPException(
                status_code=(
                    status.HTTP_410_GONE
                ),
                detail=(
                    "This password reset link "
                    "has expired. Request a new one."
                ),
            )

        user_result = (
            await session.execute(
                select(
                    User,
                )
                .where(
                    User.id
                    == recovery.user_id,
                    User.account_type
                    == AccountType.REGISTERED,
                )
                .limit(
                    1,
                )
            )
        )

        user = (
            user_result
            .scalar_one_or_none()
        )

        if user is None:
            raise HTTPException(
                status_code=(
                    status.HTTP_404_NOT_FOUND
                ),
                detail=(
                    "The account for this reset "
                    "link no longer exists."
                ),
            )

        if not user.is_active:
            raise HTTPException(
                status_code=(
                    status.HTTP_403_FORBIDDEN
                ),
                detail=(
                    "This account is disabled."
                ),
            )

        user.password_hash = (
            hash_password(
                payload.new_password,
            )
        )
        user.is_email_verified = True

        await session.execute(
            delete(
                UserSession,
            ).where(
                UserSession.user_id
                == user.id,
            )
        )

        await session.execute(
            delete(
                PasswordRecovery,
            ).where(
                PasswordRecovery.user_id
                == user.id,
            )
        )

        await session.commit()

    response.delete_cookie(
        key="hypersync_refresh",
        path="/api/auth",
    )

    return MessageResponse(
        detail=(
            "Password updated. Sign in with "
            "your new password."
        ),
    )


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
):
    refresh_token = request.cookies.get(
        "hypersync_refresh",
    )

    if refresh_token:
        session_factory = (
            get_session_factory()
        )

        async with session_factory() as session:
            result = await session.execute(
                select(
                    UserSession,
                ).where(
                    UserSession.refresh_token_hash
                    == hash_refresh_token(
                        refresh_token,
                    )
                )
            )

            user_session = (
                result.scalar_one_or_none()
            )

            if user_session is not None:
                await session.delete(
                    user_session,
                )

                await session.commit()

    response.delete_cookie(
        key="hypersync_refresh",
        path="/api/auth",
    )

    return {
        "status": "logged_out",
    }


@router.post(
    "/refresh",
    response_model=AuthResponse,
)
async def refresh(
    request: Request,
    response: Response,
):
    settings = get_settings()

    enforce_rate_limit(
        request,
        scope="auth-refresh",
        limit=(
            settings
            .auth_refresh_rate_limit
        ),
        window_seconds=(
            settings
            .auth_refresh_rate_window_seconds
        ),
    )

    refresh_token = request.cookies.get(
        "hypersync_refresh",
    )

    if not refresh_token:
        raise HTTPException(
            status_code=(
                status.HTTP_401_UNAUTHORIZED
            ),
            detail=(
                "Refresh token is missing."
            ),
        )

    session_factory = (
        get_session_factory()
    )

    now = datetime.now(
        UTC,
    )

    presented_token_hash = (
        hash_refresh_token(
            refresh_token,
        )
    )

    async with session_factory() as session:
        result = await session.execute(
            select(
                UserSession,
            )
            .where(
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
            .with_for_update()
        )

        current_session = (
            result.scalar_one_or_none()
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

        # Old builds left rotated/revoked
        # rows behind. A request carrying
        # one of those dead tokens deletes
        # only that dead row. It must never
        # revoke or delete the live replacement.
        if (
            current_session.revoked_at
            is not None
        ):
            await session.delete(
                current_session,
            )

            await session.commit()

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
            await session.delete(
                current_session,
            )

            await session.commit()

            raise HTTPException(
                status_code=(
                    status.HTTP_401_UNAUTHORIZED
                ),
                detail=(
                    "Refresh token has expired."
                ),
            )

        user_result = await session.execute(
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
            user_result.scalar_one_or_none()
        )

        if user is None:
            await session.delete(
                current_session,
            )

            await session.commit()

            raise HTTPException(
                status_code=(
                    status.HTTP_401_UNAUTHORIZED
                ),
                detail=(
                    "User account is unavailable."
                ),
            )

        # Keep one stable database session
        # for this browser while still
        # rotating the secret itself. The
        # immediately previous secret stays
        # valid briefly so overlapping tabs
        # cannot kill the legitimate session.
        replacement_refresh_token = (
            create_refresh_token()
        )

        current_session.previous_refresh_token_hash = (
            current_session.refresh_token_hash
        )

        current_session.previous_refresh_valid_until = (
            now
            + timedelta(
                seconds=(
                    REFRESH_ROTATION_GRACE_SECONDS
                ),
            )
        )

        current_session.refresh_token_hash = (
            hash_refresh_token(
                replacement_refresh_token,
            )
        )

        current_session.last_used_at = (
            now
        )

        current_session.expires_at = (
            now
            + timedelta(
                days=(
                    settings
                    .refresh_token_ttl_days
                ),
            )
        )

        current_session.user_agent = (
            request.headers.get(
                "user-agent",
            )
        )

        current_session.ip_address = (
            request.client.host
            if request.client
            else None
        )

        await purge_dead_user_sessions(
            session,
            user_id=user.id,
            now=now,
            keep_session_id=(
                current_session.id
            ),
        )

        await session.commit()

        access_token, expires_in = (
            create_access_token(
                user_id=user.id,
                session_id=(
                    current_session.id
                ),
                role=user.role.value,
            )
        )

        # Roll the HttpOnly browser secret
        # forward without changing the
        # database session identity.
        set_refresh_cookie(
            response,
            replacement_refresh_token,
            request,
        )

        return AuthResponse(
            access_token=access_token,
            token_type="bearer",
            expires_in=expires_in,
            user=make_user_response(
                user,
            ),
        )


@router.post("/logout-all")
async def logout_all(
    request: Request,
    response: Response,
):
    refresh_token = request.cookies.get(
        "hypersync_refresh",
    )

    if refresh_token:
        session_factory = get_session_factory()

        async with session_factory() as session:
            result = await session.execute(
                select(UserSession).where(
                    UserSession.refresh_token_hash
                    == hash_refresh_token(
                        refresh_token,
                    )
                )
            )

            current_session = result.scalar_one_or_none()

            if current_session:
                await session.execute(
                    delete(
                        UserSession,
                    ).where(
                        UserSession.user_id
                        == current_session.user_id,
                    )
                )

                await session.commit()

    response.delete_cookie(
        key="hypersync_refresh",
        path="/api/auth",
    )

    return {
        "status": "logged_out_everywhere",
    }
