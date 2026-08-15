from types import SimpleNamespace
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient

from backend.app.main import app


@pytest.mark.asyncio
async def test_audio_streams_locally_when_b2_is_unavailable(monkeypatch, tmp_path) -> None:
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
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def execute(self, *args, **kwargs):
            return FakeResult()

    monkeypatch.setattr(
        "backend.app.api.routes.audio.get_session_factory",
        lambda: lambda: FakeSession(),
    )

    def raise_b2_error():
        raise RuntimeError("B2 is not configured")

    monkeypatch.setattr(
        "backend.app.api.routes.audio.get_b2_bucket",
        raise_b2_error,
    )

    transport = ASGITransport(app=app)
    async with AsyncClient(
        transport=transport,
        base_url="http://test",
    ) as client:
        response = await client.get(
            f"/api/audio/{track_id}",
            headers={"Range": "bytes=0-10"},
        )

    assert response.status_code == 206
    assert response.headers["Content-Type"].startswith("audio/")
    assert response.content.startswith(b"RIFF")
