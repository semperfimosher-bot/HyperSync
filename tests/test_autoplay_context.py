from types import SimpleNamespace
from typing import cast

from backend.app.api.routes.recommendations import (
    AutoplayRequest,
    _catalog_uuid_list,
    _catalog_uuid_or_none,
)
from backend.app.models.media import Track
from backend.app.services.autoplay import (
    CONTEXT_DECAY,
    CONTEXT_TRACK_LIMIT,
    RECENT_SESSION_LIMIT,
    _build_context_affinity,
    _genre_family,
    _recent_session_weight,
)


def _track(
    *,
    artist: str,
    genre: str | None,
    album: str | None = None,
) -> Track:
    return cast(
        Track,
        SimpleNamespace(
            artist=artist,
            genre=genre,
            album=album,
        ),
    )


def test_recent_context_weights_newest_track_most() -> None:
    (
        artist_context,
        genre_context,
        album_context,
    ) = _build_context_affinity(
        [
            _track(
                artist="Older Artist",
                genre="Rock",
                album="Older Album",
            ),
            _track(
                artist="Newest Artist",
                genre="Pop",
                album="Newest Album",
            ),
        ],
    )

    assert (
        artist_context[
            "newest artist"
        ]
        == 1.0
    )

    assert (
        artist_context[
            "older artist"
        ]
        == CONTEXT_DECAY
    )

    assert (
        genre_context[
            "pop"
        ]
        >
        genre_context[
            "rock"
        ]
    )

    assert (
        album_context[
            "newest album"
        ]
        >
        album_context[
            "older album"
        ]
    )


def test_repeated_recent_genre_builds_strong_context_signal() -> None:
    (
        artist_context,
        genre_context,
        _album_context,
    ) = _build_context_affinity(
        [
            _track(
                artist="Artist A",
                genre="Hip-Hop",
            ),
            _track(
                artist="Artist B",
                genre="Hip-Hop",
            ),
            _track(
                artist="Artist C",
                genre="Pop",
            ),
        ],
    )

    assert (
        genre_context[
            "hip-hop"
        ]
        >
        genre_context[
            "pop"
        ]
    )

    assert (
        artist_context[
            "artist c"
        ]
        >
        artist_context[
            "artist a"
        ]
    )


def test_context_ignores_missing_metadata_without_losing_other_signals() -> None:
    (
        artist_context,
        genre_context,
        album_context,
    ) = _build_context_affinity(
        [
            _track(
                artist="Known Artist",
                genre=None,
                album=None,
            ),
        ],
    )

    assert artist_context == {
        "known artist": 1.0,
    }

    assert genre_context == {}
    assert album_context == {}


def test_context_window_uses_exactly_twelve_recent_tracks() -> None:
    tracks = [
        _track(
            artist=f"Artist {index}",
            genre=f"Genre {index}",
        )
        for index in range(
            CONTEXT_TRACK_LIMIT + 1
        )
    ]

    (
        artist_context,
        genre_context,
        _album_context,
    ) = _build_context_affinity(
        tracks,
    )

    assert CONTEXT_TRACK_LIMIT == 12
    assert "artist 0" not in artist_context
    assert "genre 0" not in genre_context
    assert "artist 1" in artist_context
    assert "artist 12" in artist_context


def test_recent_session_signal_stops_after_twelve_songs() -> None:
    assert RECENT_SESSION_LIMIT == 12
    assert _recent_session_weight(0) == 1.0
    assert _recent_session_weight(11) > 0
    assert _recent_session_weight(12) == 0.0


def test_genre_family_keeps_country_away_from_rap() -> None:
    assert (
        _genre_family(
            "Country",
        )
        == "country"
    )

    assert (
        _genre_family(
            "Americana / Country",
        )
        == "country"
    )

    assert (
        _genre_family(
            "Hip-Hop/Rap",
        )
        == "hip-hop"
    )

    assert (
        _genre_family(
            "Country",
        )
        != _genre_family(
            "Hip-Hop/Rap",
        )
    )


def test_autoplay_request_tolerates_temporary_on_demand_ids() -> None:
    valid = (
        "9e061d5c-5ae4-4db9-8bb1-ef55bdd7af33"
    )

    payload = AutoplayRequest(
        current_track_id=valid,
        exclude_track_ids=[
            "ondemand:temporary",
            valid,
            "not-a-uuid",
        ],
        context_track_ids=[
            "ondemand:older",
            valid,
        ],
        limit=8,
    )

    assert str(
        _catalog_uuid_or_none(
            payload.current_track_id,
        )
    ) == valid

    assert [
        str(
            track_id,
        )
        for track_id in
        _catalog_uuid_list(
            payload.exclude_track_ids,
            limit=100,
        )
    ] == [
        valid,
    ]

    assert [
        str(
            track_id,
        )
        for track_id in
        _catalog_uuid_list(
            payload.context_track_ids,
            limit=12,
        )
    ] == [
        valid,
    ]


def test_autoplay_temporary_current_track_becomes_none() -> None:
    assert (
        _catalog_uuid_or_none(
            "ondemand:temporary-current",
        )
        is None
    )


def test_autoplay_request_model_accepts_stale_mixed_browser_state() -> None:
    payload = AutoplayRequest(
        current_track_id={
            "stale":
                True,
        },
        exclude_track_ids=[
            "ondemand:temporary",
            None,
            {
                "id":
                    "bad",
            },
        ]
        * 80,
        context_track_ids="stale-string",
        limit="999",
    )

    assert (
        _catalog_uuid_or_none(
            payload.current_track_id,
        )
        is None
    )

    assert (
        _catalog_uuid_list(
            payload.exclude_track_ids,
            limit=100,
        )
        == []
    )

    assert (
        _catalog_uuid_list(
            payload.context_track_ids,
            limit=12,
        )
        == []
    )
