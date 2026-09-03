from types import SimpleNamespace
from typing import cast
from uuid import uuid4

from backend.app.api.routes import (
    users as users_route,
)
from backend.app.models.media import Track


def make_track() -> tuple[
    object,
    Track,
]:
    track_id = uuid4()

    track = cast(
        Track,
        SimpleNamespace(
            id=track_id,
            b2_object_key=(
                "audio/demo.mp3"
            ),
            artwork_object_key=(
                "artwork/demo.jpg"
            ),
        ),
    )

    return track_id, track


def test_profile_media_urls_are_direct_in_production(
    monkeypatch,
) -> None:
    _, track = make_track()

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
        return (
            "https://s3.example.test/"
            f"bucket/{object_key}"
            "?X-Amz-Signature=test"
        )

    monkeypatch.setattr(
        users_route,
        "create_presigned_download_url",
        fake_sign,
    )

    assert (
        users_route.audio_url(
            track,
        )
        ==
        "https://s3.example.test/"
        "bucket/audio/demo.mp3"
        "?X-Amz-Signature=test"
    )

    assert (
        users_route.artwork_url(
            track,
        )
        ==
        "https://s3.example.test/"
        "bucket/artwork/demo.jpg"
        "?X-Amz-Signature=test"
    )


def test_profile_media_urls_use_local_api_in_development(
    monkeypatch,
) -> None:
    track_id, track = make_track()

    monkeypatch.setattr(
        users_route,
        "get_settings",
        lambda: SimpleNamespace(
            environment="development",
        ),
    )

    assert (
        users_route.audio_url(
            track,
        )
        ==
        f"/api/audio/{track_id}"
    )

    assert (
        users_route.artwork_url(
            track,
        )
        ==
        (
            "/api/catalog/tracks/"
            f"{track_id}/artwork"
        )
    )


def test_profile_media_urls_fall_back_when_signing_fails(
    monkeypatch,
) -> None:
    track_id, track = make_track()

    monkeypatch.setattr(
        users_route,
        "get_settings",
        lambda: SimpleNamespace(
            environment="production",
        ),
    )

    def fail_sign(
        object_key: str,
    ) -> str:
        raise RuntimeError(
            "B2_ENDPOINT is not configured."
        )

    monkeypatch.setattr(
        users_route,
        "create_presigned_download_url",
        fail_sign,
    )

    assert (
        users_route.audio_url(
            track,
        )
        ==
        f"/api/audio/{track_id}"
    )

    assert (
        users_route.artwork_url(
            track,
        )
        ==
        (
            "/api/catalog/tracks/"
            f"{track_id}/artwork"
        )
    )
    