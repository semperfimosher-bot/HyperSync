from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
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


class BotCatalogScan(
    UUIDPrimaryKeyMixin,
    TimestampMixin,
    Base,
):
    __tablename__ = "bot_catalog_scans"

    state: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        default="queued",
        index=True,
    )

    auto_ingest: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
    )

    track_limit_per_artist: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=500,
    )

    ingest_concurrency: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=2,
    )

    artist_total: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )

    artists_scanned: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )

    artist_failures: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )

    current_artist: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )

    missing_discovered: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )

    ingest_started: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )

    ingest_ready: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )

    ingest_failed: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )

    cancel_requested: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        index=True,
    )

    last_error: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(
            timezone=True,
        ),
        nullable=True,
    )

    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(
            timezone=True,
        ),
        nullable=True,
    )


class BotCatalogScanItem(
    UUIDPrimaryKeyMixin,
    TimestampMixin,
    Base,
):
    __tablename__ = "bot_catalog_scan_items"

    __table_args__ = (
        UniqueConstraint(
            "scan_id",
            "candidate_key",
            name=(
                "uq_bot_catalog_scan_items_scan_candidate"
            ),
        ),
    )

    scan_id: Mapped[UUID] = mapped_column(
        ForeignKey(
            "bot_catalog_scans.id",
            ondelete="CASCADE",
        ),
        nullable=False,
        index=True,
    )

    candidate_key: Mapped[str] = mapped_column(
        String(160),
        nullable=False,
    )

    payload: Mapped[dict] = mapped_column(
        JSON,
        nullable=False,
    )

    state: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        default="discovered",
        index=True,
    )

    track_id: Mapped[UUID | None] = mapped_column(
        nullable=True,
    )

    attempts: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )

    error: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )
