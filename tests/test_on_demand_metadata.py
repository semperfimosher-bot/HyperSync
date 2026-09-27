from backend.app.services.on_demand_metadata import (
    CatalogTrackCandidate,
    merge_catalog_candidates,
)


def _candidate(
    *,
    provider: str,
    key: str,
    title: str = "Love Somebody",
    artist: str = "Morgan Wallen",
    duration: int = 204,
    isrc: str | None = None,
    deezer_id: str | None = None,
    apple_id: str | None = None,
    genre: str | None = None,
) -> CatalogTrackCandidate:
    return CatalogTrackCandidate(
        key=key,
        title=title,
        artist=artist,
        album="One Thing at a Time",
        duration_seconds=duration,
        artwork_url="https://example.test/art.jpg",
        genre=genre,
        release_year=2024,
        explicit=False,
        track_number=1,
        disc_number=1,
        isrc=isrc,
        deezer_track_id=deezer_id,
        apple_track_id=apple_id,
        provider=provider,
        confidence=0.95,
    )


def test_deezer_and_itunes_merge_into_one_canonical_track() -> None:
    deezer = _candidate(
        provider="deezer",
        key="deezer",
        isrc="USUG12400001",
        deezer_id="123",
        genre=None,
    )

    apple = _candidate(
        provider="itunes",
        key="apple",
        apple_id="456",
        genre="Country",
    )

    merged = merge_catalog_candidates(
        [deezer],
        [apple],
        limit=10,
    )

    assert len(merged) == 1

    track = merged[0]

    assert track.provider == "deezer+itunes"
    assert track.isrc == "USUG12400001"
    assert track.deezer_track_id == "123"
    assert track.apple_track_id == "456"
    assert track.genre == "Country"
    assert track.title == "Love Somebody"
    assert track.artist == "Morgan Wallen"


def test_metadata_merge_does_not_collapse_large_duration_mismatch() -> None:
    deezer = _candidate(
        provider="deezer",
        key="deezer",
        duration=204,
        deezer_id="123",
    )

    apple = _candidate(
        provider="itunes",
        key="apple",
        duration=260,
        apple_id="456",
    )

    merged = merge_catalog_candidates(
        [deezer],
        [apple],
        limit=10,
    )

    assert len(merged) == 2
