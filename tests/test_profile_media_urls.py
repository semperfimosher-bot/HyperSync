from types import SimpleNamespace
from typing import cast
from uuid import uuid4

from backend.app.api.routes import (
    users as users_route,
)
from backend.app.models.media import Track


def test_profile_media_urls_are_direct_in_production(
    monkeypatch,
) -> None:
    track_id = uuid4()

    track = cast(
        Track,
        SimpleNamespace(
            id=track_id,
            b2_object_key=("audio/demo.mp3"),
            artwork_object_key=("artwork/demo.jpg"),
        ),
    )

    monkeypatch.setattr(
        users_route,
        "get_settings",
        lambda: SimpleNamespace(
            environment="production",
        ),
    )

    def fake_sign(
        object_key: str,
    ) -> str:
        return f"https://s3.example.test/bucket/{object_key}?X-Amz-Signature=test"

    monkeypatch.setattr(
        users_route,
        "create_presigned_download_url",
        fake_sign,
        raising=False,
    )

    audio_url = users_route.audio_url

    assert (
        users_route.audio_url(track)
    ==
    "https://s3.example.test/"
    "bucket/audio/demo.mp3"
    "?X-Amz-Signature=test"
)

    assert audio_url(track) == "https://s3.example.test/bucket/audio/demo.mp3?X-Amz-Signature=test"

    assert (
        users_route.artwork_url(
            track,
        )
        == "https://s3.example.test/"
        "bucket/artwork/demo.jpg"
        "?X-Amz-Signature=test"
    )


def test_profile_media_urls_use_local_api_in_development(
    monkeypatch,
) -> None:
    track_id = uuid4()

    track = cast(
        Track,
        SimpleNamespace(
            id=track_id,
            b2_object_key=("audio/demo.mp3"),
            artwork_object_key=("artwork/demo.jpg"),
        ),
    )

    monkeypatch.setattr(
        users_route,
        "get_settings",
        lambda: SimpleNamespace(
            environment="development",
        ),
    )

    audio_url = users_route.audio_url

    assert (
    users_route.audio_url(track)
    ==
    f"/api/audio/{track_id}"
)

    assert audio_url(track) == f"/api/audio/{track_id}"

    assert users_route.artwork_url(
        track,
    ) == (f"/api/catalog/tracks/{track_id}/artwork")
