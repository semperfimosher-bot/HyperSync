"""Regression coverage for finalized-audio safety during upload cleanup."""

from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock

import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.api.routes import admin
from backend.app.models.account import User


def _session(*, referenced: bool):
    return SimpleNamespace(
        execute=AsyncMock(
            return_value=SimpleNamespace(
                scalar_one_or_none=lambda: object() if referenced else None,
            )
        ),
        rollback=AsyncMock(),
    )


def _settings():
    return SimpleNamespace(b2_audio_prefix="audio", audio_max_upload_bytes=100)


@pytest.mark.asyncio
async def test_late_cancel_does_not_delete_published_audio(monkeypatch):
    session = _session(referenced=True)
    delete = AsyncMock()
    monkeypatch.setattr(admin, "get_settings", _settings)
    monkeypatch.setattr(admin, "get_b2_bucket", lambda: pytest.fail("must not access B2"))
    monkeypatch.setattr(admin, "delete_all_object_versions", delete)

    with pytest.raises(HTTPException) as error:
        await admin.cancel_direct_track_upload(
            admin.CancelDirectTrackUploadRequest(object_key="audio/published.mp3"),
            user=cast(User, object()),
            session=cast(AsyncSession, session),
        )

    assert error.value.status_code == 409
    delete.assert_not_awaited()
    session.rollback.assert_awaited_once()


@pytest.mark.asyncio
async def test_unreferenced_cancel_deletes_prepared_audio(monkeypatch):
    session = _session(referenced=False)
    bucket = object()
    delete = AsyncMock(return_value=2)
    monkeypatch.setattr(admin, "get_settings", _settings)
    monkeypatch.setattr(admin, "get_b2_bucket", lambda: bucket)
    monkeypatch.setattr(admin, "delete_all_object_versions", delete)

    result = await admin.cancel_direct_track_upload(
        admin.CancelDirectTrackUploadRequest(object_key="audio/pending.mp3"),
        user=cast(User, object()),
        session=cast(AsyncSession, session),
    )

    assert result == {"success": True, "deleted_versions": 2}
    delete.assert_awaited_once_with(bucket, "audio/pending.mp3")
    session.rollback.assert_awaited_once()


@pytest.mark.asyncio
async def test_cancel_does_not_claim_success_when_b2_cleanup_fails(monkeypatch):
    session = _session(referenced=False)
    delete = AsyncMock(side_effect=OSError("B2 unavailable"))
    monkeypatch.setattr(admin, "get_settings", _settings)
    monkeypatch.setattr(admin, "get_b2_bucket", object)
    monkeypatch.setattr(admin, "delete_all_object_versions", delete)

    with pytest.raises(HTTPException) as error:
        await admin.cancel_direct_track_upload(
            admin.CancelDirectTrackUploadRequest(object_key="audio/pending.mp3"),
            user=cast(User, object()),
            session=cast(AsyncSession, session),
        )

    assert error.value.status_code == 503
    assert "B2 unavailable" not in str(error.value.detail)
    delete.assert_awaited_once()


@pytest.mark.asyncio
async def test_replayed_finalize_does_not_reattach_or_delete_published_audio(
    monkeypatch,
):
    session = _session(referenced=True)
    delete = AsyncMock()
    monkeypatch.setattr(admin, "get_settings", _settings)
    monkeypatch.setattr(admin, "get_b2_bucket", object)
    monkeypatch.setattr(admin, "delete_all_object_versions", delete)
    monkeypatch.setattr(
        admin, "head_b2_object", lambda *_a: pytest.fail("must not read published B2 object")
    )

    with pytest.raises(HTTPException) as error:
        await admin.finalize_direct_track_upload(
            object_key="audio/published.mp3",
            title="Another title",
            artist="Another artist",
            duration_seconds=120,
            mime_type="audio/mpeg",
            original_file_size=5,
            user=cast(User, object()),
            session=cast(AsyncSession, session),
            background_tasks=BackgroundTasks(),
        )

    assert error.value.status_code == 409
    delete.assert_not_awaited()


@pytest.mark.asyncio
async def test_failed_finalize_preserves_audio_if_other_request_committed(monkeypatch):
    session = _session(referenced=True)
    delete = AsyncMock()
    monkeypatch.setattr(admin, "get_settings", _settings)
    monkeypatch.setattr(admin, "get_b2_bucket", object)
    monkeypatch.setattr(admin, "delete_all_object_versions", delete)

    with pytest.raises(HTTPException) as error:
        await admin.finalize_direct_track_upload(
            object_key="audio/published.mp3",
            title="Song",
            artist="Artist",
            duration_seconds=120,
            mime_type="audio/mpeg",
            original_file_size=101,
            user=cast(User, object()),
            session=cast(AsyncSession, session),
            background_tasks=BackgroundTasks(),
        )

    assert error.value.status_code == 413
    delete.assert_not_awaited()


@pytest.mark.asyncio
async def test_failed_finalize_fails_closed_on_database_check_error(monkeypatch):
    session = _session(referenced=False)
    session.execute.side_effect = RuntimeError("database disconnected")
    delete = AsyncMock()
    monkeypatch.setattr(admin, "get_settings", _settings)
    monkeypatch.setattr(admin, "get_b2_bucket", object)
    monkeypatch.setattr(admin, "delete_all_object_versions", delete)

    with pytest.raises(HTTPException) as error:
        await admin.finalize_direct_track_upload(
            object_key="audio/pending.mp3",
            title="Song",
            artist="Artist",
            duration_seconds=120,
            mime_type="audio/mpeg",
            original_file_size=101,
            user=cast(User, object()),
            session=cast(AsyncSession, session),
            background_tasks=BackgroundTasks(),
        )

    assert error.value.status_code == 413
    delete.assert_not_awaited()
