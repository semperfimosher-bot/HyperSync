import hmac
import re
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select, text
from sqlalchemy.orm import selectinload

from ...config import get_settings
from ...database import get_session_factory
from ...models.account import (
    AccountType,
    User,
    UserProfile,
    UserRole,
    UserSession,
)
from ...security.passwords import hash_password, verify_password
from ...security.rate_limit import enforce_rate_limit
from ...security.tokens import (
    create_access_token,
    create_refresh_token,
    hash_refresh_token,
)

router = APIRouter(
    prefix="/auth",
    tags=["authentication"],
)


class RegisterRequest(BaseModel):
    username: str = Field(
        min_length=3,
        max_length=32,
    )

    email: EmailStr

    password: str = Field(
        min_length=12,
        max_length=128,
    )

    admin_setup_code: str | None = Field(
        default=None,
        max_length=256,
    )


class BootstrapStatusResponse(BaseModel):
    admin_exists: bool
    registration_mode: str


class LoginRequest(BaseModel):
    username: str = Field(
        min_length=1,
        max_length=320,
    )

    password: str = Field(
        min_length=1,
        max_length=128,
    )


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


USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9_.-]+$")


def normalize_username(username: str) -> str:
    return username.strip().casefold()


def validate_username(username: str) -> str:
    cleaned = username.strip()

    if not USERNAME_PATTERN.fullmatch(cleaned):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "Username may contain only letters, numbers, dots, "
                "underscores, and hyphens."
            ),
        )

    return cleaned


async def _admin_exists(session) -> bool:
    result = await session.execute(
        select(User.id)
        .where(
            User.account_type == AccountType.REGISTERED,
            User.role == UserRole.ADMIN,
        )
        .limit(1)
    )

    return result.scalar_one_or_none() is not None


async def _lock_admin_bootstrap(session) -> None:
    bind = session.get_bind()

    if bind is not None and bind.dialect.name == "postgresql":
        # Serialize the one-time bootstrap decision across backend workers.
        await session.execute(
            text("SELECT pg_advisory_xact_lock(37420260921)")
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
) -> None:
    settings = get_settings()

    response.set_cookie(
        key="hypersync_refresh",
        value=refresh_token,
        max_age=(settings.refresh_token_ttl_days * 24 * 60 * 60),
        httponly=True,
        secure=settings.environment == "production",
        samesite="lax",
        path="/api/auth",
    )


async def create_session(
    *,
    user: User,
    request: Request,
):
    settings = get_settings()

    refresh_token = create_refresh_token()

    session = UserSession(
        user_id=user.id,
        refresh_token_hash=hash_refresh_token(
            refresh_token,
        ),
        expires_at=(
            datetime.now(UTC)
            + timedelta(
                days=settings.refresh_token_ttl_days,
            )
        ),
        user_agent=request.headers.get(
            "user-agent",
        ),
        ip_address=(request.client.host if request.client else None),
    )

    return session, refresh_token


