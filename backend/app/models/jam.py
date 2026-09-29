from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class JamSession(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "jam_sessions"

    host_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    mode: Mapped[str] = mapped_column(String(16), nullable=False, default="host")
    invite_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    invite_expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    allow_guest_control: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    current_track_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("tracks.id", ondelete="SET NULL")
    )
    current_item_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True))
    position_seconds: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    anchor_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=func.now()
    )
    paused: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)


class JamMember(Base):
    __tablename__ = "jam_members"

    jam_id: Mapped[UUID] = mapped_column(
        ForeignKey("jam_sessions.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, unique=True, index=True
    )
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class JamQueueItem(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "jam_queue_items"

    jam_id: Mapped[UUID] = mapped_column(
        ForeignKey("jam_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    track_id: Mapped[UUID] = mapped_column(
        ForeignKey("tracks.id", ondelete="CASCADE"), nullable=False
    )
    added_by_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    added_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
