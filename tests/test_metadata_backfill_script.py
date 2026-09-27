import json
from types import SimpleNamespace

import pytest

from scripts.backfill_track_metadata import (
    acceptable_metadata,
    apply_missing_metadata,
    load_completed_dry_run_report,
    missing_metadata,
    report_metadata,
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



def test_completed_dry_run_report_can_be_replayed(tmp_path) -> None:
    report_path = (
        tmp_path
        / "metadata-backfill.jsonl"
    )

    rows = [
        {
            "track_id":
                "00000000-0000-0000-0000-000000000001",
            "title":
                "Replay Me",
            "artist":
                "HyperSync",
            "status":
                "would_update",
            "provider_genre":
                "Pop",
            "provider_release_year":
                2024,
            "source":
                "apple",
            "recording_id":
                "apple:1",
            "confidence":
                0.97,
        },
        {
            "type":
                "summary",
            "dry_run":
                True,
            "stats": {
                "matched":
                    1,
            },
        },
    ]

    report_path.write_text(
        "".join(
            json.dumps(
                row,
            )
            + "\n"
            for row in rows
        ),
        encoding="utf-8",
    )

    report_rows, summary = (
        load_completed_dry_run_report(
            report_path,
        )
    )

    assert len(
        report_rows,
    ) == 1

    assert summary[
        "dry_run"
    ] is True

    assert report_metadata(
        report_rows[0],
    ) == {
        "source":
            "apple",
        "recording_id":
            "apple:1",
        "genre":
            "Pop",
        "release_year":
            2024,
        "confidence":
            0.97,
    }


def test_report_replay_rejects_incomplete_report(tmp_path) -> None:
    report_path = (
        tmp_path
        / "incomplete.jsonl"
    )

    report_path.write_text(
        json.dumps(
            {
                "track_id":
                    "00000000-0000-0000-0000-000000000001",
                "status":
                    "would_update",
                "provider_genre":
                    "Rock",
                "confidence":
                    0.95,
            },
        )
        + "\n",
        encoding="utf-8",
    )

    with pytest.raises(
        ValueError,
        match="completion summary",
    ):
        load_completed_dry_run_report(
            report_path,
        )
