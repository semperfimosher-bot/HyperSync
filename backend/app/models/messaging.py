from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column

from .base import (
    Base,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
)


class Message(
    UUIDPrimaryKeyMixin,
    TimestampMixin,
    Base,
):
    __tablename__ = "messages"

    __table_args__ = (
        CheckConstraint(
            "sender_id <> recipient_id",
            name="messages_not_self",
        ),
        Index(
            "ix_messages_recipient_viewed_created",
            "recipient_id",
            "viewed_at",
            "created_at",
        ),
        Index(
            "ix_messages_sender_recipient_created",
            "sender_id",
            "recipient_id",
            "created_at",
        ),
    )

    sender_id: Mapped[UUID] = mapped_column(
        ForeignKey(
            "users.id",
            ondelete="CASCADE",
        ),
        nullable=False,
        index=True,
    )

    recipient_id: Mapped[UUID] = mapped_column(
        ForeignKey(
            "users.id",
            ondelete="CASCADE",
        ),
        nullable=False,
        index=True,
    )

    body: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    shared_kind: Mapped[str | None] = mapped_column(
        String(16),
        nullable=True,
    )

    shared_key: Mapped[str | None] = mapped_column(
        String(512),
        nullable=True,
    )

    shared_title: Mapped[str | None] = mapped_column(
        String(300),
        nullable=True,
    )

    shared_subtitle: Mapped[str | None] = mapped_column(
        String(300),
        nullable=True,
    )

    shared_artwork_url: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    viewed_at: Mapped[datetime | None] = mapped_column(
        DateTime(
            timezone=True,
        ),
        nullable=True,
    )


class AdminNotification(
    UUIDPrimaryKeyMixin,
    TimestampMixin,
    Base,
):
    __tablename__ = "admin_notifications"

    __table_args__ = (
        Index(
            "ix_admin_notifications_recipient_viewed_created",
            "recipient_id",
            "viewed_at",
            "created_at",
        ),
    )

    recipient_id: Mapped[UUID] = mapped_column(
        ForeignKey(
            "users.id",
            ondelete="CASCADE",
        ),
        nullable=False,
        index=True,
    )

    kind: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
    )

    title: Mapped[str] = mapped_column(
        String(160),
        nullable=False,
    )

    body: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    actor_username: Mapped[str | None] = mapped_column(
        String(32),
        nullable=True,
    )

    source_message_id: Mapped[UUID | None] = mapped_column(
        ForeignKey(
            "messages.id",
            ondelete="CASCADE",
        ),
        nullable=True,
        index=True,
    )

    viewed_at: Mapped[datetime | None] = mapped_column(
        DateTime(
            timezone=True,
        ),
        nullable=True,
    )


class PushSubscription(
    UUIDPrimaryKeyMixin,
    TimestampMixin,
    Base,
):
    __tablename__ = "push_subscriptions"

    user_id: Mapped[UUID] = mapped_column(
        ForeignKey(
            "users.id",
            ondelete="CASCADE",
        ),
        nullable=False,
        index=True,
    )

    endpoint: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        unique=True,
    )

    p256dh: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    auth: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    user_agent: Mapped[str | None] = mapped_column(
        String(512),
        nullable=True,
    )
