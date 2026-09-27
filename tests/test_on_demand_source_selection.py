from backend.app.services.on_demand_metadata import (
    CatalogTrackCandidate,
)
from bot.youtube_source import (
    rank_source_candidates,
    score_source_candidate,
)


def _metadata(
    title: str = "Love Somebody",
) -> CatalogTrackCandidate:
    return CatalogTrackCandidate(
        key="music:test",
        title=title,
        artist="Morgan Wallen",
        album="One Thing at a Time",
        duration_seconds=204,
        artwork_url=None,
        genre="Country",
        release_year=2024,
        explicit=False,
        track_number=1,
        disc_number=1,
        isrc="USUG12400001",
        deezer_track_id="123",
        apple_track_id="456",
        provider="deezer+itunes",
        confidence=0.98,
    )


def test_source_ranking_prefers_clean_official_audio_over_live_and_remix() -> None:
    metadata = _metadata()

    entries = [
        {
            "id": "live",
            "title": "Morgan Wallen - Love Somebody (Live)",
            "uploader": "Fan Channel",
            "duration": 242,
            "view_count": 5_000_000,
        },
        {
            "id": "remix",
            "title": "Love Somebody Remix - Morgan Wallen",
            "uploader": "Remix Channel",
            "duration": 205,
            "view_count": 8_000_000,
        },
        {
            "id": "official",
            "title": "Morgan Wallen - Love Somebody (Official Audio)",
            "uploader": "Morgan Wallen - Topic",
            "duration": 204,
            "view_count": 1_000_000,
        },
    ]

    ranked = rank_source_candidates(
        entries,
        metadata,
    )

    assert ranked[0][1]["id"] == "official"

    assert ranked[0][0] > ranked[1][0]
    assert ranked[0][0] > 38


def test_requested_remix_is_not_penalized_as_an_unwanted_version() -> None:
    metadata = _metadata(
        "Love Somebody (Remix)",
    )

    remix = {
        "id": "remix",
        "title": "Morgan Wallen - Love Somebody Remix",
        "uploader": "Morgan Wallen",
        "duration": 204,
    }

    regular = {
        "id": "regular",
        "title": "Morgan Wallen - Love Somebody",
        "uploader": "Morgan Wallen - Topic",
        "duration": 204,
    }

    assert (
        score_source_candidate(
            remix,
            metadata,
        )
        >
        score_source_candidate(
            regular,
            metadata,
        )
    )
