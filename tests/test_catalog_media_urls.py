from types import SimpleNamespace
from typing import cast
from uuid import uuid4

import pytest
from httpx import (
    ASGITransport,
    AsyncClient,
)

from backend.app.api.routes import (
    catalog as catalog_route,
)
from backend.app.main import app
from backend.app.models.media import Track


@pytest.mark.asyncio
async def test_catalog_returns_direct_signed_media_urls(
    monkeypatch,
) -> None:
    track_id = uuid4()

    track = SimpleNamespace(
        id=track_id,
        title="Fast Song",
        artist="HyperSync",
        album="Direct B2",
        duration_seconds=180,
        mime_type="audio/mpeg",
        file_size=5_000_000,
        b2_object_key=("audio/fast-song.mp3"),
        artwork_object_key=("artwork/fast-song.jpg"),
        is_published=True,
    )

    class FakeResult:
        @staticmethod
        def scalars():
            return FakeResult()

        @staticmethod
        def all():
            return [track]

    class FakeSession:
        async def __aenter__(self):
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
        catalog_route,
        "get_session_factory",
        lambda: lambda: FakeSession(),
    )

    monkeypatch.setattr(
        catalog_route,
        "get_settings",
        lambda: SimpleNamespace(
            environment="production",
        ),
    )

    def fake_sign(
        object_key,
    ):
        return f"https://s3.example.test/bucket/{object_key}?X-Amz-Signature=test"

    monkeypatch.setattr(
        catalog_route,
        "create_presigned_download_url",
        fake_sign,
        raising=False,
    )

    transport = ASGITransport(
        app=app,
    )

    async with AsyncClient(
        transport=transport,
        base_url="http://test",
    ) as client:
        response = await client.get(
            "/api/catalog/tracks",
        )

    assert response.status_code == 200

    payload = response.json()

    assert len(payload) == 1

    assert payload[0]["audio_url"] == (
        "https://s3.example.test/bucket/audio/fast-song.mp3?X-Amz-Signature=test"
    )

    assert payload[0]["artwork_url"] == (
        "https://s3.example.test/bucket/artwork/fast-song.jpg?X-Amz-Signature=test"
    )

    assert payload[0]["mime_type"] == ("audio/mpeg")

    assert payload[0]["file_size"] == (5_000_000)

    assert payload[0]["media_version"] is not None

    assert isinstance(
        payload[0]["media_version"],
        str,
    )

    assert payload[0]["media_version"]


def test_catalog_media_urls_fall_back_when_signing_fails(
    monkeypatch,
) -> None:
    track_id = uuid4()

    track = cast(
        Track,
        SimpleNamespace(
            id=track_id,
            b2_object_key="audio/demo.mp3",
            artwork_object_key="artwork/demo.jpg",
        ),
    )

    monkeypatch.setattr(
        catalog_route,
        "get_settings",
        lambda: SimpleNamespace(
            environment="production",
        ),
    )

    def fail_sign(
        object_key: str,
    ) -> str:
        raise RuntimeError("B2_ENDPOINT is not configured.")

    monkeypatch.setattr(
        catalog_route,
        "create_presigned_download_url",
        fail_sign,
    )

    assert (
        catalog_route._track_audio_url(
            track,
        )
        == f"/api/audio/{track_id}"
    )

    assert catalog_route._track_artwork_url(
        track,
    ) == (f"/api/catalog/tracks/{track_id}/artwork")


def test_catalog_track_response_exposes_media_cache_metadata() -> None:
    response = catalog_route.TrackResponse(
        id=uuid4(),
        title="Fast Song",
        artist="HyperSync",
        album="Direct B2",
        duration_seconds=180,
        mime_type="audio/mpeg",
        file_size=5_000_000,
        media_version="media-v1",
    )

    assert response.mime_type == ("audio/mpeg")

    assert response.file_size == (5_000_000)

    assert response.media_version == ("media-v1")


@pytest.mark.asyncio
async def test_get_track_returns_media_cache_metadata(
    monkeypatch,
) -> None:
    track_id = uuid4()

    track = cast(
        Track,
        SimpleNamespace(
            id=track_id,
            title="Fast Song",
            artist="HyperSync",
            album="Direct B2",
            duration_seconds=180,
            mime_type="audio/mpeg",
            file_size=5_000_000,
            b2_object_key="audio/fast-song.mp3",
            artwork_object_key=None,
            is_published=True,
        ),
    )

    class FakeResult:
        @staticmethod
        def scalar_one_or_none():
            return track

    class FakeSession:
        async def __aenter__(self):
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
        catalog_route,
        "get_session_factory",
        lambda: lambda: FakeSession(),
    )

    monkeypatch.setattr(
        catalog_route,
        "get_settings",
        lambda: SimpleNamespace(
            environment="development",
        ),
    )

    response = await catalog_route.get_track(
        track_id,
    )

    assert response.mime_type == ("audio/mpeg")

    assert response.file_size == (5_000_000)

    assert response.media_version is not None
