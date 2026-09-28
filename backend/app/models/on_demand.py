from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    JSON,
    String,
    Text,
    false,
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


class OnDemandCandidate(
    TimestampMixin,
    Base,
):
    __tablename__ = "on_demand_candidates"

    candidate_key: Mapped[str] = mapped_column(
        String(160),
        primary_key=True,
    )

    payload: Mapped[dict] = mapped_column(
        JSON,
        nullable=False,
    )

    expires_at: Mapped[datetime] = mapped_column(
        DateTime(
            timezone=True,
        ),
        nullable=False,
        index=True,
    )


class OnDemandProvision(
    UUIDPrimaryKeyMixin,
    TimestampMixin,
    Base,
):
    __tablename__ = "on_demand_provisions"

    candidate_key: Mapped[str] = mapped_column(
        String(160),
        nullable=False,
        index=True,
    )

    candidate_payload: Mapped[dict] = mapped_column(
        JSON,
        nullable=False,
    )

    state: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        index=True,
    )

    source_payload: Mapped[dict | None] = mapped_column(
        JSON,
        nullable=True,
    )

    track_id: Mapped[UUID | None] = mapped_column(
        ForeignKey(
            "tracks.id",
            ondelete="SET NULL",
        ),
        nullable=True,
        index=True,
    )

    error: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    ingest_started: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default=false(),
    )

    expires_at: Mapped[datetime] = mapped_column(
        DateTime(
            timezone=True,
        ),
        nullable=False,
        index=True,
    )


class OnDemandPendingListener(
    TimestampMixin,
    Base,
):
    __tablename__ = "on_demand_pending_listeners"

    provision_id: Mapped[UUID] = mapped_column(
        ForeignKey(
            "on_demand_provisions.id",
            ondelete="CASCADE",
        ),
        primary_key=True,
    )

    user_id: Mapped[UUID] = mapped_column(
        ForeignKey(
            "users.id",
            ondelete="CASCADE",
        ),
        primary_key=True,
        index=True,
    )
