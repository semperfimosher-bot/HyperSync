from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.api.routes import (
    search as search_route,
)
from backend.app.api.routes.search import (
    SearchTrackResult,
    _album_results,
    _artist_results,
    _collaboration_results,
    extract_featured_artists,
)
from backend.app.services.search import (
    ParsedSearch,
    parse_search_query,
)


def test_new_release_cutoff_is_exactly_fourteen_days():
    now = datetime(
        2026,
        9,
        6,
        12,
        0,
        tzinfo=UTC,
    )

    cutoff = search_route._new_release_cutoff(
        now,
    )

    assert cutoff == (
        now
        - timedelta(
            days=14,
        )
    )


def test_top_artist_results_rank_by_total_plays():
    assert hasattr(
        search_route,
        "_build_top_artist_results",
    )

    results = search_route._build_top_artist_results(
        [
            (
                "Post Malone",
                11,
                4,
            ),
            (
                "Justin Bieber",
                24,
                3,
            ),
            (
                "Don Toliver",
                8,
                2,
            ),
        ],
    )

    assert [result.name for result in results] == [
        "Justin Bieber",
        "Post Malone",
        "Don Toliver",
    ]

    assert results[0].track_count == 3

    assert results[0].match_label == "TOP ARTIST"


def test_top_album_results_rank_by_total_plays():
    assert hasattr(
        search_route,
        "_build_top_album_results",
    )

    results = search_route._build_top_album_results(
        [
            (
                "Stoney",
                "Post Malone",
                9,
                4,
            ),
            (
                "Justice",
                "Justin Bieber",
                21,
                5,
            ),
            (
                "Hollywood's Bleeding",
                "Post Malone",
                13,
                3,
            ),
        ],
    )

    assert [result.title for result in results] == [
        "Justice",
        "Hollywood's Bleeding",
        "Stoney",
    ]

    assert results[0].artist == "Justin Bieber"

    assert results[0].track_count == 5

    assert results[0].match_label == "TOP ALBUM"


def _track(
    *,
    title: str,
    artist: str,
    album: str | None,
    matched_field: str,
    match_label: str = "MATCH",
) -> SearchTrackResult:
    return SearchTrackResult(
        id=uuid4(),
        title=title,
        artist=artist,
        album=album,
        duration_seconds=180,
        audio_url=None,
        artwork_url=None,
        match_label=match_label,
        matched_field=matched_field,
    )


def test_artist_results_only_include_relevant_artists() -> None:
    parsed = parse_search_query(
        "justin bieber",
    )

    tracks = [
        _track(
            title=("Deja Vu (feat. Justin Bieber)"),
            artist="Post Malone",
            album="Stoney",
            matched_field="title",
        ),
        _track(
            title="Ghost",
            artist="Justin Bieber",
            album="Justice",
            matched_field="artist",
        ),
    ]

    artists = _artist_results(
        tracks,
        parsed,
    )

    assert [artist.name for artist in artists] == [
        "Justin Bieber",
    ]


def test_direct_song_match_returns_related_album() -> None:
    parsed = parse_search_query(
        "peaches",
    )

    tracks = [
        _track(
            title="Peaches",
            artist="Justin Bieber",
            album="Justice",
            matched_field="title",
            match_label="EXACT MATCH",
        ),
    ]

    albums = _album_results(
        tracks,
        parsed,
    )

    assert [album.title for album in albums] == [
        "Justice",
    ]


def test_artist_match_can_return_that_artists_album() -> None:
    parsed = parse_search_query(
        "justin bieber",
    )

    tracks = [
        _track(
            title="Ghost",
            artist="Justin Bieber",
            album="Justice",
            matched_field="artist",
        ),
    ]

    albums = _album_results(
        tracks,
        parsed,
    )

    assert [album.title for album in albums] == [
        "Justice",
    ]


def test_extract_featured_artist_from_title() -> None:
    assert extract_featured_artists(
        "Deja Vu (feat. Justin Bieber)",
    ) == ("Justin Bieber",)


def test_extract_multiple_featured_artists() -> None:
    assert extract_featured_artists(
        ("Example Song (feat. Artist One & Artist Two)"),
    ) == (
        "Artist One",
        "Artist Two",
    )


def test_collaborations_work_in_both_directions() -> None:
    parsed = parse_search_query(
        "justin bieber",
    )

    tracks = [
        _track(
            title=("Deja Vu (feat. Justin Bieber)"),
            artist="Post Malone",
            album="Stoney",
            matched_field="title",
        ),
        _track(
            title=("Example (feat. Don Toliver)"),
            artist="Justin Bieber",
            album="Justice",
            matched_field="artist",
        ),
    ]

    collaborations = _collaboration_results(
        tracks,
        parsed,
    )

    assert {collaboration.name for collaboration in collaborations} == {
        "Post Malone",
        "Don Toliver",
    }


