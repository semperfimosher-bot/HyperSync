"""HTTP routes for authentication and account recovery."""

import hmac
import logging
from datetime import UTC, datetime, timedelta
from secrets import token_urlsafe
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlalchemy import delete, select

from ...config import get_settings
from ...database import get_session_factory
from ...models.account import (
    AccountType,
    PasswordRecovery,
    User,
    UserSession,
)
from ...security.passwords import hash_password_async
from ...security.rate_limit import enforce_rate_limit
from ...security.tokens import create_access_token
from ...services.admin_notifications import record_admin_activity
from ...services.auth import (
    _generate_recovery_code,
    _hash_recovery_otp,
    _hash_recovery_reset_token,
    _registered_user_for_identifier,
    authenticate_password_account,
    create_session,
    delete_all_refresh_sessions,
    delete_refresh_session,
    enforce_admin_creation_authorization,
    make_user_response,
    register_account,
    resolve_registration_role,
    refresh_authenticated_session,
    set_refresh_cookie,
)
from ...services.email import EmailDeliveryError, send_password_recovery_email
from ...time_utils import as_utc_aware as _as_utc_aware
from ..dependencies import OptionalCurrentUser
from ..schemas.auth import (
    AuthResponse,
    LoginRequest,
    MessageResponse,
    PasswordRecoveryOtpRequest,
    PasswordRecoveryRequest,
    PasswordResetRequest,
    RecoveryDispatchResponse,
    RegisterRequest,
)

logger = logging.getLogger(__name__)

__all__ = [
    "enforce_admin_creation_authorization",
    "resolve_registration_role",
]

router = APIRouter(prefix="/auth", tags=["authentication"])

@router.post(
    "/register",
    response_model=AuthResponse,
    status_code=status.HTTP_201_CREATED,
)
async def register(
    payload: RegisterRequest,
    request: Request,
    response: Response,
    requester: OptionalCurrentUser,
):
    settings = get_settings()

    await enforce_rate_limit(
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
        await enforce_rate_limit(
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

    (
        user,
        user_session,
        refresh_token,
    ) = await register_account(
        username=payload.username,
        email=str(
            payload.email,
        ),
        password=payload.password,
        create_admin=(
            payload.create_admin
        ),
        admin_verification_password=(
            payload
            .admin_verification_password
        ),
        requester_role=(
            requester.role
            if requester is not None
            else None
        ),
        request=request,
    )

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

    await enforce_rate_limit(
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

    await enforce_rate_limit(
        request,
        scope="auth-login-identity",
        include_client=False,
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

    (
        user,
        user_session,
        refresh_token,
    ) = await authenticate_password_account(
        identifier=identifier,
        password=payload.password,
        request=request,
    )

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

    await enforce_rate_limit(
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

    await enforce_rate_limit(
        request,
        scope="password-recovery-request-identity",
        include_client=False,
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

    ttl_minutes = max(
        1,
        int(
            settings
            .password_recovery_ttl_minutes
        ),
    )

    generic_response = (
        RecoveryDispatchResponse(
            detail=(
                "If an eligible account exists, "
                "recovery instructions have been "
                "sent to its email address."
            ),
            expires_in=(
                ttl_minutes
                * 60
            ),
        )
    )

    session_factory = get_session_factory()

    async with session_factory() as session:
        user = await _registered_user_for_identifier(
            session,
            identifier,
        )

        if (
            user is None
            or not user.is_active
            or not user.email
        ):
            return generic_response

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
                    or "HyperSynced user"
                ),
                otp_code=otp_code,
                reset_token=reset_token,
                expires_minutes=ttl_minutes,
            )
        except EmailDeliveryError:
            await session.execute(
                delete(
                    PasswordRecovery,
                ).where(
                    PasswordRecovery.id
                    == recovery_id,
                )
            )

            await session.commit()

            logger.warning(
                "Password recovery email delivery failed.",
                exc_info=True,
            )

        return generic_response


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

    await enforce_rate_limit(
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

    await enforce_rate_limit(
        request,
        scope="password-recovery-verify-identity",
        include_client=False,
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

        if (
            user is None
            or not user.is_active
        ):
            raise HTTPException(
                status_code=(
                    status.HTTP_401_UNAUTHORIZED
                ),
                detail=(
                    "Recovery code is invalid "
                    "or expired."
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
                    status.HTTP_401_UNAUTHORIZED
                ),
                detail=(
                    "Recovery code is invalid "
                    "or expired."
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
                    status.HTTP_401_UNAUTHORIZED
                ),
                detail=(
                    "Recovery code is invalid "
                    "or expired."
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
                    "Recovery code is invalid "
                    "or expired."
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

    await enforce_rate_limit(
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

    await enforce_rate_limit(
        request,
        scope="password-recovery-reset-token",
        include_client=False,
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

    new_password_hash = (
        await hash_password_async(
            payload.new_password,
        )
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
            new_password_hash
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
            await delete_refresh_session(
                database_session=session,
                refresh_token=refresh_token,
            )

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

    await enforce_rate_limit(
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

    async with session_factory() as session:
        (
            user,
            current_session,
            replacement_refresh_token,
        ) = await refresh_authenticated_session(
            database_session=session,
            refresh_token=refresh_token,
            request=request,
        )

        access_token, expires_in = (
            create_access_token(
                user_id=user.id,
                session_id=(
                    current_session.id
                ),
                role=user.role.value,
            )
        )

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
        session_factory = (
            get_session_factory()
        )

        async with session_factory() as session:
            await delete_all_refresh_sessions(
                database_session=session,
                refresh_token=refresh_token,
            )

    response.delete_cookie(
        key="hypersync_refresh",
        path="/api/auth",
    )

    return {
        "status": "logged_out_everywhere",
    }