@router.get(
    "/bootstrap-status",
    response_model=BootstrapStatusResponse,
)
async def bootstrap_status():
    session_factory = get_session_factory()

    async with session_factory() as session:
        exists = await _admin_exists(session)

    return BootstrapStatusResponse(
        admin_exists=exists,
        registration_mode="user" if exists else "admin_setup",
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
        bucket="register",
        limit=settings.auth_register_attempts_per_15_minutes,
        window_seconds=15 * 60,
    )

    session_factory = get_session_factory()

    display_username = validate_username(
        payload.username,
    )

    username = normalize_username(
        display_username,
    )

    email = str(payload.email).strip().lower()

    async with session_factory() as session:
        await _lock_admin_bootstrap(session)

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
                detail="Unable to create account with those details.",
            )

        admin_exists = await _admin_exists(session)

        if admin_exists:
            role = UserRole.USER
        else:
            configured_code = settings.admin_bootstrap_secret.strip()
            submitted_code = (payload.admin_setup_code or "").strip()

            if len(configured_code) < 20:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Administrator setup is not configured.",
                )

            if not hmac.compare_digest(
                configured_code,
                submitted_code,
            ):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="A valid administrator setup code is required.",
                )

            role = UserRole.ADMIN

        user = User(
            account_type=AccountType.REGISTERED,
            email=email,
            username=display_username,
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
            display_name=display_username,
        )

        session.add(profile)

        user.profile = profile

        user_session, refresh_token = await create_session(
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

    # Limit both the source IP and the individual account identifier.
    # The IP-only bucket prevents username rotation from bypassing throttling.
    enforce_rate_limit(
        request,
        bucket="login-ip",
        limit=max(
            settings.auth_login_attempts_per_minute * 3,
            settings.auth_login_attempts_per_minute,
        ),
        window_seconds=60,
    )

    enforce_rate_limit(
        request,
        bucket="login-account",
        limit=settings.auth_login_attempts_per_minute,
        window_seconds=60,
        discriminator=identifier,
    )

    session_factory = get_session_factory()

    async with session_factory() as session:
        result = await session.execute(
            select(User)
            .options(
                selectinload(User.profile),
            )
            .where(
                User.account_type == AccountType.REGISTERED,
                User.is_active.is_(True),
                (User.username_normalized == identifier.lower())
                | (func.lower(User.email) == identifier.lower()),
            )
        )

        user = result.scalar_one_or_none()

        if (
            user is None
            or not user.password_hash
            or not verify_password(
                payload.password,
                user.password_hash,
            )
        ):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid username/email or password.",
            )

        user_session, refresh_token = await create_session(
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
        )

        return AuthResponse(
            access_token=access_token,
            token_type="bearer",
            expires_in=expires_in,
            user=make_user_response(user),
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

            user_session = result.scalar_one_or_none()

            if user_session:
                user_session.revoked_at = datetime.now(UTC)
                user_session.revoke_reason = "logout"

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
    refresh_token = request.cookies.get(
        "hypersync_refresh",
    )

    if not refresh_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token is missing.",
        )

    session_factory = get_session_factory()

    async with session_factory() as session:
        result = await session.execute(
            select(UserSession)
            .where(
                UserSession.refresh_token_hash == hash_refresh_token(refresh_token),
            )
            .with_for_update()
        )

        current_session = result.scalar_one_or_none()

        if current_session is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Refresh token is invalid.",
            )

        now = datetime.now(UTC)

        # A previously rotated/revoked refresh token
        # being presented again is treated as token reuse.
        if current_session.revoked_at is not None:
            family_result = await session.execute(
                select(UserSession).where(
                    UserSession.family_id == current_session.family_id,
                    UserSession.revoked_at.is_(None),
                )
            )

            family_sessions = family_result.scalars().all()

            for family_session in family_sessions:
                family_session.revoked_at = now
                family_session.revoke_reason = "refresh_reuse_detected"

            await session.commit()

            response.delete_cookie(
                key="hypersync_refresh",
                path="/api/auth",
            )

            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Refresh token reuse detected.",
            )

        if current_session.expires_at <= now:
            current_session.revoked_at = now
            current_session.revoke_reason = "expired"

            await session.commit()

            response.delete_cookie(
                key="hypersync_refresh",
                path="/api/auth",
            )

            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Refresh token has expired.",
            )

        user_result = await session.execute(
            select(User)
            .options(
                selectinload(User.profile),
            )
            .where(
                User.id == current_session.user_id,
                User.is_active.is_(True),
            )
        )

        user = user_result.scalar_one_or_none()

        if user is None:
            current_session.revoked_at = now
            current_session.revoke_reason = "account_unavailable"

            await session.commit()

            response.delete_cookie(
                key="hypersync_refresh",
                path="/api/auth",
            )

            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User account is unavailable.",
            )

        # Retire the old refresh-token session.
        current_session.revoked_at = now
        current_session.revoke_reason = "rotated"
        current_session.last_used_at = now

        # Create a new session in the same token family.
        new_refresh_token = create_refresh_token()

        new_session = UserSession(
            user_id=user.id,
            family_id=current_session.family_id,
            refresh_token_hash=hash_refresh_token(
                new_refresh_token,
            ),
            expires_at=(
                now
                + timedelta(
                    days=get_settings().refresh_token_ttl_days,
                )
            ),
            user_agent=request.headers.get(
                "user-agent",
            ),
            ip_address=(request.client.host if request.client else None),
        )

        session.add(new_session)

        await session.commit()

        access_token, expires_in = create_access_token(
            user_id=user.id,
            session_id=new_session.id,
            role=user.role.value,
        )

        set_refresh_cookie(
            response,
            new_refresh_token,
        )

        return AuthResponse(
            access_token=access_token,
            token_type="bearer",
            expires_in=expires_in,
            user=make_user_response(user),
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
                sessions_result = await session.execute(
                    select(UserSession).where(
                        UserSession.user_id == current_session.user_id,
                        UserSession.revoked_at.is_(None),
                    )
                )

                sessions = sessions_result.scalars().all()

                now = datetime.now(UTC)

                for user_session in sessions:
                    user_session.revoked_at = now
                    user_session.revoke_reason = "logout_all"

                await session.commit()

    response.delete_cookie(
        key="hypersync_refresh",
        path="/api/auth",
    )

    return {
        "status": "logged_out_everywhere",
    }
