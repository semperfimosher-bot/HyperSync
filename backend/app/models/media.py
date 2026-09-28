from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
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

    genre: Mapped[str | None] = mapped_column(
        String(120),
        nullable=True,
        index=True,
    )

    release_year: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
        index=True,
    )

    isrc: Mapped[str | None] = mapped_column(
        String(32),
        nullable=True,
        index=True,
    )

    deezer_track_id: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
        index=True,
    )

    apple_track_id: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
        index=True,
    )

    source_provider: Mapped[str | None] = mapped_column(
        String(40),
        nullable=True,
    )

    source_id: Mapped[str | None] = mapped_column(
        String(160),
        nullable=True,
        index=True,
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


class TrackIdentity(
    Base,
):
    __tablename__ = "track_identities"

    __table_args__ = (
        Index(
            "ix_track_identities_artist_title",
            "artist_key",
            "title_key",
        ),
        Index(
            "ix_track_identities_primary_artist_title",
            "primary_artist_key",
            "title_key",
        ),
    )

    track_id: Mapped[UUID] = mapped_column(
        ForeignKey(
            "tracks.id",
            ondelete="CASCADE",
        ),
        primary_key=True,
    )

    artist_key: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        index=True,
    )

    primary_artist_key: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        index=True,
    )

    title_key: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        index=True,
    )


class TrackArtistCredit(
    Base,
):
    __tablename__ = "track_artist_credits"

    __table_args__ = (
        UniqueConstraint(
            "track_id",
            "normalized_name",
            name=(
                "uq_track_artist_credits_track_artist"
            ),
        ),
        Index(
            "ix_track_artist_credits_artist_track",
            "normalized_name",
            "track_id",
        ),
    )

    track_id: Mapped[UUID] = mapped_column(
        ForeignKey(
            "tracks.id",
            ondelete="CASCADE",
        ),
        primary_key=True,
    )

    position: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    artist_name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    normalized_name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        index=True,
    )

    is_primary: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default=false(),
        index=True,
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

    lrclib_id: Mapped[int | None] = mapped_column(
        BigInteger,
        nullable=True,
    )

    plain_lyrics: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    synced_lyrics: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    instrumental: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default=false(),
    )

    checked_at: Mapped[datetime] = mapped_column(
        DateTime(
            timezone=True,
        ),
        nullable=False,
        default=func.now,
        server_default=func.now(),
    )
