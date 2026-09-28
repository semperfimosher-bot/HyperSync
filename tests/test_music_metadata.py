from __future__ import annotations

import httpx
import pytest
from sqlalchemy.ext.asyncio import (
    async_sessionmaker,
    create_async_engine,
)

from backend.app.models.base import Base
from backend.app.models.media import Track
from backend.app.services import (
    music_metadata,
)

from backend.app.services.music_metadata import (
    _merge_external_metadata,
    lookup_apple_track_metadata,
    lookup_external_track_metadata,
    lookup_lastfm_track_metadata,
)


@pytest.mark.asyncio
async def test_musicbrainz_lookup_returns_genre_and_release_year() -> None:
    def handler(
        request: httpx.Request,
    ) -> httpx.Response:
        assert (
            request.url.path
            == "/ws/2/recording/"
        )

        return httpx.Response(
            200,
            json={
                "recordings": [
                    {
                        "id":
                            "recording-1",
                        "score":
                            "100",
                        "title":
                            "Example Song",
                        "length":
                            183000,
                        "first-release-date":
                            "2022-09-16",
                        "artist-credit": [
                            {
                                "name":
                                    "Example Artist",
                                "artist": {
                                    "id":
                                        "artist-1",
                                    "name":
                                        "Example Artist",
                                },
                            }
                        ],
                        "genres": [
                            {
                                "name":
                                    "country",
                                "count":
                                    14,
                            }
                        ],
                    }
                ],
            },
        )

    async with httpx.AsyncClient(
        base_url="https://musicbrainz.test",
        transport=httpx.MockTransport(
            handler,
        ),
    ) as client:
        result = (
            await lookup_external_track_metadata(
                title="Example Song",
                artist="Example Artist",
                duration_seconds=182,
                client=client,
                throttle=False,
            )
        )

    assert result is not None
    assert result["source"] == "musicbrainz"
    assert (
        result["recording_id"]
        == "recording-1"
    )
    assert result["genre"] == "Country"
    assert result["release_year"] == 2022
    assert result["confidence"] >= 0.95


@pytest.mark.asyncio
async def test_musicbrainz_lookup_uses_recording_genres_when_search_has_none() -> None:
    def handler(
        request: httpx.Request,
    ) -> httpx.Response:
        if (
            request.url.path
            == "/ws/2/recording/"
        ):
            return httpx.Response(
                200,
                json={
                    "recordings": [
                        {
                            "id":
                                "recording-2",
                            "score":
                                "100",
                            "title":
                                "Night Drive",
                            "length":
                                210000,
                            "first-release-date":
                                "2020",
                            "artist-credit": [
                                {
                                    "name":
                                        "Example Artist",
                                    "artist": {
                                        "id":
                                            "artist-2",
                                        "name":
                                            "Example Artist",
                                    },
                                }
                            ],
                        }
                    ],
                },
            )

        if (
            request.url.path
            == "/ws/2/recording/recording-2"
        ):
            return httpx.Response(
                200,
                json={
                    "genres": [
                        {
                            "name":
                                "electronic",
                            "count":
                                7,
                        }
                    ],
                    "tags": [],
                },
            )

        raise AssertionError(
            request.url,
        )

    async with httpx.AsyncClient(
        base_url="https://musicbrainz.test",
        transport=httpx.MockTransport(
            handler,
        ),
    ) as client:
        result = (
            await lookup_external_track_metadata(
                title="Night Drive",
                artist="Example Artist",
                duration_seconds=210,
                client=client,
                throttle=False,
            )
        )

    assert result is not None
    assert result["genre"] == "Electronic"
    assert result["release_year"] == 2020


@pytest.mark.asyncio
async def test_musicbrainz_lookup_rejects_wrong_recording_duration() -> None:
    def handler(
        request: httpx.Request,
    ) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "recordings": [
                    {
                        "id":
                            "wrong-version",
                        "score":
                            "100",
                        "title":
                            "Same Song",
                        "length":
                            320000,
                        "first-release-date":
                            "2021",
                        "artist-credit": [
                            {
                                "name":
                                    "Same Artist",
                                "artist": {
                                    "id":
                                        "artist-3",
                                    "name":
                                        "Same Artist",
                                },
                            }
                        ],
                        "genres": [
                            {
                                "name":
                                    "pop",
                                "count":
                                    3,
                            }
                        ],
                    }
                ],
            },
        )

    async with httpx.AsyncClient(
        base_url="https://musicbrainz.test",
        transport=httpx.MockTransport(
            handler,
        ),
    ) as client:
        result = (
            await lookup_external_track_metadata(
                title="Same Song",
                artist="Same Artist",
                duration_seconds=180,
                client=client,
                throttle=False,
            )
        )

    assert result is None



