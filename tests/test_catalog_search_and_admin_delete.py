from types import SimpleNamespace
from typing import cast
from uuid import uuid4

import pytest
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from backend.app.api.routes import admin as admin_routes
from backend.app.database import get_session_factory
from backend.app.main import app
from backend.app.models.account import User, UserRole
from backend.app.models.media import Track
from backend.app.security.passwords import hash_password


async def _create_user_and_login(client: AsyncClient, username: str, password: str) -> str:
    register = await client.post(
        "/api/auth/register",
        json={
            "username": username,
            "email": f"{username}@example.com",
            "password": password,
        },
    )
    assert register.status_code == 201, register.text

    login = await client.post(
        "/api/auth/login",
        json={
            "username": username,
            "password": password,
        },
    )
    assert login.status_code == 200, login.text
    return login.json()["access_token"]

@pytest.mark.asyncio
async def test_catalog_search_filters_tracks_by_query() -> None:
    run_id = uuid4().hex
    title = f"Acoustic Sunrise {run_id}"

    session_factory = get_session_factory()

    async with session_factory() as session:
        session.add_all(
            [
                Track(
                    id=uuid4(),
                    title=title,
                    artist="Coastal Echo",
                    album="Morning Tide",
                    b2_object_key=f"audio/acoustic-{run_id}.wav",
                    artwork_object_key=f"artwork/acoustic-{run_id}.jpg",
                    mime_type="audio/wav",
                    file_size=123,
                    duration_seconds=180,
                    is_published=True,
                ),
            ]
        )
        await session.commit()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/catalog/tracks", params={"q": run_id})

    assert response.status_code == 200, response.text
    payload = response.json()
    assert len(payload) == 1
    assert payload[0]["title"] == title
    assert payload[0]["artist"] == "Coastal Echo"
    assert payload[0]["artwork_url"].endswith(
        "/catalog/tracks/" + str(payload[0]["id"]) + "/artwork"
    )


