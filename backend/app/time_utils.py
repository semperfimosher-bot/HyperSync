from __future__ import annotations

from datetime import (
    UTC,
    datetime,
)
from typing import overload


@overload
def as_utc_aware(
    value: None,
) -> None:
    ...


@overload
def as_utc_aware(
    value: datetime,
) -> datetime:
    ...


def as_utc_aware(
    value: datetime | None,
) -> datetime | None:
    """Return a UTC-aware datetime without changing the instant.

    SQLite can return timezone-naive values even for columns declared
    with timezone=True, while PostgreSQL normally returns aware values.
    Normalize at application boundaries so comparisons behave the same
    in tests, local development, and production.
    """

    if value is None:
        return None

    if value.tzinfo is None:
        return value.replace(
            tzinfo=UTC,
        )

    return value.astimezone(
        UTC,
    )
