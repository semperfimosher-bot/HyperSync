from types import SimpleNamespace

import httpx
import pytest

from backend.app.services import (
    lrclib,
)


def configure_test_client(
    monkeypatch: pytest.MonkeyPatch,
    handler,
) -> None:
    monkeypatch.setattr(
        lrclib,
        "_blocked_until",
        0.0,
    )

    monkeypatch.setattr(
        lrclib,
        "get_settings",
        lambda: SimpleNamespace(
            lrclib_base_url=("https://lrclib.test"),
            lrclib_client_name=("HyperSync test"),
            lrclib_retry_attempts=2,
            lrclib_retry_base_delay_seconds=0.0,
            lrclib_retry_max_delay_seconds=0.0,
        ),
    )

    real_client = httpx.AsyncClient

    def fake_client(
        *args,
        **kwargs,
    ):
        return real_client(
            *args,
            transport=(
                httpx.MockTransport(
                    handler,
                )
            ),
            **kwargs,
        )

    monkeypatch.setattr(
        lrclib.httpx,
        "AsyncClient",
        fake_client,
    )


@pytest.mark.asyncio
async def test_exact_lrclib_match_is_used(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def handler(
        request: httpx.Request,
    ) -> httpx.Response:
        assert request.url.path == "/api/get"

        return httpx.Response(
            200,
            json={
                "id": 100,
                "trackName": ("Test Song"),
                "artistName": ("Test Artist"),
                "albumName": ("Test Album"),
                "duration": 180,
                "instrumental": False,
                "plainLyrics": ("First line"),
                "syncedLyrics": ("[00:01.00] First line"),
            },
        )

    configure_test_client(
        monkeypatch,
        handler,
    )

    result = await lrclib.fetch_lrclib_lyrics(
        title="Test Song",
        artist="Test Artist",
        album="Test Album",
        duration_seconds=180,
    )

    assert result is not None

    assert result["id"] == 100


@pytest.mark.asyncio
async def test_search_fallback_chooses_matching_duration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def handler(
        request: httpx.Request,
    ) -> httpx.Response:
        if request.url.path == "/api/get":
            return httpx.Response(
                404,
            )

        assert request.url.path == "/api/search"

        return httpx.Response(
            200,
            json=[
                {
                    "id": 200,
                    "trackName": ("Test Song"),
                    "artistName": ("Test Artist"),
                    "albumName": ("Different Album"),
                    "duration": 225,
                    "instrumental": False,
                    "plainLyrics": ("Wrong version"),
                    "syncedLyrics": ("[00:01.00] Wrong version"),
                },
                {
                    "id": 201,
                    "trackName": ("Test Song"),
                    "artistName": ("Test Artist"),
                    "albumName": ("Correct Album"),
                    "duration": 207,
                    "instrumental": False,
                    "plainLyrics": ("Correct version"),
                    "syncedLyrics": ("[00:01.00] Correct version"),
                },
            ],
        )

    configure_test_client(
        monkeypatch,
        handler,
    )

    result = await lrclib.fetch_lrclib_lyrics(
        title="Test Song",
        artist="Test Artist",
        album="Single",
        duration_seconds=207,
    )

    assert result is not None

    assert result["id"] == 201


@pytest.mark.asyncio
async def test_search_normalizes_artist_punctuation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def handler(
        request: httpx.Request,
    ) -> httpx.Response:
        if request.url.path == "/api/get":
            return httpx.Response(
                404,
            )

        return httpx.Response(
            200,
            json=[
                {
                    "id": 300,
                    "trackName": ("Test Song"),
                    "artistName": ("Artist One/Artist Two"),
                    "albumName": ("Album"),
                    "duration": 207,
                    "instrumental": False,
                    "plainLyrics": ("Matching text"),
                    "syncedLyrics": ("[00:01.00] Matching text"),
                },
            ],
        )

    configure_test_client(
        monkeypatch,
        handler,
    )

    result = await lrclib.fetch_lrclib_lyrics(
        title="Test Song",
        artist=("Artist One & Artist Two"),
        album="Single",
        duration_seconds=207,
    )

    assert result is not None

    assert result["id"] == 300


@pytest.mark.asyncio
async def test_search_rejects_wrong_duration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def handler(
        request: httpx.Request,
    ) -> httpx.Response:
        if request.url.path == "/api/get":
            return httpx.Response(
                404,
            )

        return httpx.Response(
            200,
            json=[
                {
                    "id": 400,
                    "trackName": ("Test Song"),
                    "artistName": ("Test Artist"),
                    "albumName": ("Album"),
                    "duration": 225,
                    "instrumental": False,
                    "plainLyrics": None,
                    "syncedLyrics": None,
                },
            ],
        )

    configure_test_client(
        monkeypatch,
        handler,
    )

    result = await lrclib.fetch_lrclib_lyrics(
        title="Test Song",
        artist="Test Artist",
        album="Single",
        duration_seconds=207,
    )

    assert result is None


@pytest.mark.asyncio
async def test_transient_server_error_is_retried(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = 0

    def handler(
        request: httpx.Request,
    ) -> httpx.Response:
        nonlocal calls
        calls += 1

        return httpx.Response(
            503 if calls == 1 else 200,
            json=(
                {
                    "id": 500,
                    "instrumental": False,
                    "plainLyrics": "Recovered",
                    "syncedLyrics": None,
                }
                if calls > 1
                else None
            ),
        )

    configure_test_client(monkeypatch, handler)

    result = await lrclib.fetch_lrclib_lyrics(
        title="Test Song",
        artist="Test Artist",
        album=None,
        duration_seconds=None,
    )

    assert result is not None
    assert result["id"] == 500
    assert calls == 2


@pytest.mark.asyncio
async def test_transport_failure_is_retried_then_becomes_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = 0

    def handler(
        request: httpx.Request,
    ) -> httpx.Response:
        nonlocal calls
        calls += 1
        raise httpx.ConnectError("temporary connection failure", request=request)

    configure_test_client(monkeypatch, handler)

    with pytest.raises(lrclib.LrclibUnavailableError):
        await lrclib.fetch_lrclib_lyrics(
            title="Test Song",
            artist="Test Artist",
            album=None,
            duration_seconds=None,
        )

    assert calls == 2