@pytest.mark.asyncio
async def test_lastfm_lookup_returns_genre_and_album_release_year() -> None:
    def handler(
        request: httpx.Request,
    ) -> httpx.Response:
        method = (
            request.url.params.get(
                "method",
            )
        )

        if method == "track.getInfo":
            return httpx.Response(
                200,
                json={
                    "track": {
                        "name":
                            "Fallback Song",
                        "duration":
                            "184000",
                        "mbid":
                            "",
                        "artist": {
                            "name":
                                "Fallback Artist",
                        },
                        "album": {
                            "title":
                                "Fallback Album",
                        },
                        "toptags": {
                            "tag": [
                                {
                                    "name":
                                        "country",
                                },
                                {
                                    "name":
                                        "seen live",
                                },
                            ],
                        },
                    },
                },
            )

        if method == "album.getInfo":
            return httpx.Response(
                200,
                json={
                    "album": {
                        "name":
                            "Fallback Album",
                        "artist":
                            "Fallback Artist",
                        "releasedate":
                            "18 Oct 2024, 00:00",
                        "tags": {
                            "tag": [
                                {
                                    "name":
                                        "country",
                                }
                            ],
                        },
                    },
                },
            )

        raise AssertionError(
            method,
        )

    async with httpx.AsyncClient(
        base_url="https://lastfm.test",
        transport=httpx.MockTransport(
            handler,
        ),
    ) as client:
        result = (
            await lookup_lastfm_track_metadata(
                title="Fallback Song",
                artist="Fallback Artist",
                duration_seconds=184,
                client=client,
                api_key="test-key",
            )
        )

    assert result is not None
    assert result["source"] == "lastfm"
    assert result["genre"] == "Country"
    assert result["release_year"] == 2024
    assert result["confidence"] >= 0.94


@pytest.mark.asyncio
async def test_lastfm_lookup_rejects_wrong_artist_or_duration() -> None:
    def handler(
        request: httpx.Request,
    ) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "track": {
                    "name":
                        "Fallback Song",
                    "duration":
                        "320000",
                    "artist": {
                        "name":
                            "Wrong Artist",
                    },
                    "toptags": {
                        "tag": [
                            {
                                "name":
                                    "pop",
                            }
                        ],
                    },
                },
            },
        )

    async with httpx.AsyncClient(
        base_url="https://lastfm.test",
        transport=httpx.MockTransport(
            handler,
        ),
    ) as client:
        result = (
            await lookup_lastfm_track_metadata(
                title="Fallback Song",
                artist="Fallback Artist",
                duration_seconds=184,
                client=client,
                api_key="test-key",
            )
        )

    assert result is None


@pytest.mark.asyncio
async def test_apple_lookup_returns_genre_and_release_year() -> None:
    def handler(
        request: httpx.Request,
    ) -> httpx.Response:
        assert request.url.path == "/search"
        assert request.url.params.get("media") == "music"
        assert request.url.params.get("entity") == "song"

        return httpx.Response(
            200,
            json={
                "resultCount": 2,
                "results": [
                    {
                        "wrapperType":
                            "track",
                        "kind":
                            "song",
                        "trackId":
                            12345,
                        "trackName":
                            "Example Song",
                        "artistName":
                            "Example Artist",
                        "collectionName":
                            "Example Album",
                        "trackTimeMillis":
                            183000,
                        "primaryGenreName":
                            "Country",
                        "releaseDate":
                            "2023-06-02T12:00:00Z",
                    },
                    {
                        "wrapperType":
                            "track",
                        "kind":
                            "song",
                        "trackId":
                            99999,
                        "trackName":
                            "Example Song",
                        "artistName":
                            "Wrong Artist",
                        "trackTimeMillis":
                            183000,
                        "primaryGenreName":
                            "Pop",
                        "releaseDate":
                            "2021-01-01T12:00:00Z",
                    },
                ],
            },
        )

    async with httpx.AsyncClient(
        base_url="https://itunes.test",
        transport=httpx.MockTransport(
            handler,
        ),
    ) as client:
        result = await lookup_apple_track_metadata(
            title="Example Song",
            artist="Example Artist",
            duration_seconds=182,
            client=client,
            throttle=False,
        )

    assert result is not None
    assert result["source"] == "apple"
    assert result["recording_id"] == "12345"
    assert result["genre"] == "Country"
    assert result["release_year"] == 2023
    assert result["confidence"] >= 0.96


