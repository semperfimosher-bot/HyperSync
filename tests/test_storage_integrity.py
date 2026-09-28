from __future__ import annotations

from uuid import uuid4

import pytest
from botocore.exceptions import (
    ClientError,
)

from backend.app.models.media import Track
from backend.app.services import (
    storage_integrity,
)


def _track(
    *,
    title: str,
    audio_key: str,
    artwork_key: str | None = None,
) -> Track:
    return Track(
        id=uuid4(),
        title=title,
        artist="Integrity Artist",
        album="Integrity Album",
        b2_object_key=audio_key,
        artwork_object_key=artwork_key,
        mime_type="audio/mpeg",
        is_published=True,
    )


@pytest.mark.asyncio
async def test_storage_integrity_reports_missing_objects_without_mutating_catalog(
    monkeypatch,
) -> None:
    tracks = [
        _track(
            title="Healthy",
            audio_key="audio/healthy.mp3",
            artwork_key="art/healthy.jpg",
        ),
        _track(
            title="Broken",
            audio_key="audio/missing.mp3",
        ),
    ]

    checked: list[str] = []

    def fake_head(
        object_key: str,
    ):
        checked.append(
            object_key,
        )

        if object_key == "audio/missing.mp3":
            raise ClientError(
                {
                    "Error": {
                        "Code":
                            "NoSuchKey",
                        "Message":
                            "missing",
                    },
                    "ResponseMetadata": {
                        "HTTPStatusCode":
                            404,
                    },
                },
                "HeadObject",
            )

        return {
            "ContentLength":
                100,
        }

    monkeypatch.setattr(
        storage_integrity,
        "head_b2_object",
        fake_head,
    )

    result = (
        await storage_integrity.audit_track_storage(
            tracks,
            concurrency=2,
        )
    )

    assert result["healthy"] is False
    assert result["tracks_checked"] == 2
    assert result["objects_checked"] == 3
    assert result["missing_audio_count"] == 1
    assert result["missing_artwork_count"] == 0
    assert result["error_count"] == 0
    assert {
        item["object_key"]
        for item
        in result["missing_audio"]
    } == {
        "audio/missing.mp3",
    }
    assert set(
        checked,
    ) == {
        "audio/healthy.mp3",
        "art/healthy.jpg",
        "audio/missing.mp3",
    }

    assert [
        track.title
        for track
        in tracks
    ] == [
        "Healthy",
        "Broken",
    ]
