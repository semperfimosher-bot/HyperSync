"""Offline regressions for profile privacy and bounded avatar allocation."""

from datetime import UTC, datetime
from io import BytesIO
from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException, UploadFile
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.datastructures import Headers

from backend.app.api.dependencies import get_optional_current_user
from backend.app.api.routes import users
from backend.app.database import get_database_session
from backend.app.models.account import User

AVATAR_LIMIT = 5 * 1024 * 1024


@pytest.mark.asyncio
@pytest.mark.parametrize("public", [False, True])
@pytest.mark.parametrize("relationship", ["anonymous", "none", "pending", "accepted", "self"])
async def test_following_uses_profile_privacy(monkeypatch, public, relationship):
    target = SimpleNamespace(
        id=uuid4(),
        username="owner",
        created_at=datetime.now(UTC),
        profile=SimpleNamespace(
            music_activity_public=public, display_name="Owner", avatar_object_key=None
        ),
    )
    viewer = (
        None
        if relationship == "anonymous"
        else SimpleNamespace(
            id=target.id if relationship == "self" else uuid4(),
        )
    )
    followed = SimpleNamespace(
        username="secret-friend",
        created_at=datetime.now(UTC),
        profile=None,
        id=uuid4(),
    )
    result = SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: [followed]))
    session = SimpleNamespace(execute=AsyncMock(return_value=result))
    monkeypatch.setattr(users, "get_user_by_username", AsyncMock(return_value=target))
    monkeypatch.setattr(
        users,
        "follow_status_for",
        AsyncMock(
            return_value="none" if relationship == "anonymous" else relationship,
        ),
    )
    monkeypatch.setattr(users, "accepted_followers_count", AsyncMock(return_value=0))
    dashboard = SimpleNamespace(
        followers_count=0,
        bio="private bio",
        following_count=1,
        tracks_played=0,
        hours_listened=0,
        recently_played=[],
        top_artists=[],
    )
    monkeypatch.setattr(users, "build_dashboard", AsyncMock(return_value=dashboard))
    app = FastAPI()
    app.include_router(users.router)
    app.dependency_overrides[get_database_session] = lambda: session
    app.dependency_overrides[get_optional_current_user] = lambda: viewer
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        profile = await client.get("/users/owner")
        response = await client.get("/users/owner/following")
    allowed = public or relationship in {"self", "accepted"}
    assert profile.status_code == 200
    assert profile.json()["can_view_activity"] is allowed
    if allowed:
        assert response.status_code == 200, response.text
        assert [row["username"] for row in response.json()] == ["secret-friend"]
    else:
        assert response.status_code == 403
        assert "secret-friend" not in response.text
        session.execute.assert_not_awaited()
        assert profile.json()["following_count"] is None
        assert profile.json()["bio"] is None


@pytest.mark.asyncio
@pytest.mark.parametrize("size", [0, AVATAR_LIMIT + 1, AVATAR_LIMIT * 2])
async def test_avatar_rejects_bad_size_with_bounded_read(size):
    class BoundedUpload(UploadFile):
        async def read(self, size=-1):
            assert 0 < size <= AVATAR_LIMIT + 1, "avatar read must be bounded"
            return await super().read(size)

    upload = BoundedUpload(BytesIO(b"x" * size), headers=Headers({"content-type": "image/png"}))
    session = SimpleNamespace(commit=AsyncMock())
    with pytest.raises(HTTPException) as exc:
        await users.upload_my_avatar(User(), cast(AsyncSession, session), upload)
    assert exc.value.status_code == 400
    assert exc.value.detail == (
        "Profile picture is empty." if size == 0 else "Profile picture must be 5 MB or smaller."
    )
    assert upload.file.tell() <= AVATAR_LIMIT + 1
    session.commit.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("size", [1, AVATAR_LIMIT])