@pytest.mark.asyncio
async def test_apple_lookup_rejects_wrong_duration_or_weak_artist_match() -> None:
    def handler(
        request: httpx.Request,
    ) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "resultCount": 2,
                "results": [
                    {
                        "kind":
                            "song",
                        "trackId":
                            1,
                        "trackName":
                            "Same Song",
                        "artistName":
                            "Same Artist",
                        "trackTimeMillis":
                            320000,
                        "primaryGenreName":
                            "Country",
                        "releaseDate":
                            "2024-01-01T00:00:00Z",
                    },
                    {
                        "kind":
                            "song",
                        "trackId":
                            2,
                        "trackName":
                            "Same Song",
                        "artistName":
                            "Different Performer",
                        "trackTimeMillis":
                            180000,
                        "primaryGenreName":
                            "Pop",
                        "releaseDate":
                            "2024-01-01T00:00:00Z",
                    },
                ],
            },
        )

    async with httpx.AsyncClient(
        base_url="https://itunes.test",
        transport=httpx.MockTransport(
            handler,
        ),
    ) as client:
        result = await lookup_apple_track_metadata(
            title="Same Song",
            artist="Same Artist",
            duration_seconds=180,
            client=client,
            throttle=False,
        )

    assert result is None



def test_apple_catalog_genre_overrides_conflicting_lastfm_tag() -> None:
    result = _merge_external_metadata(
        {
            "source":
                "lastfm",
            "recording_id":
                None,
            "genre":
                "Pop",
            "release_year":
                2023,
            "confidence":
                0.97,
        },
        {
            "source":
                "apple",
            "recording_id":
                "12345",
            "genre":
                "Country",
            "release_year":
                2023,
            "confidence":
                0.99,
        },
        prefer_fallback_genre=True,
    )

    assert result is not None
    assert result["genre"] == "Country"
    assert result["release_year"] == 2023
    assert result["source"] == "lastfm+apple"


def test_lastfm_genre_remains_when_apple_has_no_genre() -> None:
    result = _merge_external_metadata(
        {
            "source":
                "lastfm",
            "recording_id":
                None,
            "genre":
                "Country",
            "release_year":
                2023,
            "confidence":
                0.96,
        },
        {
            "source":
                "apple",
            "recording_id":
                "12345",
            "genre":
                None,
            "release_year":
                2023,
            "confidence":
                0.99,
        },
        prefer_fallback_genre=True,
    )

    assert result is not None
    assert result["genre"] == "Country"


@pytest.mark.asyncio
async def test_metadata_enrichment_survives_playlist_refresh_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
    )

    async with engine.begin() as connection:
        await connection.run_sync(
            Base.metadata.create_all,
            tables=[
                Base.metadata.tables[
                    Track.__tablename__
                ],
            ],
        )

    factory = async_sessionmaker(
        engine,
        expire_on_commit=False,
    )

    async def fake_lookup(
        **_kwargs,
    ):
        return {
            "source":
                "test-provider",
            "recording_id":
                "recording-1",
            "genre":
                "Country",
            "release_year":
                2025,
            "confidence":
                0.99,
        }

    async def failed_playlist_refresh(
        _session,
        _track,
    ) -> int:
        raise RuntimeError(
            "playlist refresh failed",
        )

    monkeypatch.setattr(
        music_metadata,
        "lookup_external_track_metadata",
        fake_lookup,
    )

    monkeypatch.setattr(
        music_metadata,
        "refresh_smart_playlists_for_track",
        failed_playlist_refresh,
    )

    async with factory() as session:
        track = Track(
            title="Metadata Song",
            artist="Metadata Artist",
            album="Metadata Album",
            genre=None,
            release_year=None,
            b2_object_key="audio/metadata-song.mp3",
            mime_type="audio/mpeg",
            is_published=True,
        )

        session.add(
            track,
        )
        await session.commit()

        track_id = track.id

        result = await music_metadata.enrich_track_metadata(
            session,
            track,
        )

        assert result["matched"] is True
        assert result["changed"] is True
        assert result["genre"] == "Country"
        assert result["release_year"] == 2025

        persisted = await session.get(
            Track,
            track_id,
        )

        assert persisted is not None
        assert persisted.genre == "Country"
        assert persisted.release_year == 2025

    await engine.dispose()
