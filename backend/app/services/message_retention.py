from __future__ import annotations

from datetime import (
    UTC,
    datetime,
    timedelta,
)

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_session_factory
from ..models.messaging import Message


MESSAGE_RETENTION_AFTER_VIEW = timedelta(
    days=7,
)


async def delete_expired_messages(
    session: AsyncSession,
) -> None:
    cutoff = (
        datetime.now(
            UTC,
        )
        - MESSAGE_RETENTION_AFTER_VIEW
    )

    await session.execute(
        delete(
            Message,
        ).where(
            Message.viewed_at
            .is_not(
                None,
            ),
            Message.viewed_at
            <= cutoff,
        )
    )


async def cleanup_expired_messages() -> None:
    session_factory = get_session_factory()

    async with session_factory() as session:
        await delete_expired_messages(
            session,
        )

        await session.commit()
