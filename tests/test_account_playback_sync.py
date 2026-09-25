from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient

from backend.app.database import get_session_factory
from backend.app.main import app
from backend.app.models.media import Track


async def register_and_login(
    client: AsyncClient,
    username: str,
) -> str:
    password = "playback-sync-test-pass"

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
async def test_playback_state_syncs_across_devices() -> None:
    run_id = uuid4().hex[:8]
    username = f"playback-sync-{run_id}"

    track_id = uuid4()

    session_factory = get_session_factory()

    async with session_factory() as session:
        session.add(
            Track(
                id=track_id,
                title="Account Sync Song",
                artist="HyperSync Artist",
                album="Sync Album",
                b2_object_key=(
                    f"audio/playback-sync-{run_id}.mp3"
                ),
                artwork_object_key=(
                    f"artwork/playback-sync-{run_id}.jpg"
                ),
                mime_type="audio/mpeg",
                file_size=4096,
                duration_seconds=180,
                is_published=True,
            )
        )

        await session.commit()

    transport = ASGITransport(
        app=app,
    )

    async with AsyncClient(
        transport=transport,
        base_url="http://test",
    ) as client:
        token = await register_and_login(
            client,
            username,
        )

        headers = {
            "Authorization": f"Bearer {token}",
        }

        first = await client.patch(
            "/api/users/me/playback-state",
            headers=headers,
            json={
                "track_id": str(
                    track_id,
                ),
                "position_seconds": 37.5,
                "paused": False,
                "device_id": "device-one",
            },
        )

        assert first.status_code == 200, first.text

        first_payload = first.json()

        assert first_payload["track"]["id"] == str(
            track_id,
        )

        assert first_payload["track"]["title"] == (
            "Account Sync Song"
        )

        assert first_payload["position_seconds"] == pytest.approx(
            37.5,
        )

        assert first_payload["paused"] is False

        assert first_payload["device_id"] == "device-one"

        assert first_payload["updated_at"]

        second = await client.get(
            "/api/users/me/playback-state",
            headers=headers,
        )

        assert second.status_code == 200, second.text

        second_payload = second.json()

        assert second_payload["track"]["id"] == str(
            track_id,
        )

        assert second_payload["position_seconds"] == pytest.approx(
            37.5,
        )

        assert second_payload["paused"] is False

        assert second_payload["device_id"] == "device-one"

        takeover = await client.patch(
            "/api/users/me/playback-state",
            headers=headers,
            json={
                "track_id": str(
                    track_id,
                ),
                "position_seconds": 52,
                "paused": True,
                "device_id": "device-two",
            },
        )

        assert takeover.status_code == 200, takeover.text

        takeover_payload = takeover.json()

        assert takeover_payload["position_seconds"] == pytest.approx(
            52,
        )

        assert takeover_payload["paused"] is True

        assert takeover_payload["device_id"] == "device-two"
