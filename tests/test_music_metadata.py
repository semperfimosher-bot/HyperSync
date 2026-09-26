from __future__ import annotations

import httpx
import pytest

from backend.app.services.music_metadata import (
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
