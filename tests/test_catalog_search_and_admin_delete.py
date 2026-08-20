from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

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
        run_id = uuid4().hex  # noqa: F841

    session_factory = get_session_factory()

    async with session_factory() as session:
        session.add_all(
            [
                Track(
                    id=uuid4(),
                    title="Acoustic Sunrise",
                    artist="Coastal Echo",
                    album="Morning Tide",
                    b2_object_key="audio/acoustic.wav",
                    artwork_object_key="artwork/acoustic.jpg",
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
        response = await client.get("/api/catalog/tracks", params={"q": "sunrise"})

    assert response.status_code == 200, response.text
    payload = response.json()
    assert len(payload) == 1
    assert payload[0]["title"] == "Acoustic Sunrise"
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
            mime_type="audio/wav",
            file_size=4096,
            duration_seconds=64,
            is_published=True,
        )

        session.add(track)
        await session.commit()
        await session.refresh(track)

        track_id = str(track.id)

    class FakeBucket:
        def __init__(self) -> None:
            self.deleted: list[tuple[str, str]] = []

        def list_file_versions(
            self,
            file_name: str | None = None,
        ):
            assert file_name == object_key

            return [
                type(
                    "Version",
                    (),
                    {
                        "file_name": object_key,
                        "file_id": "v1",
                    },
                )(),
                type(
                    "Version",
                    (),
                    {
                        "file_name": object_key,
                        "file_id": "v2",
                    },
                )(),
            ]

        def delete_file_version(
            self,
            file_id: str,
            file_name: str,
        ):
            self.deleted.append(
                (file_name, file_id),
            )

    monkeypatch.setattr(
        "backend.app.api.routes.admin.get_b2_bucket",
        lambda: FakeBucket(),
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
    assert payload["deleted_track_id"] == track_id
    assert payload["deleted_object_key"] == object_key

    async with get_session_factory()() as session:
        result = await session.execute(
            select(Track).where(
                Track.id == track_id,
            )
        )

        assert result.scalar_one_or_none() is None
