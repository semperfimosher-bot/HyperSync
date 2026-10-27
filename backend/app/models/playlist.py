from __future__ import annotations

import hashlib
from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import (
    Mapped,
    mapped_column,
)

from .base import (
    Base,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
)


class Playlist(
    UUIDPrimaryKeyMixin,
    TimestampMixin,
    Base,
):
    __tablename__ = "playlists"

    __table_args__ = (
        CheckConstraint(
            "visibility IN ('private', 'unlisted', 'public', 'generated')",
            name="playlist_visibility_valid",
        ),
    )

    owner_id: Mapped[UUID | None] = mapped_column(
        ForeignKey(
            "users.id",
            ondelete="CASCADE",
        ),
        nullable=True,
        index=True,
    )

    title: Mapped[str] = mapped_column(
        String(120),
        nullable=False,
    )

    description: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    visibility: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        default="private",
        server_default="private",
        index=True,
    )

    generated_key: Mapped[str | None] = mapped_column(
        String(96),
        nullable=True,
        unique=True,
        index=True,
    )

    generated_query: Mapped[str | None] = mapped_column(
        String(200),
        nullable=True,
    )

    generated_kind: Mapped[str | None] = mapped_column(
        String(32),
        nullable=True,
    )

    generator_version: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )

    generated_at: Mapped[datetime | None] = mapped_column(
        DateTime(
            timezone=True,
        ),
        nullable=True,
    )


class PlaylistTrack(
    UUIDPrimaryKeyMixin,
    TimestampMixin,
    Base,
):
    __tablename__ = "playlist_tracks"

    __table_args__ = (
        UniqueConstraint("playlist_id", "track_id", name="uq_playlist_tracks_playlist_track"),
        Index(
            "ix_playlist_tracks_page_order",
            "playlist_id",
            "position",
            "created_at",
            "id",
        ),
    )

    playlist_id: Mapped[UUID] = mapped_column(
        ForeignKey(
            "playlists.id",
            ondelete="CASCADE",
        ),
        nullable=False,
        index=True,
    )

    track_id: Mapped[UUID] = mapped_column(
        ForeignKey(
            "tracks.id",
            ondelete="CASCADE",
        ),
        nullable=False,
        index=True,
    )

    position: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )


class SavedPlaylist(
    TimestampMixin,
    Base,
):
    __tablename__ = "saved_playlists"

    user_id: Mapped[UUID] = mapped_column(
        ForeignKey(
            "users.id",
            ondelete="CASCADE",
        ),
        primary_key=True,
    )

    playlist_id: Mapped[UUID] = mapped_column(
        ForeignKey(
            "playlists.id",
            ondelete="CASCADE",
        ),
        primary_key=True,
    )


async def lock_playlist(session: AsyncSession, identity: str | UUID) -> None:
    """Serialize writes until transaction end, including identities without a row yet.

    Key locks must precede lookup/creation; existing rows also take their UUID
    lock so owner edits and generated/liked mutations share the same guard.
    A stable signed bigint avoids Python hash randomization across replicas.
    """
    digest = hashlib.sha256(f"hypersync:playlist:{identity}".encode()).digest()
    key = int.from_bytes(digest[:8], "big", signed=True)
    await session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key})
