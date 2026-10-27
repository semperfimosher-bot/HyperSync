import hashlib
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import Response

from backend.app.api.routes import media as media_route


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("configured_ttl", "expected_ttl"),
    [
        (10, 60),
        (300, 300),
        (86400, 86400),
        (9999999, 7 * 24 * 60 * 60),
    ],
)
async def test_media_source_signer_uses_advertised_ttl(
    monkeypatch,
    configured_ttl: int,
    expected_ttl: int,
) -> None:
    track_id = uuid4()
    object_key = "audio/security-test.mp3"
    track = SimpleNamespace(
        id=track_id,
        is_published=True,
        b2_object_key=object_key,
        file_size=1024,
        mime_type="audio/mpeg",
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
        media_route,
        "get_session_factory",
        lambda: lambda: FakeSession(),
    )
    monkeypatch.setattr(
        media_route,
        "get_settings",
        lambda: SimpleNamespace(
            b2_presigned_url_ttl_seconds=configured_ttl,
        ),
    )

    signer_calls = []

    def fake_sign(object_key_arg: str, *, ttl_seconds: int | None = None) -> str:
        signer_calls.append((object_key_arg, ttl_seconds))
        return "https://storage.example.test/signed"

    monkeypatch.setattr(
        media_route,
        "create_presigned_download_url",
        fake_sign,
    )

    response = await media_route.get_media_source(
        track_id,
        Response(),
        version=hashlib.sha256(object_key.encode("utf-8")).hexdigest(),
    )

    assert signer_calls == [(object_key, expected_ttl)]
    assert response.expires_in_seconds == expected_ttl
