from uuid import UUID, uuid4

import pytest
from httpx import (
    ASGITransport,
    AsyncClient,
)

from backend.app.database import (
    get_session_factory,
)
from backend.app.main import app
from backend.app.models.media import (
    Track,
    TrackLyrics,
)


async def create_track(
    *,
    title: str,
    artist: str,
    album: str | None,
    duration_seconds: int | None,
    is_published: bool = True,
) -> UUID:
    track = Track(
        id=uuid4(),
        title=title,
        artist=artist,
        album=album,
        b2_object_key=(f"audio/lyrics-test-{uuid4().hex}.wav"),
        artwork_object_key=None,
        mime_type="audio/wav",
        file_size=4096,
        duration_seconds=(duration_seconds),
        is_published=is_published,
    )

    session_factory = get_session_factory()

    async with session_factory() as session:
        session.add(track)

        await session.commit()

    return track.id


@pytest.mark.asyncio
async def test_track_lyrics_returns_synced_result_and_caches_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    track_id = await create_track(
        title="Lyrics Test",
        artist="HyperSync Test",
        album="Test Album",
        duration_seconds=180,
    )

    calls = 0

    async def fake_fetch_lrclib_lyrics(
        *,
        title: str,
        artist: str,
        album: str | None,
        duration_seconds: int | None,
    ):
        nonlocal calls

        calls += 1

        assert title == ("Lyrics Test")

        assert artist == ("HyperSync Test")

        assert album == ("Test Album")

        assert duration_seconds == 180

        return {
            "id": 123456,
            "instrumental": False,
            "plain_lyrics": ("First line\nSecond line"),
            "synced_lyrics": ("[00:01.00] First line\n[00:05.50] Second line"),
        }

    monkeypatch.setattr(
        ("backend.app.api.routes.catalog.fetch_lrclib_lyrics"),
        fake_fetch_lrclib_lyrics,
    )

    transport = ASGITransport(
        app=app,
    )

    async with AsyncClient(
        transport=transport,
        base_url="http://test",
    ) as client:
        first = await client.get(
            (f"/api/catalog/tracks/{track_id}/lyrics"),
        )

        second = await client.get(
            (f"/api/catalog/tracks/{track_id}/lyrics"),
        )

    assert first.status_code == 200, first.text

    assert second.status_code == 200, second.text

    assert first.json() == {
        "status": "synced",
        "source": "lrclib",
        "lrclib_id": 123456,
        "instrumental": False,
        "plain_lyrics": None,
        "synced_lyrics": ("[00:01.00] First line\n[00:05.50] Second line"),
    }

    # First request uses LRCLIB.
    # Second request must use Postgres.
    assert calls == 1

    session_factory = get_session_factory()

    async with session_factory() as session:
        cached = await session.get(
            TrackLyrics,
            track_id,
        )

    assert cached is not None

    assert cached.synced_lyrics is not None

    assert cached.plain_lyrics is None


@pytest.mark.asyncio
async def test_track_lyrics_uses_plain_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    track_id = await create_track(
        title="Plain Lyrics Test",
        artist="HyperSync Test",
        album="Plain Album",
        duration_seconds=200,
    )

    async def fake_fetch_lrclib_lyrics(
        **kwargs,
    ):
        return {
            "id": 222222,
            "instrumental": False,
            "plain_lyrics": ("These lyrics are plain."),
            "synced_lyrics": None,
        }

    monkeypatch.setattr(
        ("backend.app.api.routes.catalog.fetch_lrclib_lyrics"),
        fake_fetch_lrclib_lyrics,
    )

    transport = ASGITransport(
        app=app,
    )

    async with AsyncClient(
        transport=transport,
        base_url="http://test",
    ) as client:
        response = await client.get(
            (f"/api/catalog/tracks/{track_id}/lyrics"),
        )

    assert response.status_code == 200, response.text

    payload = response.json()

    assert payload["status"] == "plain"

    assert payload["plain_lyrics"] == "These lyrics are plain."

    assert payload["synced_lyrics"] is None


@pytest.mark.asyncio
async def test_track_lyrics_reports_instrumental(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    track_id = await create_track(
        title="Instrumental Test",
        artist="HyperSync Test",
        album="Instrumental Album",
        duration_seconds=160,
    )

    async def fake_fetch_lrclib_lyrics(
        **kwargs,
    ):
        return {
            "id": 333333,
            "instrumental": True,
            "plain_lyrics": None,
            "synced_lyrics": None,
        }

    monkeypatch.setattr(
        ("backend.app.api.routes.catalog.fetch_lrclib_lyrics"),
        fake_fetch_lrclib_lyrics,
    )

    transport = ASGITransport(
        app=app,
    )

    async with AsyncClient(
        transport=transport,
        base_url="http://test",
    ) as client:
        response = await client.get(
            (f"/api/catalog/tracks/{track_id}/lyrics"),
        )

    assert response.status_code == 200, response.text

    assert response.json()["status"] == "instrumental"


@pytest.mark.asyncio
async def test_track_lyrics_temporarily_caches_not_found(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    track_id = await create_track(
        title="Missing Lyrics Test",
        artist="HyperSync Test",
        album="Missing Album",
        duration_seconds=190,
    )

    calls = 0

    async def fake_fetch_lrclib_lyrics(
        **kwargs,
    ):
        nonlocal calls

        calls += 1

        return None

    monkeypatch.setattr(
        ("backend.app.api.routes.catalog.fetch_lrclib_lyrics"),
        fake_fetch_lrclib_lyrics,
    )

    transport = ASGITransport(
        app=app,
    )

    async with AsyncClient(
        transport=transport,
        base_url="http://test",
    ) as client:
        first = await client.get(
            (f"/api/catalog/tracks/{track_id}/lyrics"),
        )

        second = await client.get(
            (f"/api/catalog/tracks/{track_id}/lyrics"),
        )

    assert first.status_code == 200, first.text

    assert second.status_code == 200, second.text

    assert first.json()["status"] == "not_found"

    assert second.json()["status"] == "not_found"

    # A missing result is cached
    # temporarily so two page loads
    # don't hammer LRCLIB.
    assert calls == 1


@pytest.mark.asyncio
async def test_track_lyrics_missing_track_returns_404() -> None:
    transport = ASGITransport(
        app=app,
    )

    async with AsyncClient(
        transport=transport,
        base_url="http://test",
    ) as client:
        response = await client.get(
            (f"/api/catalog/tracks/{uuid4()}/lyrics"),
        )

    assert response.status_code == 404


@pytest.mark.asyncio
async def test_track_lyrics_passes_lrclib_retry_after(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.app.services.lrclib import (
        LrclibRateLimitedError,
    )

    track_id = await create_track(
        title="Rate Limited Test",
        artist="HyperSync Test",
        album="Test Album",
        duration_seconds=180,
    )

    async def fake_fetch_lrclib_lyrics(
        **kwargs,
    ):
        raise LrclibRateLimitedError(
            42,
        )

    monkeypatch.setattr(
        ("backend.app.api.routes.catalog.fetch_lrclib_lyrics"),
        fake_fetch_lrclib_lyrics,
    )

    transport = ASGITransport(
        app=app,
    )

    async with AsyncClient(
        transport=transport,
        base_url="http://test",
    ) as client:
        response = await client.get(
            (f"/api/catalog/tracks/{track_id}/lyrics"),
        )

    assert response.status_code == 503

    assert response.headers["Retry-After"] == "42"
