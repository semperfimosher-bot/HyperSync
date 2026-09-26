from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from backend.app.database import get_session_factory
from backend.app.main import app
from backend.app.models.account import User, UserRole
from backend.app.models.media import Track
from backend.app.security.passwords import hash_password


@pytest.mark.asyncio
async def test_admin_bulk_delete_removes_tracks_and_b2_versions(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    run_id = uuid4().hex[:8]
    admin_username = f"bulk-delete-admin-{run_id}"

    session_factory = get_session_factory()

    tracks: list[Track] = []

    async with session_factory() as session:
        admin = User(
            id=uuid4(),
            username=admin_username,
            email=f"{admin_username}@example.com",
            username_normalized=admin_username,
            password_hash=hash_password(
                "hunter2pass",
            ),
            role=UserRole.ADMIN,
            account_type="registered",
            is_active=True,
        )

        session.add(
            admin,
        )

        for index in range(3):
            track = Track(
                id=uuid4(),
                title=f"Bulk Delete {index}",
                artist="Bulk Delete Artist",
                album="Bulk Removal",
                b2_object_key=(
                    f"audio/{run_id}-{index}.mp3"
                ),
                artwork_object_key=(
                    f"artwork/{run_id}-{index}.jpg"
                ),
                mime_type="audio/mpeg",
                file_size=4096,
                duration_seconds=64,
                is_published=True,
            )

            tracks.append(
                track,
            )

            session.add(
                track,
            )

        await session.commit()

    expected_keys = {
        key
        for track in tracks
        for key in (
            track.b2_object_key,
            track.artwork_object_key,
        )
        if key
    }

    class FakeBucket:
        def __init__(self) -> None:
            self.deleted: list[
                tuple[str, str]
            ] = []

        def list_file_versions(
            self,
            file_name: str | None = None,
        ):
            if (
                file_name
                not in expected_keys
            ):
                raise AssertionError(
                    "Unexpected B2 object key: "
                    f"{file_name}"
                )

            return [
                type(
                    "Version",
                    (),
                    {
                        "file_name":
                            file_name,
                        "file_id":
                            f"{file_name}-v1",
                    },
                )(),
            ]

        def delete_file_version(
            self,
            file_id: str,
            file_name: str,
        ):
            self.deleted.append(
                (
                    file_name,
                    file_id,
                ),
            )

    fake_bucket = FakeBucket()

    monkeypatch.setattr(
        (
            "backend.app.api.routes.admin"
            ".get_b2_bucket"
        ),
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
                "username":
                    admin_username,
                "password":
                    "hunter2pass",
            },
        )

        assert (
            login.status_code
            == 200
        ), login.text

        token = (
            login.json()[
                "access_token"
            ]
        )

        response = await client.post(
            "/api/admin/tracks/delete-bulk",
            json={
                "track_ids": [
                    str(
                        track.id,
                    )
                    for track in tracks
                ],
            },
            headers={
                "Authorization":
                    f"Bearer {token}",
            },
        )

    assert (
        response.status_code
        == 200
    ), response.text

    payload = response.json()

    assert payload["success"] is True
    assert payload["deleted_count"] == 3
    assert payload["failed"] == []

    assert set(
        payload[
            "deleted_track_ids"
        ]
    ) == {
        str(
            track.id,
        )
        for track in tracks
    }

    assert (
        payload[
            "deleted_b2_versions"
        ]
        == 6
    )

    assert {
        file_name
        for (
            file_name,
            _,
        ) in fake_bucket.deleted
    } == expected_keys

    async with (
        get_session_factory()()
        as session
    ):
        remaining = list(
            (
                await session.execute(
                    select(
                        Track.id,
                    ).where(
                        Track.id.in_(
                            [
                                track.id
                                for track
                                in tracks
                            ]
                        )
                    )
                )
            )
            .scalars()
            .all()
        )

    assert remaining == []
