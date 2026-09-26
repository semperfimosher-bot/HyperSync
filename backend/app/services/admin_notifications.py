from __future__ import annotations

import logging
from uuid import UUID

from sqlalchemy import select

from ..database import get_session_factory
from ..models.account import (
    AccountType,
    User,
    UserRole,
)
from ..models.messaging import AdminNotification


logger = logging.getLogger(
    __name__,
)


async def record_admin_activity(
    *,
    kind: str,
    title: str,
    body: str,
    actor_user_id: UUID | None = None,
    actor_username: str | None = None,
    source_message_id: UUID | None = None,
) -> None:
    """Record one activity notification for every active admin."""

    try:
        session_factory = get_session_factory()

        async with session_factory() as session:
            resolved_actor = (
                actor_username.strip()
                if actor_username
                else ""
            )

            if (
                not resolved_actor
                and actor_user_id is not None
            ):
                actor_result = await session.execute(
                    select(
                        User.username,
                    ).where(
                        User.id
                        == actor_user_id,
                    )
                )

                resolved_actor = (
                    actor_result.scalar_one_or_none()
                    or ""
                )

            admin_result = await session.execute(
                select(
                    User.id,
                ).where(
                    User.account_type
                    == AccountType.REGISTERED,
                    User.role
                    == UserRole.ADMIN,
                    User.is_active.is_(True),
                )
            )

            admin_ids = list(
                admin_result.scalars().all()
            )

            if not admin_ids:
                return

            normalized_kind = (
                kind.strip()[:64]
                or "activity"
            )
            normalized_title = (
                title.strip()[:160]
                or "HyperSynced activity"
            )
            normalized_body = (
                body.strip()
                or "Activity occurred."
            )

            for admin_id in admin_ids:
                session.add(
                    AdminNotification(
                        recipient_id=admin_id,
                        kind=normalized_kind,
                        title=normalized_title,
                        body=normalized_body,
                        actor_username=(
                            resolved_actor[:32]
                            or None
                        ),
                        source_message_id=(
                            source_message_id
                        ),
                    )
                )

            await session.commit()
    except Exception:
        # Notifications are non-critical and must never
        # make the user's original action fail.
        logger.exception(
            "Unable to record admin activity notification.",
        )
