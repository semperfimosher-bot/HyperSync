"""Offline deletion recovery contracts; database integration runs separately in CI."""

import asyncio
from copy import deepcopy
from types import SimpleNamespace
from typing import cast
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.api.routes import admin as admin_routes
from backend.app.models.account import User
from backend.app.models.media import Track


class SnapshotSession:
    """Model transaction durability without accessing an external database."""

    def __init__(self, tracks, *, fail_commit=None):
        self.rows = {track.id: track for track in tracks}
        self.durable = deepcopy(self.rows)
        self.commits = 0
        self.fail_commit = fail_commit

    async def get(self, model, track_id):
        return self.rows.get(track_id)

    async def execute(self, statement):
        track_ids = next(iter(statement.compile().params.values()))
        rows = [track for key, track in self.rows.items() if key in track_ids]
        return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: rows))

    async def delete(self, track):
        del self.rows[track.id]

    async def commit(self):
        self.commits += 1
        if self.commits == self.fail_commit:
            raise RuntimeError("database commit failed")
        self.durable = deepcopy(self.rows)

    async def rollback(self):
        self.rows = deepcopy(self.durable)


def make_track():
    track_id = uuid4()
    return Track(
        id=track_id,
        title="Recovery",
        artist="Test",
        b2_object_key=f"audio/{track_id}",
        artwork_object_key=f"artwork/{track_id}",
        is_published=True,
    )


async def delete_tracks(session, tracks, bulk):
    if bulk:
        return await admin_routes.delete_tracks_bulk(
            admin_routes.BulkTrackDeleteRequest(track_ids=[track.id for track in tracks]),
            User(),
            cast(AsyncSession, session),
        )
    return await admin_routes.delete_track(tracks[0].id, User(), cast(AsyncSession, session))


@pytest.mark.parametrize("bulk", [False, True])
@pytest.mark.parametrize("partial", [False, True])
async def test_storage_failure_keeps_hidden_retryable_rows(monkeypatch, bulk, partial):
    target, unrelated = make_track(), make_track()
    session = SnapshotSession([target, unrelated])
    remaining = {target.b2_object_key, target.artwork_object_key}
    fail = True

    async def remove_versions(bucket, key):
        if fail and (not partial or key == target.artwork_object_key):
            raise RuntimeError("provider unavailable")
        deleted = int(key in remaining)
        remaining.discard(key)
        return deleted

    monkeypatch.setattr(admin_routes, "get_b2_bucket", lambda: object())
    monkeypatch.setattr(admin_routes, "delete_all_object_versions", remove_versions)

    if bulk:
        result = await delete_tracks(session, [target], bulk)
        assert result["success"] is False
        assert result["deleted_count"] == 0
        message = result["failed"][0]["message"]
    else:
        with pytest.raises(HTTPException) as error:
            await delete_tracks(session, [target], bulk)
        assert error.value.status_code == 500
        message = error.value.detail

    assert session.durable[target.id].is_published is False
    assert session.durable[unrelated.id].is_published is True
    assert "retry" in message.lower()
    assert "restored" not in message.lower()
    if partial:
        assert remaining == {target.artwork_object_key}

    fail = False
    result = await delete_tracks(session, [target], bulk)
    assert result["success"] is True
    assert target.id not in session.durable
    assert remaining == set()
    assert session.durable[unrelated.id].is_published is True


async def test_object_deletion_waits_for_sibling_outcomes_before_raising(monkeypatch):
    target = make_track()
    artwork_started = asyncio.Event()
    artwork_release = asyncio.Event()
    artwork_removed = False

    async def remove_versions(bucket, key):
        nonlocal artwork_removed
        if key == target.b2_object_key:
            await artwork_started.wait()
            raise RuntimeError("audio deletion failed")
        artwork_started.set()
        await artwork_release.wait()
        artwork_removed = True
        return 1

    monkeypatch.setattr(admin_routes, "delete_all_object_versions", remove_versions)
    operation = asyncio.create_task(admin_routes._delete_track_object_versions(object(), target))
    try:
        await artwork_started.wait()
        # Give the audio exception enough turns to propagate through gather.
        for _ in range(5):
            await asyncio.sleep(0)
        assert not operation.done()
    finally:
        artwork_release.set()
        with pytest.raises(RuntimeError, match="audio deletion failed"):
            await operation
    assert artwork_removed


@pytest.mark.parametrize("bulk", [False, True])
async def test_final_database_failure_preserves_hidden_staging(monkeypatch, bulk):
    target, failed, unrelated = make_track(), make_track(), make_track()
    session = SnapshotSession([target, failed, unrelated], fail_commit=2)

    async def remove_versions(bucket, key):
        if key == failed.artwork_object_key:
            raise RuntimeError("partial provider failure")
        return 1

    monkeypatch.setattr(admin_routes, "get_b2_bucket", lambda: object())
    monkeypatch.setattr(admin_routes, "delete_all_object_versions", remove_versions)
    selected = [target, failed] if bulk else [target]
    with pytest.raises(HTTPException) as error:
        await delete_tracks(session, selected, bulk)
    assert error.value.status_code == 500
    assert session.durable[target.id].is_published is False
    if bulk:
        assert session.durable[failed.id].is_published is False
    assert session.durable[unrelated.id].is_published is True


@pytest.mark.parametrize("bulk", [False, True])
async def test_staging_failure_prevents_storage_mutation(monkeypatch, bulk):
    target = make_track()
    session = SnapshotSession([target], fail_commit=1)

    def unexpected_bucket():
        pytest.fail("storage must not be touched before staging commits")

    monkeypatch.setattr(admin_routes, "get_b2_bucket", unexpected_bucket)
    with pytest.raises(HTTPException, match="500"):
        await delete_tracks(session, [target], bulk)
    assert session.durable[target.id].is_published is True


@pytest.mark.parametrize("bulk", [False, True])
async def test_bucket_initialization_failure_reports_retryable_hidden_track(monkeypatch, bulk):
    target = make_track()
    session = SnapshotSession([target])

    def unavailable_bucket():
        raise RuntimeError("provider authentication unavailable")

    monkeypatch.setattr(admin_routes, "get_b2_bucket", unavailable_bucket)
    with pytest.raises(HTTPException) as error:
        await delete_tracks(session, [target], bulk)
    assert "retry" in error.value.detail.lower()
    assert session.durable[target.id].is_published is False


async def test_bulk_partial_failure_deletes_successful_targets_only(monkeypatch):
    failed, succeeded, unrelated = make_track(), make_track(), make_track()
    session = SnapshotSession([failed, succeeded, unrelated])
    missing_id = uuid4()

    async def remove_versions(bucket, key):
        if key == failed.artwork_object_key:
            raise RuntimeError("artwork unavailable")
        return 1

    monkeypatch.setattr(admin_routes, "get_b2_bucket", lambda: object())
    monkeypatch.setattr(admin_routes, "delete_all_object_versions", remove_versions)
    result = await admin_routes.delete_tracks_bulk(
        admin_routes.BulkTrackDeleteRequest(
            track_ids=[failed.id, succeeded.id, missing_id, succeeded.id],
        ),
        User(),
        cast(AsyncSession, session),
    )
    assert result["success"] is False
    assert result["deleted_track_ids"] == [str(succeeded.id)]
    assert result["deleted_count"] == 1
    assert result["deleted_b2_versions"] == 2
    assert {item["track_id"] for item in result["failed"]} == {str(failed.id), str(missing_id)}
    assert succeeded.id not in session.durable
    assert session.durable[failed.id].is_published is False
    assert session.durable[unrelated.id].is_published is True
