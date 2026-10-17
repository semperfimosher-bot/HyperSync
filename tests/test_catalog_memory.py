"""Legacy JSON arrays retain compatibility without retaining a whole catalog."""

import asyncio
import json
from types import SimpleNamespace
from uuid import UUID

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from backend.app.api.routes import catalog
from backend.app.services.disk_response import DiskJSONResponse


def test_lyrics_cooldown_cache_evicts_expired_and_excess_entries(monkeypatch):
    cache = {UUID(int=1): 0.0}
    monkeypatch.setattr(catalog, "_lyrics_provider_cooldown_until", cache)
    monkeypatch.setattr(catalog.time, "monotonic", lambda: 10.0)
    for value in range(2, 1200):
        catalog._set_lyrics_cooldown(UUID(int=value), 20.0)
    assert len(cache) == 1024
    assert UUID(int=1) not in cache and UUID(int=1199) in cache


class CatalogSession:
    def __init__(self, count=603, fail=False):
        self.count = count
        self.fail = fail
        self.closed = False
        self.cursor_closed = False
        self.batch_sizes = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        self.closed = True

    async def execute(self, statement):
        raise AssertionError("Legacy catalog must use a server-side bounded cursor")

    async def stream(self, statement):
        assert statement.get_execution_options()["yield_per"] == 250
        return self

    def scalars(self):
        return self

    async def partitions(self, size):
        assert size == 250
        for start in range(0, self.count, size):
            if self.fail:
                raise RuntimeError("Provider failed during response setup")
            rows = [
                SimpleNamespace(
                    id=UUID(int=i + 1),
                    title=f"Song {i}",
                    artist="Artist",
                    album=None,
                    genre=None,
                    release_year=None,
                    duration_seconds=123,
                    mime_type="audio/mpeg",
                    file_size=123,
                    b2_object_key="https://audio.test/song",
                    artwork_object_key=None,
                )
                for i in range(start, min(start + size, self.count))
            ]
            self.batch_sizes.append(len(rows))
            yield rows

    async def close(self):
        self.cursor_closed = True


@pytest.mark.asyncio
async def test_legacy_catalog_spools_bounded_partitions_and_closes_before_headers(monkeypatch):
    session = CatalogSession()
    monkeypatch.setattr(catalog, "get_session_factory", lambda: lambda: session)
    response = await catalog.list_tracks(catalog.Response(), q=None, page_size=None, cursor=None)
    assert isinstance(response, DiskJSONResponse)
    assert session.closed and session.cursor_closed
    assert session.batch_sizes == [250, 250, 103]
    assert response.media_type == "application/json"
    chunks = []
    async for chunk in response.body_iterator:
        assert isinstance(chunk, bytes)
        assert len(chunk) <= 64 * 1024
        chunks.append(chunk)
    body = json.loads(b"".join(chunks))
    assert len(body) == 603
    assert body[0]["title"] == "Song 0" and body[-1]["title"] == "Song 602"
    await response.close()
    assert response.source.closed


@pytest.mark.asyncio
async def test_legacy_empty_array_preserves_headers_and_valid_json(monkeypatch):
    session = CatalogSession(count=0)
    monkeypatch.setattr(catalog, "get_session_factory", lambda: lambda: session)
    app = FastAPI()
    app.include_router(catalog.router)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/catalog/tracks")
    assert response.json() == []
    assert response.headers["content-type"] == "application/json"
    assert "no-store" in response.headers["cache-control"]


@pytest.mark.asyncio
async def test_spool_cleanup_on_send_cancellation():
    import tempfile

    from backend.app.services.disk_response import DiskJSONResponse

    source = tempfile.TemporaryFile()
    source.write(b"[]")
    response = DiskJSONResponse(source)

    async def send(message):
        raise asyncio.CancelledError()

    async def receive():
        return {"type": "http.disconnect"}

    with pytest.raises(asyncio.CancelledError):
        await response({"type": "http", "asgi": {"spec_version": "2.4"}}, receive, send)
    assert source.closed
