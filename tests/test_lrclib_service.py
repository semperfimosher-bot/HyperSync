import importlib
from types import SimpleNamespace

import httpx
import pytest


def load_lrclib_module():
    try:
        return importlib.import_module(
            "backend.app.services.lrclib",
        )
    except ModuleNotFoundError:
        return None


@pytest.mark.asyncio
async def test_lrclib_fetch_maps_synced_result(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    lrclib = load_lrclib_module()

    assert lrclib is not None

    monkeypatch.setattr(
        lrclib,
        "_blocked_until",
        0.0,
    )

    monkeypatch.setattr(
        lrclib,
        "get_settings",
        lambda: SimpleNamespace(
            lrclib_base_url=(
                "https://lrclib.test"
            ),
            lrclib_client_name=(
                "HyperSync test client"
            ),
        ),
    )

    def handler(
        request: httpx.Request,
    ) -> httpx.Response:
        assert (
            request.url.path
            == "/api/get"
        )

        assert (
            request.url.params[
                "track_name"
            ]
            == "Test Song"
        )

        assert (
            request.url.params[
                "artist_name"
            ]
            == "Test Artist"
        )

        assert (
            request.url.params[
                "album_name"
            ]
            == "Test Album"
        )

        assert (
            request.url.params[
                "duration"
            ]
            == "180"
        )

        assert (
            request.headers[
                "user-agent"
            ]
            == "HyperSync test client"
        )

        return httpx.Response(
            200,
            json={
                "id": 12345,
                "instrumental": False,
                "plainLyrics": (
                    "First line\n"
                    "Second line"
                ),
                "syncedLyrics": (
                    "[00:01.00] First line\n"
                    "[00:05.50] Second line"
                ),
            },
        )

    real_async_client = (
        httpx.AsyncClient
    )

    def fake_async_client(
        *args,
        **kwargs,
    ):
        return real_async_client(
            *args,
            transport=httpx.MockTransport(
                handler,
            ),
            **kwargs,
        )

    monkeypatch.setattr(
        lrclib.httpx,
        "AsyncClient",
        fake_async_client,
    )

    result = (
        await lrclib.fetch_lrclib_lyrics(
            title="Test Song",
            artist="Test Artist",
            album="Test Album",
            duration_seconds=180,
        )
    )

    assert result == {
        "id": 12345,
        "instrumental": False,
        "plain_lyrics": (
            "First line\n"
            "Second line"
        ),
        "synced_lyrics": (
            "[00:01.00] First line\n"
            "[00:05.50] Second line"
        ),
    }


@pytest.mark.asyncio
async def test_lrclib_404_means_not_found(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    lrclib = load_lrclib_module()

    assert lrclib is not None

    monkeypatch.setattr(
        lrclib,
        "_blocked_until",
        0.0,
    )

    monkeypatch.setattr(
        lrclib,
        "get_settings",
        lambda: SimpleNamespace(
            lrclib_base_url=(
                "https://lrclib.test"
            ),
            lrclib_client_name=(
                "HyperSync test client"
            ),
        ),
    )

    def handler(
        request: httpx.Request,
    ) -> httpx.Response:
        return httpx.Response(
            404,
        )

    real_async_client = (
        httpx.AsyncClient
    )

    def fake_async_client(
        *args,
        **kwargs,
    ):
        return real_async_client(
            *args,
            transport=httpx.MockTransport(
                handler,
            ),
            **kwargs,
        )

    monkeypatch.setattr(
        lrclib.httpx,
        "AsyncClient",
        fake_async_client,
    )

    result = (
        await lrclib.fetch_lrclib_lyrics(
            title="Missing Song",
            artist="Missing Artist",
            album="Missing Album",
            duration_seconds=180,
        )
    )

    assert result is None
    