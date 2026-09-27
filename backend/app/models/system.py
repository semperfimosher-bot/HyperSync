from datetime import datetime

from sqlalchemy import (
    BigInteger,
    DateTime,
    Integer,
    String,
    func,
)
from sqlalchemy.orm import (
    Mapped,
    mapped_column,
)

from .base import Base


class SystemResetState(Base):
    __tablename__ = (
        "system_reset_state"
    )

    id: Mapped[int] = (
        mapped_column(
            Integer,
            primary_key=True,
            default=1,
        )
    )

    generation: Mapped[int] = (
        mapped_column(
            BigInteger,
            nullable=False,
            default=0,
            server_default="0",
        )
    )

    updated_at: Mapped[
        datetime
    ] = mapped_column(
        DateTime(
            timezone=True,
        ),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class RateLimitBucket(Base):
    __tablename__ = (
        "rate_limit_buckets"
    )

    key: Mapped[str] = (
        mapped_column(
            String(
                160,
            ),
            primary_key=True,
        )
    )

    window_started_at: Mapped[
        datetime
    ] = mapped_column(
        DateTime(
            timezone=True,
        ),
        nullable=False,
        server_default=func.now(),
    )

    request_count: Mapped[int] = (
        mapped_column(
            Integer,
            nullable=False,
            default=0,
            server_default="0",
        )
    )

    updated_at: Mapped[
        datetime
    ] = mapped_column(
        DateTime(
            timezone=True,
        ),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
        index=True,
    )