async def test_avatar_accepts_boundary_and_preserves_response(monkeypatch, size):
    data = b"x" * size
    upload = UploadFile(BytesIO(data), headers=Headers({"content-type": "image/png"}))
    user = SimpleNamespace(id=uuid4(), profile=SimpleNamespace(avatar_object_key=None))
    session = SimpleNamespace(commit=AsyncMock(), refresh=AsyncMock(), rollback=AsyncMock())
    uploaded = []
    bucket = SimpleNamespace(upload_bytes=lambda content, key, **kwargs: uploaded.append(content))
    monkeypatch.setattr(users, "get_b2_bucket", lambda: bucket)
    monkeypatch.setattr(users, "get_settings", lambda: SimpleNamespace(b2_profile_prefix="avatars"))
    monkeypatch.setattr(
        users, "build_dashboard", AsyncMock(return_value={"unchanged": "dashboard"})
    )
    response = await users.upload_my_avatar(cast(User, user), cast(AsyncSession, session), upload)
    assert uploaded == [data]
    assert response == {"unchanged": "dashboard"}
    session.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_avatar_invalid_type_is_rejected_before_read():
    upload = SimpleNamespace(content_type="application/octet-stream", read=AsyncMock())
    with pytest.raises(HTTPException) as exc:
        await users.upload_my_avatar(
            User(),
            cast(AsyncSession, SimpleNamespace()),
            cast(UploadFile, upload),
        )
    assert exc.value.status_code == 400
    assert exc.value.detail == "Profile picture must be a JPG, PNG, or WebP image."
    upload.read.assert_not_awaited()


@pytest.mark.asyncio
async def test_avatar_upload_failure_keeps_existing_error_contract(monkeypatch):
    upload = UploadFile(BytesIO(b"image"), headers=Headers({"content-type": "image/png"}))
    user = SimpleNamespace(id=uuid4(), profile=SimpleNamespace(avatar_object_key=None))
    session = SimpleNamespace(commit=AsyncMock(), rollback=AsyncMock())

    def fail_upload(*args, **kwargs):
        raise RuntimeError("offline storage failure")

    monkeypatch.setattr(users, "get_b2_bucket", lambda: SimpleNamespace(upload_bytes=fail_upload))
    monkeypatch.setattr(users, "get_settings", lambda: SimpleNamespace(b2_profile_prefix="avatars"))
    with pytest.raises(HTTPException) as exc:
        await users.upload_my_avatar(cast(User, user), cast(AsyncSession, session), upload)
    assert exc.value.status_code == 500
    assert exc.value.detail == "Failed to upload profile picture."
    session.rollback.assert_awaited_once()
    session.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_following_missing_user_keeps_404(monkeypatch):
    monkeypatch.setattr(users, "get_user_by_username", AsyncMock(return_value=None))
    with pytest.raises(HTTPException) as exc:
        await users.get_following("missing", cast(AsyncSession, SimpleNamespace()), None)
    assert exc.value.status_code == 404
    assert exc.value.detail == "User not found."


@pytest.mark.asyncio
@pytest.mark.parametrize("operation", ["upload", "remove", "get"])
async def test_avatar_bucket_acquisition_runs_off_event_loop(monkeypatch, operation):
    import threading

    loop_thread = threading.get_ident()
    acquired_in = []
    bucket = SimpleNamespace(
        upload_bytes=lambda *args, **kwargs: None, download_file_by_name=lambda *args: object()
    )

    def acquire_bucket():
        acquired_in.append(threading.get_ident())
        return bucket

    user = SimpleNamespace(id=uuid4(), profile=SimpleNamespace(avatar_object_key="avatars/old.png"))
    session = SimpleNamespace(commit=AsyncMock(), refresh=AsyncMock(), rollback=AsyncMock())
    monkeypatch.setattr(users, "get_b2_bucket", acquire_bucket)
    monkeypatch.setattr(users, "delete_all_object_versions", AsyncMock())
    monkeypatch.setattr(users, "get_settings", lambda: SimpleNamespace(b2_profile_prefix="avatars"))
    monkeypatch.setattr(users, "build_dashboard", AsyncMock(return_value={}))
    if operation == "upload":
        upload = UploadFile(BytesIO(b"image"), headers=Headers({"content-type": "image/png"}))
        await users.upload_my_avatar(cast(User, user), cast(AsyncSession, session), upload)
    elif operation == "remove":
        await users.remove_my_avatar(cast(User, user), cast(AsyncSession, session))
    else:

        class SessionContext:
            async def __aenter__(self):
                return SimpleNamespace(
                    execute=AsyncMock(
                        return_value=SimpleNamespace(
                            scalar_one_or_none=lambda: user,
                        )
                    )
                )

            async def __aexit__(self, *args):
                return False

        monkeypatch.setattr(users, "get_session_factory", lambda: SessionContext)
        await users.get_user_avatar("owner")
    assert acquired_in and acquired_in[0] != loop_thread
