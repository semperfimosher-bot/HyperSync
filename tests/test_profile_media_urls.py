from datetime import UTC, datetime
from types import SimpleNamespace
from typing import cast
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.api.routes import (
    users as users_route,
)
from backend.app.models.account import User
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
            b2_object_key=("audio/demo.mp3"),
            artwork_object_key=("artwork/demo.jpg"),
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
        return f"https://s3.example.test/bucket/{object_key}?X-Amz-Signature=test"

    monkeypatch.setattr(
        users_route,
        "create_presigned_download_url",
        fake_sign,
    )

    assert (
        users_route.audio_url(
            track,
        )
        == "https://s3.example.test/"
        "bucket/audio/demo.mp3"
        "?X-Amz-Signature=test"
    )

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
        == f"/api/audio/{track_id}"
    )

    assert users_route.artwork_url(
        track,
    ) == (f"/api/catalog/tracks/{track_id}/artwork")


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
        raise RuntimeError("B2_ENDPOINT is not configured.")

    monkeypatch.setattr(
        users_route,
        "create_presigned_download_url",
        fail_sign,
    )

    assert (
        users_route.audio_url(
            track,
        )
        == f"/api/audio/{track_id}"
    )

    assert users_route.artwork_url(
        track,
    ) == (f"/api/catalog/tracks/{track_id}/artwork")


def test_profile_track_summary_exposes_media_cache_metadata() -> None:
    summary = users_route.TrackSummary(
        id=uuid4(),
        title="Fast Song",
        artist="HyperSync",
        album="Direct B2",
        audio_url=("https://media.example.test/audio/fast-song.mp3"),
        artwork_url=None,
        mime_type="audio/mpeg",
        file_size=5_000_000,
        media_version="media-version-test",
        play_count=1,
        last_played_at=datetime.now(
            UTC,
        ),
    )

    assert (
        getattr(
            summary,
            "mime_type",
            None,
        )
        == "audio/mpeg"
    )

    assert (
        getattr(
            summary,
            "file_size",
            None,
        )
        == 5_000_000
    )

    assert (
        getattr(
            summary,
            "media_version",
            None,
        )
        == "media-version-test"
    )


@pytest.mark.asyncio
async def test_profile_dashboard_populates_media_cache_metadata() -> None:
    track_id = uuid4()

    track = SimpleNamespace(
        id=track_id,
        title="Fast Song",
        artist="HyperSync",
        album="Direct B2",
        duration_seconds=180,
        mime_type="audio/mpeg",
        file_size=5_000_000,
        b2_object_key=("https://media.example.test/audio/fast-song.mp3"),
        artwork_object_key=None,
    )

    now = datetime.now(
        UTC,
    )

    class FakeResult:
        def __init__(
            self,
            *,
            scalar=0,
            rows=None,
        ) -> None:
            self.scalar = scalar
            self.rows = rows if rows is not None else []

        def scalar_one(self):
            return self.scalar

        def all(self):
            return self.rows

    class FakeSession:
        def __init__(self) -> None:
            self.statements = []
            self.results = iter(
                [
                    FakeResult(scalar=0),
                    FakeResult(scalar=0),
                    FakeResult(scalar=0),
                    FakeResult(scalar=1),
                    FakeResult(scalar=180),
                    FakeResult(
                        rows=[
                            (
                                track,
                                1,
                                now,
                            )
                        ],
                    ),
                    FakeResult(rows=[]),
                ]
            )

        async def execute(
            self,
            _statement,
        ):
            self.statements.append(
                _statement,
            )

            return next(
                self.results,
            )

    user = cast(
        User,
        SimpleNamespace(
            id=uuid4(),
            username="listener",
            created_at=now,
            role=SimpleNamespace(
                value="user",
            ),
            profile=SimpleNamespace(
                display_name="Listener",
                bio=None,
                music_activity_public=True,
                avatar_object_key=None,
            ),
        ),
    )

    fake_session = FakeSession()

    session = cast(
        AsyncSession,
        fake_session,
    )

    dashboard = await users_route.build_dashboard(
        session,
        user,
    )

    recent_query = str(
        fake_session.statements[5],
    ).upper()

    assert "LIMIT" not in recent_query

    assert (
        len(
            dashboard.recently_played,
        )
        == 1
    )

    recent = dashboard.recently_played[0]

    assert recent.mime_type == ("audio/mpeg")

    assert recent.file_size == (5_000_000)

    assert recent.media_version is not None
