from datetime import (
    UTC,
    datetime,
    timedelta,
    timezone,
)

from backend.app.time_utils import (
    as_utc_aware,
)


def test_as_utc_aware_normalizes_naive_values() -> None:
    value = datetime(
        2026,
        9,
        28,
        12,
        30,
    )

    normalized = (
        as_utc_aware(
            value,
        )
    )

    assert normalized is not None
    assert normalized.tzinfo is UTC
    assert normalized.hour == 12
    assert normalized.minute == 30


def test_as_utc_aware_preserves_instant_for_aware_values() -> None:
    value = datetime(
        2026,
        9,
        28,
        8,
        30,
        tzinfo=timezone(
            -timedelta(
                hours=4,
            )
        ),
    )

    normalized = (
        as_utc_aware(
            value,
        )
    )

    assert normalized is not None
    assert normalized.tzinfo is UTC
    assert normalized.hour == 12
    assert normalized.minute == 30


def test_as_utc_aware_preserves_none() -> None:
    assert (
        as_utc_aware(
            None,
        )
        is None
    )
