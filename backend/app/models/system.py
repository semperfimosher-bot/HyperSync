from datetime import datetime

from sqlalchemy import (
    BigInteger,
    DateTime,
    Integer,
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
