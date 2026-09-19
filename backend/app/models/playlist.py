from __future__ import annotations

from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    Integer,
    String,
    Text,
)
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

    owner_id: Mapped[UUID] = mapped_column(
        ForeignKey(
            "users.id",
            ondelete="CASCADE",
        ),
        nullable=False,
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


class PlaylistTrack(
    UUIDPrimaryKeyMixin,
    TimestampMixin,
    Base,
):
    __tablename__ = "playlist_tracks"

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
