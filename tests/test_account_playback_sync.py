from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient

from backend.app.database import (
    get_engine,
    get_session_factory,
)
from backend.app.main import app
from backend.app.models.base import Base
from backend.app.models.media import Track


@pytest.fixture(autouse=True)
async def playback_database_schema() -> None:
    async with get_engine().begin() as connection:
        await connection.run_sync(
            Base.metadata.create_all,
        )


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


@pytest.mark.asyncio
async def test_same_account_devices_can_control_active_playback() -> None:
    run_id = uuid4().hex[:8]
    username = f"device-control-{run_id}"

    track_id = uuid4()

    session_factory = get_session_factory()

    async with session_factory() as session:
        session.add(
            Track(
                id=track_id,
                title="Remote Control Song",
                artist="HyperSync Devices",
                album="Connect",
                b2_object_key=(
                    f"audio/device-control-{run_id}.mp3"
                ),
                artwork_object_key=(
                    f"artwork/device-control-{run_id}.jpg"
                ),
                mime_type="audio/mpeg",
                file_size=4096,
                duration_seconds=240,
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
            "Authorization":
                f"Bearer {token}",
        }

        first_poll = await client.post(
            "/api/users/me/playback-devices/poll",
            headers=headers,
            json={
                "device_id":
                    "device-one",
                "name":
                    "Chrome on Desktop",
                "device_type":
                    "desktop",
            },
        )

        assert (
            first_poll.status_code
            == 200
        ), first_poll.text

        second_poll = await client.post(
            "/api/users/me/playback-devices/poll",
            headers=headers,
            json={
                "device_id":
                    "device-two",
                "name":
                    "Phone",
                "device_type":
                    "mobile",
            },
        )

        assert (
            second_poll.status_code
            == 200
        ), second_poll.text

        second_payload = (
            second_poll.json()
        )

        assert {
            device["device_id"]
            for device in
            second_payload["devices"]
        } == {
            "device-one",
            "device-two",
        }

        playback = await client.patch(
            "/api/users/me/playback-state",
            headers=headers,
            json={
                "track_id":
                    str(
                        track_id,
                    ),
                "position_seconds":
                    25,
                "paused":
                    False,
                "device_id":
                    "device-one",
            },
        )

        assert (
            playback.status_code
            == 200
        ), playback.text

        command = await client.post(
            (
                "/api/users/me/playback-devices/"
                "device-one/commands"
            ),
            headers=headers,
            json={
                "source_device_id":
                    "device-two",
                "action":
                    "pause",
            },
        )

        assert (
            command.status_code
            == 201
        ), command.text

        poll_with_command = (
            await client.post(
                "/api/users/me/playback-devices/poll",
                headers=headers,
                json={
                    "device_id":
                        "device-one",
                    "name":
                        "Chrome on Desktop",
                    "device_type":
                        "desktop",
                },
            )
        )

        assert (
            poll_with_command.status_code
            == 200
        ), poll_with_command.text

        payload = (
            poll_with_command.json()
        )

        assert len(
            payload["commands"]
        ) == 1

        delivered = (
            payload["commands"][0]
        )

        assert (
            delivered["action"]
            == "pause"
        )

        assert (
            delivered["source_device_id"]
            == "device-two"
        )

        assert (
            delivered["target_device_id"]
            == "device-one"
        )

        active_devices = [
            device["device_id"]
            for device in
            payload["devices"]
            if device["is_active"]
        ]

        assert active_devices == [
            "device-one",
        ]

        second_delivery = (
            await client.post(
                "/api/users/me/playback-devices/poll",
                headers=headers,
                json={
                    "device_id":
                        "device-one",
                    "name":
                        "Chrome on Desktop",
                    "device_type":
                        "desktop",
                },
            )
        )

        assert (
            second_delivery.status_code
            == 200
        ), second_delivery.text

        assert (
            second_delivery.json()[
                "commands"
            ]
            == []
        )

        bad_seek = await client.post(
            (
                "/api/users/me/playback-devices/"
                "device-one/commands"
            ),
            headers=headers,
            json={
                "source_device_id":
                    "device-two",
                "action":
                    "seek",
                "value":
                    -1,
            },
        )

        assert (
            bad_seek.status_code
            == 400
        ), bad_seek.text


@pytest.mark.asyncio
async def test_playback_devices_are_account_scoped() -> None:
    run_id = uuid4().hex[:8]

    transport = ASGITransport(
        app=app,
    )

    async with (
        AsyncClient(
            transport=transport,
            base_url="http://test",
        ) as first_client,
        AsyncClient(
            transport=transport,
            base_url="http://test",
        ) as second_client,
    ):
        first_token = (
            await register_and_login(
                first_client,
                f"device-owner-{run_id}",
            )
        )

        second_token = (
            await register_and_login(
                second_client,
                f"device-other-{run_id}",
            )
        )

        first_headers = {
            "Authorization":
                f"Bearer {first_token}",
        }

        second_headers = {
            "Authorization":
                f"Bearer {second_token}",
        }

        registered = await first_client.post(
            "/api/users/me/playback-devices/poll",
            headers=first_headers,
            json={
                "device_id":
                    "private-device",
                "name":
                    "Owner Device",
                "device_type":
                    "desktop",
            },
        )

        assert (
            registered.status_code
            == 200
        ), registered.text

        cross_account = (
            await second_client.post(
                (
                    "/api/users/me/playback-devices/"
                    "private-device/commands"
                ),
                headers=second_headers,
                json={
                    "source_device_id":
                        "other-device",
                    "action":
                        "pause",
                },
            )
        )

        assert (
            cross_account.status_code
            == 404
        ), cross_account.text

