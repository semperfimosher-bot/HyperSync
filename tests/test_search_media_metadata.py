from types import SimpleNamespace
from uuid import uuid4

from backend.app.api.routes import (
    search as search_route,
)


def test_search_track_serialization_exposes_media_cache_metadata() -> None:
    track = SimpleNamespace(
        id=uuid4(),
        title="Fast Song",
        artist="HyperSync",
        album="Direct B2",
        duration_seconds=180,
        mime_type="audio/mpeg",
        file_size=5_000_000,
        b2_object_key="https://media.example.test/audio/fast-song.mp3",
        artwork_object_key=None,
    )

    rows = [
        {
            "track": track,
            "match_label": "EXACT TITLE",
            "matched_field": "title",
            "user_play_count": 0,
            "global_play_count": 0,
            "last_played_at": None,
        }
    ]

    results = search_route._serialize_tracks(
        rows,
    )

    assert len(results) == 1

    result = results[0]

    assert (
        getattr(
            result,
            "mime_type",
            None,
        )
        == "audio/mpeg"
    )

    assert (
        getattr(
            result,
            "file_size",
            None,
        )
        == 5_000_000
    )

    assert (
        getattr(
            result,
            "media_version",
            None,
        )
        is not None
    )