@pytest.mark.asyncio
async def test_admin_delete_removes_b2_versions_and_database_rows(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    run_id = uuid4().hex[:8]
    admin_username = f"delete-admin-{run_id}"
    object_key = f"audio/delete-me-{run_id}.wav"
    artwork_object_key = f"artwork/delete-me-{run_id}.jpg"

    session_factory = get_session_factory()

    async with session_factory() as session:
        user = User(
            id=uuid4(),
            username=admin_username,
            email=f"{admin_username}@example.com",
            username_normalized=admin_username,
            password_hash=hash_password("hunter2pass"),
            role=UserRole.ADMIN,
            account_type="registered",
            is_active=True,
        )

        session.add(user)
        await session.commit()
        await session.refresh(user)

        track = Track(
            id=uuid4(),
            title="Delete Me",
            artist="Admin Test",
            album="Removal",
            b2_object_key=object_key,
            artwork_object_key=artwork_object_key,
            mime_type="audio/wav",
            file_size=4096,
            duration_seconds=64,
            is_published=True,
        )

        session.add(track)
        await session.commit()
        await session.refresh(track)

        track_id = track.id

    class FakeBucket:
        def __init__(self) -> None:
            self.deleted: list[tuple[str, str]] = []

        def list_file_versions(
            self,
            file_name: str | None = None,
        ):
            if file_name == object_key:
                return [
                    type(
                        "Version",
                        (),
                        {
                            "file_name": object_key,
                            "file_id": "audio-v1",
                        },
                    )(),
                    type(
                        "Version",
                        (),
                        {
                            "file_name": object_key,
                            "file_id": "audio-v2",
                        },
                    )(),
                ]

            if file_name == artwork_object_key:
                return [
                    type(
                        "Version",
                        (),
                        {
                            "file_name": artwork_object_key,
                            "file_id": "art-v1",
                        },
                    )(),
                    type(
                        "Version",
                        (),
                        {
                            "file_name": artwork_object_key,
                            "file_id": "art-v2",
                        },
                    )(),
                ]

            raise AssertionError(f"Unexpected B2 object key: {file_name}")

        def delete_file_version(
            self,
            file_id: str,
            file_name: str,
        ):
            self.deleted.append(
                (file_name, file_id),
            )

    fake_bucket = FakeBucket()

    monkeypatch.setattr(
        "backend.app.api.routes.admin.get_b2_bucket",
        lambda: fake_bucket,
    )

    transport = ASGITransport(
        app=app,
    )

    async with AsyncClient(
        transport=transport,
        base_url="http://test",
    ) as client:
        login = await client.post(
            "/api/auth/login",
            json={
                "username": admin_username,
                "password": "hunter2pass",
            },
        )

        assert login.status_code == 200, login.text

        token = login.json()["access_token"]

        response = await client.delete(
            f"/api/admin/tracks/{track_id}",
            headers={
                "Authorization": f"Bearer {token}",
            },
        )

    assert response.status_code == 200, response.text

    payload = response.json()

    assert payload["success"] is True
    assert payload["deleted_track_id"] == str(track_id)
    assert payload["deleted_object_key"] == object_key

    assert payload["deleted_artwork_object_key"] == artwork_object_key

    assert payload["deleted_b2_versions"] == 4

    assert sorted(fake_bucket.deleted) == sorted(
        [
            (object_key, "audio-v1"),
            (object_key, "audio-v2"),
            (artwork_object_key, "art-v1"),
            (artwork_object_key, "art-v2"),
        ]
    )

    async with get_session_factory()() as session:
        result = await session.execute(
            select(Track).where(
                Track.id == track_id,
            )
        )

        assert result.scalar_one_or_none() is None


@pytest.mark.asyncio
async def test_admin_delete_keeps_track_hidden_when_b2_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    run_id = uuid4().hex[:8]
    track_id = uuid4()

    async with get_session_factory()() as session:
        session.add(
            Track(
                id=track_id,
                title="Keep Me",
                artist="Failure Safe Artist",
                album="Failure Safe Album",
                b2_object_key=(
                    f"audio/failure-safe-{run_id}.mp3"
                ),
                mime_type="audio/mpeg",
                file_size=2048,
                duration_seconds=90,
                is_published=True,
            )
        )
        await session.commit()

    class FailingBucket:
        def list_file_versions(
            self,
            file_name: str | None = None,
        ):
            raise RuntimeError(
                "simulated B2 outage"
            )

    monkeypatch.setattr(
        admin_routes,
        "get_b2_bucket",
        lambda:
            FailingBucket(),
    )

    async with get_session_factory()() as session:
        with pytest.raises(
            HTTPException,
        ) as exc_info:
            await admin_routes.delete_track(
                track_id,
                cast(User, SimpleNamespace()),
                session,
            )

        assert (
            exc_info.value.status_code
            == 500
        )

    async with get_session_factory()() as session:
        preserved = await session.get(
            Track,
            track_id,
        )

        assert preserved is not None
        assert preserved.is_published is False


@pytest.mark.asyncio
@pytest.mark.parametrize("bulk", [False, True])
async def test_partial_storage_failure_is_hidden_and_retryable_in_database(
    monkeypatch: pytest.MonkeyPatch,
    bulk: bool,
) -> None:
    track_id, unrelated_id = uuid4(), uuid4()
    audio_key = f"audio/recovery-{track_id}.mp3"
    artwork_key = f"artwork/recovery-{track_id}.jpg"
    session_factory = get_session_factory()
    async with session_factory() as session:
        session.add_all([
            Track(
                id=track_id,
                title="Partial deletion",
                artist="Recovery test",
                b2_object_key=audio_key,
                artwork_object_key=artwork_key,
                is_published=True,
            ),
            Track(
                id=unrelated_id,
                title="Unrelated",
                artist="Recovery test",
                b2_object_key=f"audio/unrelated-{unrelated_id}.mp3",
                is_published=True,
            ),
        ])
        await session.commit()

    remaining = {audio_key, artwork_key}
    fail_artwork = True

    async def remove_versions(bucket, key: str) -> int:
        if key == artwork_key and fail_artwork:
            raise RuntimeError("artwork unavailable after audio deletion")
        count = int(key in remaining)
        remaining.discard(key)
        return count

    monkeypatch.setattr(admin_routes, "get_b2_bucket", lambda: object())
    monkeypatch.setattr(admin_routes, "delete_all_object_versions", remove_versions)

    async def delete(session):
        if bulk:
            return await admin_routes.delete_tracks_bulk(
                admin_routes.BulkTrackDeleteRequest(track_ids=[track_id]),
                User(),
                session,
            )
        return await admin_routes.delete_track(track_id, User(), session)

    async with session_factory() as session:
        if bulk:
            assert (await delete(session))["success"] is False
        else:
            with pytest.raises(HTTPException):
                await delete(session)

    assert remaining == {artwork_key}
    async with session_factory() as session:
        preserved = await session.get(Track, track_id)
        unrelated = await session.get(Track, unrelated_id)
        assert preserved is not None and preserved.is_published is False
        assert unrelated is not None and unrelated.is_published is True

    fail_artwork = False
    async with session_factory() as session:
        assert (await delete(session))["success"] is True
    async with session_factory() as session:
        assert await session.get(Track, track_id) is None
        unrelated = await session.get(Track, unrelated_id)
        assert unrelated is not None and unrelated.is_published is True
    assert remaining == set()
