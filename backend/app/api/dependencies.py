from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..database import get_database_session
from ..models.account import User, UserRole, UserSession
from ..security.tokens import (
    InvalidAccessTokenError,
    decode_access_token,
)


def _as_utc_aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)

bearer_scheme = HTTPBearer(
    auto_error=False,
)


DatabaseSession = Annotated[
    AsyncSession,
    Depends(get_database_session),
]


async def get_current_user(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None,
        Depends(bearer_scheme),
    ],
    session: DatabaseSession,
) -> User:
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
            headers={
                "WWW-Authenticate": "Bearer",
            },
        )

    try:
        claims = decode_access_token(
            credentials.credentials,
        )
    except InvalidAccessTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired access token.",
            headers={
                "WWW-Authenticate": "Bearer",
            },
        ) from exc

    session_result = await session.execute(
        select(UserSession).where(
            UserSession.id == claims.session_id,
            UserSession.user_id == claims.user_id,
        )
    )

    user_session = session_result.scalar_one_or_none()

    if user_session is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication session not found.",
            headers={
                "WWW-Authenticate": "Bearer",
            },
        )

    now = datetime.now(UTC)
    user_session_revoked_at = _as_utc_aware(user_session.revoked_at)
    user_session_expires_at = _as_utc_aware(user_session.expires_at)

    if user_session_revoked_at is not None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication session has been revoked.",
            headers={
                "WWW-Authenticate": "Bearer",
            },
        )

    if user_session_expires_at is not None and user_session_expires_at <= now:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication session has expired.",
            headers={
                "WWW-Authenticate": "Bearer",
            },
        )

    result = await session.execute(
        select(User)
        .options(
            selectinload(User.profile),
        )
        .where(
            User.id == claims.user_id,
            User.is_active.is_(True),
        )
    )

    user = result.scalar_one_or_none()

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account is unavailable.",
            headers={
                "WWW-Authenticate": "Bearer",
            },
        )

    return user


CurrentUser = Annotated[
    User,
    Depends(get_current_user),
]


async def require_admin(
    user: Annotated[
        User,
        Depends(get_current_user),
    ],
) -> User:
    if user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator access required.",
        )

    return user


AdminUser = Annotated[
    User,
    Depends(require_admin),
]
