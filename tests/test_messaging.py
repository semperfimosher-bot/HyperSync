from __future__ import annotations

from datetime import (
    UTC,
    datetime,
    timedelta,
)
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import (
    async_sessionmaker,
    create_async_engine,
)

from backend.app.api.routes import (
    messages as message_routes,
)
from backend.app.models.account import (
    AccountType,
    User,
)
from backend.app.models.base import Base
from backend.app.models.messaging import (
    Message,
    PushSubscription,
)


@pytest.mark.asyncio
async def test_messages_expire_only_one_week_after_viewing() -> None:
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
    )

    async with engine.begin() as connection:
        await connection.run_sync(
            Base.metadata.create_all,
            tables=[
                Base.metadata.tables[
                    User.__tablename__
                ],
                Base.metadata.tables[
                    Message.__tablename__
                ],
                Base.metadata.tables[
                    PushSubscription.__tablename__
                ],
            ],
        )

    session_factory = async_sessionmaker(
        engine,
        expire_on_commit=False,
    )

    now = datetime.now(
        UTC,
    )

    async with session_factory() as session:
        sender = User(
            account_type=(
                AccountType.REGISTERED
            ),
            email="sender@example.test",
            username="sender",
            username_normalized="sender",
            password_hash="hash",
        )

        recipient = User(
            account_type=(
                AccountType.REGISTERED
            ),
            email="recipient@example.test",
            username="recipient",
            username_normalized="recipient",
            password_hash="hash",
        )

        session.add_all(
            [
                sender,
                recipient,
            ]
        )

        await session.flush()

        unread = Message(
            sender_id=sender.id,
            recipient_id=recipient.id,
            body="Unread stays stored.",
            viewed_at=None,
        )

        viewed_recently = Message(
            sender_id=sender.id,
            recipient_id=recipient.id,
            body="Viewed six days ago.",
            viewed_at=(
                now
                - timedelta(
                    days=6,
                )
            ),
        )

        viewed_expired = Message(
            sender_id=sender.id,
            recipient_id=recipient.id,
            body="Viewed eight days ago.",
            viewed_at=(
                now
                - timedelta(
                    days=8,
                )
            ),
        )

        session.add_all(
            [
                unread,
                viewed_recently,
                viewed_expired,
            ]
        )

        await session.commit()

        await message_routes._cleanup_expired(
            session,
        )

        await session.commit()

        result = await session.execute(
            select(Message)
        )

        remaining_ids = {
            message.id
            for message
            in result.scalars().all()
        }

        assert unread.id in remaining_ids
        assert viewed_recently.id in remaining_ids
        assert viewed_expired.id not in remaining_ids

    await engine.dispose()


def test_viewed_message_expiry_is_exactly_seven_days() -> None:
    now = datetime.now(
        UTC,
    )

    sender = User(
        id=uuid4(),
        account_type=(
            AccountType.REGISTERED
        ),
        email="sender2@example.test",
        username="sender2",
        username_normalized="sender2",
        password_hash="hash",
    )

    recipient = User(
        id=uuid4(),
        account_type=(
            AccountType.REGISTERED
        ),
        email="recipient2@example.test",
        username="recipient2",
        username_normalized="recipient2",
        password_hash="hash",
    )

    message = Message(
        id=uuid4(),
        sender_id=sender.id,
        recipient_id=recipient.id,
        body="Hello",
        viewed_at=now,
    )

    message.created_at = now

    response = (
        message_routes._message_response(
            message,
            recipient,
            sender,
            recipient,
        )
    )

    assert response.expires_at == (
        now
        + timedelta(
            days=7,
        )
    )


def test_shared_music_message_builds_card_and_preview() -> None:
    now = datetime.now(
        UTC,
    )

    sender = User(
        id=uuid4(),
        account_type=(
            AccountType.REGISTERED
        ),
        email="share-sender@example.test",
        username="share-sender",
        username_normalized="share-sender",
        password_hash="hash",
    )

    recipient = User(
        id=uuid4(),
        account_type=(
            AccountType.REGISTERED
        ),
        email="share-recipient@example.test",
        username="share-recipient",
        username_normalized="share-recipient",
        password_hash="hash",
    )

    message = Message(
        id=uuid4(),
        sender_id=sender.id,
        recipient_id=recipient.id,
        body="",
        shared_kind="playlist",
        shared_key="playlist-123",
        shared_title="Night Drive",
        shared_subtitle="HyperSynced",
        shared_artwork_url="/art.jpg",
        viewed_at=None,
    )

    message.created_at = now

    response = (
        message_routes._message_response(
            message,
            recipient,
            sender,
            recipient,
        )
    )

    assert response.body == ""
    assert response.shared_music is not None
    assert (
        response.shared_music.kind
        == "playlist"
    )
    assert (
        response.shared_music.key
        == "playlist-123"
    )
    assert (
        response.shared_music.title
        == "Night Drive"
    )
    assert (
        response.shared_music.subtitle
        == "HyperSynced"
    )
    assert (
        response.shared_music.artwork_url
        == "/art.jpg"
    )

    assert (
        message_routes._message_preview(
            message,
        )
        == "Shared a playlist: Night Drive"
    )