def test_direct_song_match_expands_related_sections() -> None:
    parsed = parse_search_query(
        "Deja Vu",
    )

    tracks = [
        _track(
            title=("Deja Vu (feat. Justin Bieber)"),
            artist="Post Malone",
            album="Stoney",
            matched_field="title",
            match_label="STRONG MATCH",
        ),
    ]

    artists = _artist_results(
        tracks,
        parsed,
    )

    collaborations = _collaboration_results(
        tracks,
        parsed,
    )

    albums = _album_results(
        tracks,
        parsed,
    )

    assert [artist.name for artist in artists] == [
        "Post Malone",
    ]

    assert [collaboration.name for collaboration in collaborations] == [
        "Justin Bieber",
    ]

    assert [album.title for album in albums] == [
        "Stoney",
    ]


def test_direct_song_keeps_featured_artist_out_of_artists() -> None:
    parsed = parse_search_query(
        "Deja Vu",
    )

    tracks = [
        _track(
            title=("Deja Vu (feat. Justin Bieber)"),
            artist="Post Malone",
            album="Stoney",
            matched_field="title",
            match_label="STRONG MATCH",
        ),
    ]

    artists = _artist_results(
        tracks,
        parsed,
    )

    names = {artist.name for artist in artists}

    assert "Post Malone" in names

    assert "Justin Bieber" not in names


def test_direct_album_match_expands_artists_and_collaborators() -> None:
    parsed = parse_search_query(
        "Stoney",
    )

    tracks = [
        _track(
            title=("Deja Vu (feat. Justin Bieber)"),
            artist="Post Malone",
            album="Stoney",
            matched_field="album",
            match_label="EXACT MATCH",
        ),
        _track(
            title=("Congratulations (feat. Quavo)"),
            artist="Post Malone",
            album="Stoney",
            matched_field="album",
            match_label="EXACT MATCH",
        ),
    ]

    artists = _artist_results(
        tracks,
        parsed,
    )

    collaborations = _collaboration_results(
        tracks,
        parsed,
    )

    albums = _album_results(
        tracks,
        parsed,
    )

    assert {artist.name for artist in artists} == {
        "Post Malone",
    }

    assert {collaboration.name for collaboration in collaborations} == {
        "Justin Bieber",
        "Quavo",
    }

    assert {album.title for album in albums} == {
        "Stoney",
    }


def test_direct_album_does_not_put_featured_artists_in_artists() -> None:
    parsed = parse_search_query(
        "Stoney",
    )

    tracks = [
        _track(
            title=("Deja Vu (feat. Justin Bieber)"),
            artist="Post Malone",
            album="Stoney",
            matched_field="album",
            match_label="EXACT MATCH",
        ),
    ]

    artists = _artist_results(
        tracks,
        parsed,
    )

    names = {artist.name for artist in artists}

    assert names == {
        "Post Malone",
    }


@pytest.mark.asyncio
async def test_general_track_search_does_not_use_new_release_cutoff(
    monkeypatch,
):
    class FakeDialect:
        name = "postgresql"

    class FakeBind:
        dialect = FakeDialect()

    class FakeScalars:
        def all(self):
            return []

    class FakeResult:
        def scalars(self):
            return FakeScalars()

    execute_mock = AsyncMock(
        return_value=FakeResult(),
    )

    session = cast(
        AsyncSession,
        SimpleNamespace(
            get_bind=lambda: FakeBind(),
            execute=execute_mock,
        ),
    )

    def fail_if_called():
        raise AssertionError("general search must not use the new-release cutoff")

    monkeypatch.setattr(
        search_route,
        "_new_release_cutoff",
        fail_if_called,
    )

    parsed = ParsedSearch(
        raw="post",
        term="post",
        intent="general",
        field_hint="any",
    )

    results = await search_route._load_track_candidates(
        session,
        parsed,
        None,
    )

    assert results == []
    assert execute_mock.await_count == 1


@pytest.mark.asyncio
async def test_find_people_directory_returns_all_users_alphabetically(
    monkeypatch,
):
    usernames = [
        "zoe",
        "Mike",
        "alex",
        "Charlie",
        "bravo",
        "delta",
        "echo",
        "foxtrot",
        "golf",
        "hotel",
        "india",
        "juliet",
        "kilo",
        "lima",
        "november",
        "oscar",
        "papa",
        "quebec",
        "romeo",
        "sierra",
        "tango",
        "uniform",
        "victor",
        "whiskey",
        "xray",
        "yankee",
    ]

    created_at = datetime(
        2026,
        1,
        1,
        tzinfo=UTC,
    )

    rows = [
        (
            SimpleNamespace(
                username=username,
                profile=None,
                created_at=created_at,
            ),
            0,
        )
        for username in usernames
    ]

    class FakeResult:
        def all(self):
            return rows

    execute_mock = AsyncMock(
        return_value=FakeResult(),
    )

    session = cast(
        AsyncSession,
        SimpleNamespace(
            execute=execute_mock,
        ),
    )

    monkeypatch.setattr(
        search_route,
        "avatar_url",
        lambda _user: None,
    )

    parsed = ParsedSearch(
        raw="find people",
        term="",
        intent="people",
        field_hint="people",
    )

    results = await search_route._search_people(
        session,
        parsed,
    )

    assert len(results) == 26

    assert [result.username for result in results] == sorted(
        usernames,
        key=str.casefold,
    )
