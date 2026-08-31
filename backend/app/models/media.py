from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    false,
    func,
)
from sqlalchemy.orm import (
    Mapped,
    mapped_column,
)

from .base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class Track(
    UUIDPrimaryKeyMixin,
    TimestampMixin,
    Base,
):
    __tablename__ = "tracks"

    title: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    artist: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    album: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )

    b2_object_key: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        unique=True,
    )

    mime_type: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        default="audio/mpeg",
        server_default="audio/mpeg",
    )

    file_size: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )

    duration_seconds: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )

    artwork_object_key: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    is_published: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default="true",
    )

class TrackLyrics(
    TimestampMixin,
    Base,
):
    __tablename__ = "track_lyrics"

    track_id: Mapped[UUID] = mapped_column(
        ForeignKey(
            "tracks.id",
            ondelete="CASCADE",
        ),
        primary_key=True,
    )

    lrclib_id: Mapped[int | None] = (
        mapped_column(
            BigInteger,
            nullable=True,
        )
    )

    plain_lyrics: Mapped[
        str | None
    ] = mapped_column(
        Text,
        nullable=True,
    )

    synced_lyrics: Mapped[
        str | None
    ] = mapped_column(
        Text,
        nullable=True,
    )

    instrumental: Mapped[bool] = (
        mapped_column(
            Boolean,
            nullable=False,
            default=False,
            server_default=false(),
        )
    )

    checked_at: Mapped[datetime] = (
        mapped_column(
            DateTime(
                timezone=True,
            ),
            nullable=False,
            default=func.now,
            server_default=func.now(),
        )
    )
    