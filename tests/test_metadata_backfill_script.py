from types import SimpleNamespace

from scripts.backfill_track_metadata import (
    acceptable_metadata,
    apply_missing_metadata,
    missing_metadata,
)


def track(
    *,
    genre=None,
    release_year=None,
):
    return SimpleNamespace(
        genre=genre,
        release_year=release_year,
    )


def test_missing_metadata_detects_blank_genre_or_year() -> None:
    assert missing_metadata(
        track(
            genre=None,
            release_year=2024,
        )
    )

    assert missing_metadata(
        track(
            genre="   ",
            release_year=2024,
        )
    )

    assert missing_metadata(
        track(
            genre="Pop",
            release_year=None,
        )
    )

    assert not missing_metadata(
        track(
            genre="Pop",
            release_year=2024,
        )
    )


def test_apply_missing_metadata_only_fills_missing_fields() -> None:
    item = track(
        genre="Rock",
        release_year=None,
    )

    changed, genre_changed, year_changed = (
        apply_missing_metadata(
            item,
            {
                "source":
                    "apple",
                "recording_id":
                    "123",
                "genre":
                    "Pop",
                "release_year":
                    2021,
                "confidence":
                    0.98,
            },
        )
    )

    assert changed is True
    assert genre_changed is False
    assert year_changed is True
    assert item.genre == "Rock"
    assert item.release_year == 2021


def test_apply_missing_metadata_fills_both_fields() -> None:
    item = track(
        genre="",
        release_year=None,
    )

    changed, genre_changed, year_changed = (
        apply_missing_metadata(
            item,
            {
                "source":
                    "lastfm+apple",
                "recording_id":
                    "456",
                "genre":
                    "Hip-Hop/Rap",
                "release_year":
                    2019,
                "confidence":
                    0.96,
            },
        )
    )

    assert changed is True
    assert genre_changed is True
    assert year_changed is True
    assert item.genre == "Hip-Hop/Rap"
    assert item.release_year == 2019


def test_acceptable_metadata_requires_confidence_and_useful_value() -> None:
    assert acceptable_metadata(
        {
            "source":
                "apple",
            "recording_id":
                "1",
            "genre":
                "Pop",
            "release_year":
                2024,
            "confidence":
                0.94,
        },
        min_confidence=0.90,
    )

    assert not acceptable_metadata(
        {
            "source":
                "apple",
            "recording_id":
                "2",
            "genre":
                "Pop",
            "release_year":
                2024,
            "confidence":
                0.89,
        },
        min_confidence=0.90,
    )

    assert not acceptable_metadata(
        {
            "source":
                "apple",
            "recording_id":
                "3",
            "genre":
                None,
            "release_year":
                None,
            "confidence":
                0.99,
        },
        min_confidence=0.90,
    )
