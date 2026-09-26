from __future__ import annotations

from uuid import UUID

from sqlalchemy import (
    ForeignKey,
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


class ArtistProfile(
    UUIDPrimaryKeyMixin,
    TimestampMixin,
    Base,
):
    __tablename__ = "artist_profiles"

    name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    normalized_name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        unique=True,
        index=True,
    )

    bio: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )


class ArtistFollow(
    TimestampMixin,
    Base,
):
    __tablename__ = "artist_follows"

    user_id: Mapped[UUID] = mapped_column(
        ForeignKey(
            "users.id",
            ondelete="CASCADE",
        ),
        primary_key=True,
    )

    artist_id: Mapped[UUID] = mapped_column(
        ForeignKey(
            "artist_profiles.id",
            ondelete="CASCADE",
        ),
        primary_key=True,
        index=True,
    )
