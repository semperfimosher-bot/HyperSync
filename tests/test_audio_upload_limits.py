from io import BytesIO
from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import BackgroundTasks, HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.datastructures import Headers

from backend.app.api.routes import admin as admin_route
from backend.app.config import Settings
from backend.app.models.account import User


def _settings(**overrides):
    values = {
        "_env_file": None,
        "database_url": "postgresql+asyncpg://user:pass@localhost/hypersync_test",
        "environment": "test",
    }
    values.update(overrides)
    return Settings(**values)


@pytest.mark.parametrize("value", [0, -1, 5_000_000_001])
def test_audio_upload_limit_rejects_invalid_configuration(value):
    with pytest.raises(ValueError, match="AUDIO_MAX_UPLOAD_BYTES"):
        _settings(audio_max_upload_bytes=value)


def test_audio_upload_size_accepts_exact_limit():
    admin_route._validate_audio_upload_size(1024, max_bytes=1024)


def test_audio_upload_size_rejects_oversized_file():
    with pytest.raises(HTTPException) as error:
        admin_route._validate_audio_upload_size(1025, max_bytes=1024)
    assert error.value.status_code == 413


@pytest.mark.asyncio
async def test_prepare_direct_upload_rejects_oversized_file_before_database_or_b2(monkeypatch):
    monkeypatch.setattr(
        admin_route,
        "get_settings",
        lambda: SimpleNamespace(audio_max_upload_bytes=1024),
    )
    monkeypatch.setattr(
        admin_route,
        "_find_duplicate_track",
        AsyncMock(side_effect=AssertionError("database must not be queried")),
    )
    monkeypatch.setattr(
        admin_route,
        "create_presigned_upload_url",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("no presigned URL may be issued"),
        ),
    )
    payload = admin_route.PrepareDirectTrackUploadRequest(
        filename="large.mp3",
        mime_type="audio/mpeg",
        file_size=1025,
        duration_seconds=180,
        title="Large track",
        artist="Test artist",
        estimated_bitrate_kbps=192,
    )

    with pytest.raises(HTTPException) as error:
        await admin_route.prepare_direct_track_upload(
            payload,
            user=cast(User, object()),
            session=cast(AsyncSession, object()),
        )

    assert error.value.status_code == 413


@pytest.mark.asyncio
async def test_finalize_rejects_oversized_direct_upload_and_cleans_b2_object(monkeypatch):
    bucket = object()
    cleanup = AsyncMock()
    session = SimpleNamespace(rollback=AsyncMock())
    monkeypatch.setattr(
        admin_route,
        "get_settings",
        lambda: SimpleNamespace(
            b2_audio_prefix="audio",
            audio_max_upload_bytes=1024,
        ),
    )
    monkeypatch.setattr(admin_route, "get_b2_bucket", lambda: bucket)
    monkeypatch.setattr(admin_route, "delete_all_object_versions", cleanup)
    monkeypatch.setattr(
        admin_route,
        "head_b2_object",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("oversized declared uploads must be rejected before HEAD"),
        ),
    )

    with pytest.raises(HTTPException) as error:
        await admin_route.finalize_direct_track_upload(
            object_key="audio/oversized.mp3",
            title="Large track",
            artist="Test artist",
            duration_seconds=180,
            mime_type="audio/mpeg",
            original_file_size=1025,
            user=cast(User, object()),
            session=cast(AsyncSession, session),
            background_tasks=BackgroundTasks(),
        )

    assert error.value.status_code == 413
    session.rollback.assert_awaited_once()
    cleanup.assert_awaited_once_with(bucket, "audio/oversized.mp3")


@pytest.mark.asyncio
async def test_finalize_checks_actual_b2_size_when_client_claims_smaller_file(monkeypatch):
    bucket = object()
    cleanup = AsyncMock()
    session = SimpleNamespace(rollback=AsyncMock())
    head = MagicMock(return_value={"ContentLength": 1025, "ContentType": "audio/mpeg"})
    monkeypatch.setattr(
        admin_route,
        "get_settings",
        lambda: SimpleNamespace(
            b2_audio_prefix="audio",
            audio_max_upload_bytes=1024,
        ),
    )
    monkeypatch.setattr(admin_route, "get_b2_bucket", lambda: bucket)
    monkeypatch.setattr(admin_route, "delete_all_object_versions", cleanup)
    monkeypatch.setattr(admin_route, "head_b2_object", head)

    with pytest.raises(HTTPException) as error:
        await admin_route.finalize_direct_track_upload(
            object_key="audio/lying-size.mp3",
            title="Large track",
            artist="Test artist",
            duration_seconds=180,
            mime_type="audio/mpeg",
            original_file_size=1024,
            user=cast(User, object()),
            session=cast(AsyncSession, session),
            background_tasks=BackgroundTasks(),
        )

    assert error.value.status_code == 413
    head.assert_called_once_with("audio/lying-size.mp3")
    session.rollback.assert_awaited_once()
    cleanup.assert_awaited_once_with(bucket, "audio/lying-size.mp3")


@pytest.mark.asyncio
async def test_backend_upload_rejects_oversized_file_before_processing_or_storage(monkeypatch):
    monkeypatch.setattr(
        admin_route,
        "get_settings",
        lambda: SimpleNamespace(audio_max_upload_bytes=4),
    )
    monkeypatch.setattr(
        admin_route,
        "extract_embedded_audio_metadata_file",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("oversized audio must be rejected before parsing"),
        ),
    )
    monkeypatch.setattr(
        admin_route,
        "get_b2_bucket",
        lambda: (_ for _ in ()).throw(
            AssertionError("oversized audio must never reach B2"),
        ),
    )
    session = SimpleNamespace(rollback=AsyncMock())
    upload = UploadFile(
        file=BytesIO(b"12345"),
        filename="song.mp3",
        headers=Headers({"content-type": "audio/mpeg"}),
    )

    with pytest.raises(HTTPException) as error:
        await admin_route.upload_track(
            file=upload,
            title="Song",
            artist="Artist",
            duration_seconds=180,
            user=cast(User, object()),
            session=cast(AsyncSession, session),
            background_tasks=BackgroundTasks(),
        )

    assert error.value.status_code == 413
    session.rollback.assert_awaited_once()
