import pytest

from backend.app.services import (
    on_demand_metadata,
)
from backend.app.services.on_demand_metadata import (
    CatalogTrackCandidate,
    merge_catalog_candidates,
    rank_catalog_candidates_for_kind,
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


def test_artist_mode_only_keeps_matching_primary_artist() -> None:
    morgan = _candidate(
        provider="deezer",
        key="morgan",
        title="Love Somebody",
        artist="Morgan Wallen",
        deezer_id="1",
    )

    secondary = _candidate(
        provider="itunes",
        key="secondary",
        title="Different Song",
        artist="Tate McRae & Morgan Wallen",
        apple_id="2",
    )

    result = rank_catalog_candidates_for_kind(
        [
            secondary,
            morgan,
        ],
        query="Morgan Wallen",
        kind="artist",
        limit=10,
    )

    assert [item.key for item in result] == [
        "morgan",
    ]


def test_album_mode_orders_tracks_by_album_track_number() -> None:
    track_two = _candidate(
        provider="deezer",
        key="two",
        title="Track Two",
        deezer_id="2",
    )

    track_one = _candidate(
        provider="deezer",
        key="one",
        title="Track One",
        deezer_id="1",
    )

    track_two = CatalogTrackCandidate(
        **{
            **track_two.as_dict(),
            "album": "One Thing at a Time",
            "track_number": 2,
        }
    )

    track_one = CatalogTrackCandidate(
        **{
            **track_one.as_dict(),
            "album": "One Thing at a Time",
            "track_number": 1,
        }
    )

    result = rank_catalog_candidates_for_kind(
        [
            track_two,
            track_one,
        ],
        query="One Thing at a Time",
        kind="album",
        limit=10,
    )

    assert [item.key for item in result] == [
        "one",
        "two",
    ]



@pytest.mark.asyncio
async def test_metadata_search_supports_500_artist_results(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    candidates = [
        _candidate(
            provider="deezer",
            key=f"track-{index}",
            title=f"Song {index}",
            artist="Example Artist",
            deezer_id=str(index),
        )
        for index in range(500)
    ]

    requested_limits: list[int] = []

    async def fake_deezer(
        query: str,
        *,
        limit: int,
    ) -> list[CatalogTrackCandidate]:
        assert query == "Example Artist"
        requested_limits.append(
            limit,
        )
        return candidates

    async def fake_itunes(
        query: str,
        *,
        limit: int,
    ) -> list[CatalogTrackCandidate]:
        assert query == "Example Artist"
        requested_limits.append(
            limit,
        )
        return []

    monkeypatch.setattr(
        on_demand_metadata,
        "_search_deezer",
        fake_deezer,
    )

    monkeypatch.setattr(
        on_demand_metadata,
        "_search_itunes",
        fake_itunes,
    )

    result = (
        await on_demand_metadata
        .search_catalog_metadata(
            "Example Artist",
            limit=500,
            kind="artist",
        )
    )

    assert len(result) == 500

    assert requested_limits == [
        500,
        500,
    ]
