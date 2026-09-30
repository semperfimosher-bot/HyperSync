from types import SimpleNamespace
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient

from backend.app.api.routes import audio as audio_route
from backend.app.api.routes.audio import (
    safe_filename,
)
from backend.app.main import app


@pytest.mark.asyncio
async def test_audio_streams_locally_when_b2_is_unavailable(
    monkeypatch,
    tmp_path,
) -> None:
    audio_file = tmp_path / "demo_track.wav"

    audio_file.write_bytes(b"RIFFdemo-audio-sample")

    track_id = uuid4()

    track = SimpleNamespace(
        id=track_id,
        title="Demo Track",
        mime_type="audio/wav",
        b2_object_key=str(audio_file),
        is_published=True,
    )

    class FakeResult:
        @staticmethod
        def scalar_one_or_none():
            return track

    class FakeSession:
        async def __aenter__(
            self,
        ):
            return self

        async def __aexit__(
            self,
            exc_type,
            exc,
            tb,
        ):
            return False

        async def execute(
            self,
            *args,
            **kwargs,
        ):
            return FakeResult()

    monkeypatch.setattr(
        ("backend.app.api.routes.audio.get_session_factory"),
        lambda: lambda: FakeSession(),
    )

    def raise_b2_error():
        raise RuntimeError("B2 is not configured")

    monkeypatch.setattr(
        ("backend.app.api.routes.audio.get_b2_bucket"),
        raise_b2_error,
    )

    monkeypatch.setattr(
        (
            "backend.app.api.routes.audio."
            "resolve_local_audio_fallback"
        ),
        lambda _object_key: audio_file,
    )

    transport = ASGITransport(
        app=app,
    )

    async with AsyncClient(
        transport=transport,
        base_url="http://test",
    ) as client:
        response = await client.get(
            f"/api/audio/{track_id}",
            headers={
                "Range": "bytes=0-10",
            },
        )

    assert response.status_code == 206

    assert response.headers["Content-Type"].startswith("audio/")

    assert response.content.startswith(b"RIFF")


def test_safe_filename_is_header_safe() -> None:
    filename = safe_filename(
        "Don’t Stop",
    )

    filename.encode(
        "latin-1",
    )

    assert filename == "Dont Stop.mp3"


@pytest.mark.asyncio
async def test_b2_streams_are_bounded_and_return_capacity_after_completion(
    monkeypatch,
) -> None:
    import asyncio
    import threading

    from fastapi import HTTPException

    slots = threading.BoundedSemaphore(1)
    monkeypatch.setattr(audio_route, "_b2_stream_slots", slots)
    started = threading.Event()
    release_writer = threading.Event()

    class FakeDownload:
        @staticmethod
        def save(output, *, allow_seeking):
            assert allow_seeking is False
            started.set()
            if not release_writer.wait(timeout=5):
                raise TimeoutError("test writer was not released")
            output.write(b"bounded-stream")

    first = await audio_route.stream_b2_file(FakeDownload())
    try:
        assert await asyncio.to_thread(started.wait, 1)
        with pytest.raises(HTTPException) as raised:
            await audio_route.stream_b2_file(FakeDownload())
        assert raised.value.status_code == 503
        assert raised.value.headers["Retry-After"] == "2"
    finally:
        release_writer.set()

    chunks = [chunk async for chunk in first]
    assert b"".join(chunks) == b"bounded-stream"

    assert slots.acquire(blocking=False)
    slots.release()


@pytest.mark.asyncio
async def test_audio_route_returns_retryable_503_when_stream_capacity_is_full(
    monkeypatch,
) -> None:
    import threading

    track_id = uuid4()
    track = SimpleNamespace(
        id=track_id,
        title="Busy Track",
        mime_type="audio/wav",
        b2_object_key="busy.wav",
        is_published=True,
    )

    class FakeResult:
        @staticmethod
        def scalar_one_or_none():
            return track

    class FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def execute(self, *args, **kwargs):
            return FakeResult()

    class FakeBucket:
        @staticmethod
        def get_file_info_by_name(_key):
            return SimpleNamespace(size=64)

        @staticmethod
        def download_file_by_name(_key, *, range_):
            return object()

    slots = threading.BoundedSemaphore(1)
    assert slots.acquire(blocking=False)
    monkeypatch.setattr(audio_route, "_b2_stream_slots", slots)
    monkeypatch.setattr(audio_route, "get_session_factory", lambda: lambda: FakeSession())
    monkeypatch.setattr(audio_route, "get_b2_bucket", lambda: FakeBucket())

    try:
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
        ) as client:
            response = await client.get(f"/api/audio/{track_id}")
    finally:
        slots.release()
    assert response.status_code == 503
    assert response.headers["Retry-After"] == "2"
    assert "capacity" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_cancelled_b2_stream_closes_writer_and_returns_capacity(
    monkeypatch,
) -> None:
    import threading

    slots = threading.BoundedSemaphore(1)
    monkeypatch.setattr(audio_route, "_b2_stream_slots", slots)

    class LargeDownload:
        @staticmethod
        def save(output, *, allow_seeking):
            assert allow_seeking is False
            for _ in range(128):
                output.write(b"x" * 65536)

    body = await audio_route.stream_b2_file(LargeDownload())
    assert await body.__anext__()
    await body.aclose()

    assert slots.acquire(blocking=False)
    slots.release()


@pytest.mark.asyncio
async def test_failed_b2_writer_returns_capacity(monkeypatch) -> None:
    import threading

    slots = threading.BoundedSemaphore(1)
    monkeypatch.setattr(audio_route, "_b2_stream_slots", slots)

    class FailedDownload:
        @staticmethod
        def save(output, *, allow_seeking):
            assert allow_seeking is False
            output.write(b"partial")
            raise OSError("simulated upstream failure")

    body = await audio_route.stream_b2_file(FailedDownload())
    with pytest.raises(OSError, match="simulated upstream failure"):
        _ = [chunk async for chunk in body]

    assert slots.acquire(blocking=False)
    slots.release()
