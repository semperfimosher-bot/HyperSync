from types import SimpleNamespace

from backend.app.services.autoplay import (
    CONTEXT_DECAY,
    _build_context_affinity,
)


def _track(
    *,
    artist: str,
    genre: str | None,
    album: str | None = None,
):
    return SimpleNamespace(
        artist=artist,
        genre=genre,
        album=album,
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
