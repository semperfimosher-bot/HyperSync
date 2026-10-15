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

    PostgreSQL normally returns aware values for timezone-aware columns,
    but imported or legacy values can still arrive without tzinfo.
    Normalize at application boundaries so comparisons remain stable.
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
