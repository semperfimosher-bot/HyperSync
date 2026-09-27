from datetime import (
    UTC,
    datetime,
    timedelta,
)
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from backend.app.database import (
    get_engine,
    get_session_factory,
)
from backend.app.main import app
from backend.app.models.account import (
    PlaybackDevice,
    User,
)
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



@pytest.mark.asyncio
async def test_offline_playback_devices_are_removed_from_database() -> None:
    run_id = uuid4().hex[:8]
    username = f"device-prune-{run_id}"

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

        session_factory = (
            get_session_factory()
        )

        async with session_factory() as session:
            user = (
                await session.execute(
                    select(
                        User,
                    ).where(
                        User.username
                        == username,
                    )
                )
            ).scalar_one()

            stale_device = PlaybackDevice(
                user_id=user.id,
                device_id="stale-device",
                name="Old Browser",
                device_type="desktop",
                last_seen_at=(
                    datetime.now(
                        UTC,
                    )
                    -
                    timedelta(
                        minutes=10,
                    )
                ),
            )

            session.add(
                stale_device,
            )

            await session.commit()

            user_id = user.id

        poll = await client.post(
            "/api/users/me/playback-devices/poll",
            headers=headers,
            json={
                "device_id":
                    "live-device",
                "name":
                    "Current Browser",
                "device_type":
                    "desktop",
            },
        )

        assert (
            poll.status_code
            == 200
        ), poll.text

        assert {
            device["device_id"]
            for device in
            poll.json()["devices"]
        } == {
            "live-device",
        }

        async with session_factory() as session:
            stale_row = await session.get(
                PlaybackDevice,
                (
                    user_id,
                    "stale-device",
                ),
            )

            assert stale_row is None



@pytest.mark.asyncio
async def test_stale_playback_device_can_refresh_itself_without_stale_update() -> None:
    run_id = uuid4().hex[:8]
    username = f"device-refresh-{run_id}"

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
                    "returning-device",
                "name":
                    "Desktop",
                "device_type":
                    "desktop",
            },
        )

        assert first_poll.status_code == 200, first_poll.text

        session_factory = get_session_factory()

        async with session_factory() as session:
            user = (
                await session.execute(
                    select(User).where(
                        User.username
                        == username,
                    )
                )
            ).scalar_one()

            device = await session.get(
                PlaybackDevice,
                (
                    user.id,
                    "returning-device",
                ),
            )

            assert device is not None

            device.last_seen_at = (
                datetime.now(UTC)
                - timedelta(
                    seconds=6,
                )
            )

            await session.commit()

        refreshed = await client.post(
            "/api/users/me/playback-devices/poll",
            headers=headers,
            json={
                "device_id":
                    "returning-device",
                "name":
                    "Desktop",
                "device_type":
                    "desktop",
            },
        )

        assert refreshed.status_code == 200, refreshed.text

        assert [
            device["device_id"]
            for device in refreshed.json()[
                "devices"
            ]
        ] == [
            "returning-device",
        ]


@pytest.mark.asyncio
async def test_playback_device_expires_after_five_seconds_and_releases_audio_owner() -> None:
    run_id = uuid4().hex[:8]
    username = f"device-five-second-{run_id}"
    track_id = uuid4()

    session_factory = get_session_factory()

    async with session_factory() as session:
        session.add(
            Track(
                id=track_id,
                title="Five Second Presence",
                artist="HyperSync Devices",
                album="Connect",
                b2_object_key=(
                    f"audio/device-five-second-{run_id}.mp3"
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
            "Authorization":
                f"Bearer {token}",
        }

        registered = await client.post(
            "/api/users/me/playback-devices/poll",
            headers=headers,
            json={
                "device_id":
                    "expired-device",
                "name":
                    "Old Computer",
                "device_type":
                    "desktop",
            },
        )

        assert registered.status_code == 200, registered.text

        playback = await client.patch(
            "/api/users/me/playback-state",
            headers=headers,
            json={
                "track_id":
                    str(track_id),
                "position_seconds":
                    12,
                "paused":
                    False,
                "device_id":
                    "expired-device",
            },
        )

        assert playback.status_code == 200, playback.text

        async with session_factory() as session:
            user = (
                await session.execute(
                    select(User).where(
                        User.username
                        == username,
                    )
                )
            ).scalar_one()

            device = await session.get(
                PlaybackDevice,
                (
                    user.id,
                    "expired-device",
                ),
            )

            assert device is not None

            device.last_seen_at = (
                datetime.now(UTC)
                - timedelta(
                    seconds=6,
                )
            )

            await session.commit()

        fresh_poll = await client.post(
            "/api/users/me/playback-devices/poll",
            headers=headers,
            json={
                "device_id":
                    "fresh-device",
                "name":
                    "Phone",
                "device_type":
                    "mobile",
            },
        )

        assert fresh_poll.status_code == 200, fresh_poll.text

        payload = fresh_poll.json()

        assert {
            device["device_id"]
            for device in payload["devices"]
        } == {
            "fresh-device",
        }

        assert (
            payload["playback_state"][
                "device_id"
            ]
            is None
        )

        assert (
            payload["playback_state"][
                "paused"
            ]
            is True
        )


@pytest.mark.asyncio
async def test_transfer_moves_authoritative_playback_owner_before_target_poll() -> None:
    run_id = uuid4().hex[:8]
    username = f"device-transfer-{run_id}"
    track_id = uuid4()

    session_factory = get_session_factory()

    async with session_factory() as session:
        session.add(
            Track(
                id=track_id,
                title="Instant Handoff",
                artist="HyperSync Devices",
                album="Connect",
                b2_object_key=(
                    f"audio/device-transfer-{run_id}.mp3"
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

        for (
            device_id,
            name,
            device_type,
        ) in (
            (
                "computer",
                "Computer",
                "desktop",
            ),
            (
                "phone",
                "Phone",
                "mobile",
            ),
        ):
            response = await client.post(
                "/api/users/me/playback-devices/poll",
                headers=headers,
                json={
                    "device_id":
                        device_id,
                    "name":
                        name,
                    "device_type":
                        device_type,
                },
            )

            assert response.status_code == 200, response.text

        playback = await client.patch(
            "/api/users/me/playback-state",
            headers=headers,
            json={
                "track_id":
                    str(track_id),
                "position_seconds":
                    40,
                "paused":
                    False,
                "device_id":
                    "computer",
            },
        )

        assert playback.status_code == 200, playback.text

        transfer = await client.post(
            (
                "/api/users/me/playback-devices/"
                "phone/commands"
            ),
            headers=headers,
            json={
                "source_device_id":
                    "computer",
                "action":
                    "transfer",
            },
        )

        assert transfer.status_code == 201, transfer.text

        phone_poll = await client.post(
            "/api/users/me/playback-devices/poll",
            headers=headers,
            json={
                "device_id":
                    "phone",
                "name":
                    "Phone",
                "device_type":
                    "mobile",
            },
        )

        assert phone_poll.status_code == 200, phone_poll.text

        phone_payload = phone_poll.json()

        assert (
            phone_payload[
                "playback_state"
            ][
                "device_id"
            ]
            == "phone"
        )

        assert (
            phone_payload[
                "playback_state"
            ][
                "paused"
            ]
            is False
        )

        assert (
            phone_payload[
                "playback_state"
            ][
                "position_seconds"
            ]
            >= 40
        )

        assert [
            command["action"]
            for command in
            phone_payload["commands"]
        ] == [
            "transfer",
        ]

        computer_poll = await client.post(
            "/api/users/me/playback-devices/poll",
            headers=headers,
            json={
                "device_id":
                    "computer",
                "name":
                    "Computer",
                "device_type":
                    "desktop",
            },
        )

        assert computer_poll.status_code == 200, computer_poll.text

        assert [
            command["action"]
            for command in
            computer_poll.json()[
                "commands"
            ]
        ] == [
            "pause",
        ]

        transfer_back = await client.post(
            (
                "/api/users/me/playback-devices/"
                "computer/commands"
            ),
            headers=headers,
            json={
                "source_device_id":
                    "phone",
                "action":
                    "transfer",
            },
        )

        assert (
            transfer_back.status_code
            == 201
        ), transfer_back.text

        computer_return_poll = await client.post(
            "/api/users/me/playback-devices/poll",
            headers=headers,
            json={
                "device_id":
                    "computer",
                "name":
                    "Computer",
                "device_type":
                    "desktop",
            },
        )

        assert (
            computer_return_poll.status_code
            == 200
        ), computer_return_poll.text

        return_payload = (
            computer_return_poll.json()
        )

        assert (
            return_payload[
                "playback_state"
            ][
                "device_id"
            ]
            == "computer"
        )

        assert [
            command["action"]
            for command in
            return_payload[
                "commands"
            ]
        ] == [
            "transfer",
        ]

        phone_return_poll = await client.post(
            "/api/users/me/playback-devices/poll",
            headers=headers,
            json={
                "device_id":
                    "phone",
                "name":
                    "Phone",
                "device_type":
                    "mobile",
            },
        )

        assert (
            phone_return_poll.status_code
            == 200
        ), phone_return_poll.text

        assert [
            command["action"]
            for command in
            phone_return_poll.json()[
                "commands"
            ]
        ] == [
            "pause",
        ]


@pytest.mark.asyncio
async def test_play_track_command_switches_remote_song_and_playback_owner() -> None:
    run_id = uuid4().hex[:8]
    username = f"device-play-track-{run_id}"
    first_track_id = uuid4()
    second_track_id = uuid4()

    session_factory = get_session_factory()

    async with session_factory() as session:
        session.add_all(
            [
                Track(
                    id=first_track_id,
                    title="First Device Song",
                    artist="HyperSync Devices",
                    album="Connect",
                    b2_object_key=(
                        f"audio/device-first-{run_id}.mp3"
                    ),
                    mime_type="audio/mpeg",
                    file_size=4096,
                    duration_seconds=180,
                    is_published=True,
                ),
                Track(
                    id=second_track_id,
                    title="Remote Selected Song",
                    artist="HyperSync Devices",
                    album="Connect",
                    b2_object_key=(
                        f"audio/device-second-{run_id}.mp3"
                    ),
                    mime_type="audio/mpeg",
                    file_size=4096,
                    duration_seconds=200,
                    is_published=True,
                ),
            ]
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

        for device_id in (
            "computer",
            "phone",
        ):
            poll = await client.post(
                "/api/users/me/playback-devices/poll",
                headers=headers,
                json={
                    "device_id":
                        device_id,
                    "name":
                        device_id.title(),
                    "device_type":
                        (
                            "desktop"
                            if device_id
                            == "computer"
                            else "mobile"
                        ),
                },
            )

            assert poll.status_code == 200, poll.text

        first_playback = await client.patch(
            "/api/users/me/playback-state",
            headers=headers,
            json={
                "track_id":
                    str(first_track_id),
                "position_seconds":
                    70,
                "paused":
                    False,
                "device_id":
                    "computer",
            },
        )

        assert first_playback.status_code == 200, first_playback.text

        select_remote = await client.post(
            (
                "/api/users/me/playback-devices/"
                "phone/commands"
            ),
            headers=headers,
            json={
                "source_device_id":
                    "computer",
                "action":
                    "play_track",
                "track_id":
                    str(second_track_id),
                "queue_track_ids": [
                    str(
                        first_track_id,
                    ),
                    str(
                        second_track_id,
                    ),
                ],
                "queue_index":
                    1,
            },
        )

        assert select_remote.status_code == 201, select_remote.text

        remote_command = (
            select_remote.json()
        )

        assert remote_command[
            "queue_index"
        ] == 1

        assert [
            item["id"]
            for item in remote_command[
                "queue"
            ]
        ] == [
            str(
                first_track_id,
            ),
            str(
                second_track_id,
            ),
        ]

        assert (
            remote_command["queue"][1][
                "title"
            ]
            == "Remote Selected Song"
        )

        assert (
            remote_command["queue"][1][
                "audio_url"
            ]
            == (
                "/api/audio/"
                + str(
                    second_track_id,
                )
            )
        )

        phone_poll = await client.post(
            "/api/users/me/playback-devices/poll",
            headers=headers,
            json={
                "device_id":
                    "phone",
                "name":
                    "Phone",
                "device_type":
                    "mobile",
            },
        )

        assert phone_poll.status_code == 200, phone_poll.text

        state = phone_poll.json()[
            "playback_state"
        ]

        assert (
            state["track"]["id"]
            == str(
                second_track_id,
            )
        )

        assert state["device_id"] == "phone"
        assert state["paused"] is False
        assert state["position_seconds"] == pytest.approx(
            0,
        )

        assert [
            command["action"]
            for command in
            phone_poll.json()[
                "commands"
            ]
        ] == [
            "play_track",
        ]



@pytest.mark.asyncio
async def test_old_device_cannot_reclaim_playback_after_transfer() -> None:
    run_id = uuid4().hex[:8]
    username = f"playback-owner-{run_id}"
    track_id = uuid4()

    session_factory = get_session_factory()

    async with session_factory() as session:
        session.add(
            Track(
                id=track_id,
                title="Owner Lock Song",
                artist="HyperSync Devices",
                album="Connect",
                b2_object_key=(
                    f"audio/playback-owner-{run_id}.mp3"
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

        for (
            device_id,
            device_type,
        ) in (
            (
                "computer",
                "desktop",
            ),
            (
                "phone",
                "mobile",
            ),
        ):
            poll = await client.post(
                "/api/users/me/playback-devices/poll",
                headers=headers,
                json={
                    "device_id":
                        device_id,
                    "name":
                        device_id.title(),
                    "device_type":
                        device_type,
                },
            )

            assert poll.status_code == 200, poll.text

        initial = await client.patch(
            "/api/users/me/playback-state",
            headers=headers,
            json={
                "track_id":
                    str(track_id),
                "position_seconds":
                    12,
                "paused":
                    False,
                "device_id":
                    "computer",
            },
        )

        assert initial.status_code == 200, initial.text

        transfer = await client.post(
            (
                "/api/users/me/playback-devices/"
                "phone/commands"
            ),
            headers=headers,
            json={
                "source_device_id":
                    "computer",
                "action":
                    "transfer",
            },
        )

        assert transfer.status_code == 201, transfer.text

        stale_write = await client.patch(
            "/api/users/me/playback-state",
            headers=headers,
            json={
                "track_id":
                    str(track_id),
                "position_seconds":
                    20,
                "paused":
                    True,
                "device_id":
                    "computer",
            },
        )

        assert stale_write.status_code == 200, stale_write.text

        state = stale_write.json()

        assert state["device_id"] == "phone"
        assert state["paused"] is False


@pytest.mark.asyncio
async def test_remote_play_pause_and_seek_update_shared_state_immediately() -> None:
    run_id = uuid4().hex[:8]
    username = f"playback-command-state-{run_id}"
    track_id = uuid4()

    session_factory = get_session_factory()

    async with session_factory() as session:
        session.add(
            Track(
                id=track_id,
                title="Realtime Control Song",
                artist="HyperSync Devices",
                album="Connect",
                b2_object_key=(
                    f"audio/playback-command-state-{run_id}.mp3"
                ),
                mime_type="audio/mpeg",
                file_size=4096,
                duration_seconds=300,
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

        for (
            device_id,
            device_type,
        ) in (
            (
                "computer",
                "desktop",
            ),
            (
                "phone",
                "mobile",
            ),
        ):
            poll = await client.post(
                "/api/users/me/playback-devices/poll",
                headers=headers,
                json={
                    "device_id":
                        device_id,
                    "name":
                        device_id.title(),
                    "device_type":
                        device_type,
                },
            )

            assert poll.status_code == 200, poll.text

        initial = await client.patch(
            "/api/users/me/playback-state",
            headers=headers,
            json={
                "track_id":
                    str(track_id),
                "position_seconds":
                    10,
                "paused":
                    False,
                "device_id":
                    "phone",
            },
        )

        assert initial.status_code == 200, initial.text

        pause = await client.post(
            (
                "/api/users/me/playback-devices/"
                "phone/commands"
            ),
            headers=headers,
            json={
                "source_device_id":
                    "computer",
                "action":
                    "pause",
            },
        )

        assert pause.status_code == 201, pause.text

        paused_state = await client.get(
            "/api/users/me/playback-state",
            headers=headers,
        )

        assert paused_state.status_code == 200, paused_state.text
        assert paused_state.json()["paused"] is True
        assert paused_state.json()["device_id"] == "phone"

        seek = await client.post(
            (
                "/api/users/me/playback-devices/"
                "phone/commands"
            ),
            headers=headers,
            json={
                "source_device_id":
                    "computer",
                "action":
                    "seek",
                "value":
                    83.5,
            },
        )

        assert seek.status_code == 201, seek.text

        seek_state = await client.get(
            "/api/users/me/playback-state",
            headers=headers,
        )

        assert seek_state.status_code == 200, seek_state.text
        assert seek_state.json()["position_seconds"] == pytest.approx(
            83.5,
            abs=0.25,
        )

        play = await client.post(
            (
                "/api/users/me/playback-devices/"
                "phone/commands"
            ),
            headers=headers,
            json={
                "source_device_id":
                    "computer",
                "action":
                    "play",
            },
        )

        assert play.status_code == 201, play.text

        playing_state = await client.get(
            "/api/users/me/playback-state",
            headers=headers,
        )

        assert playing_state.status_code == 200, playing_state.text
        assert playing_state.json()["paused"] is False
        assert playing_state.json()["device_id"] == "phone"



@pytest.mark.asyncio
async def test_transfer_preserves_exact_position_and_account_queue() -> None:
    run_id = uuid4().hex[:8]
    username = f"queue-transfer-{run_id}"
    track_ids = [
        uuid4(),
        uuid4(),
        uuid4(),
    ]

    session_factory = get_session_factory()

    async with session_factory() as session:
        session.add_all(
            [
                Track(
                    id=track_id,
                    title=f"Queue Song {index}",
                    artist="HyperSync Queue",
                    album="Shared Queue",
                    b2_object_key=(
                        f"audio/queue-{run_id}-{index}.mp3"
                    ),
                    mime_type="audio/mpeg",
                    file_size=4096,
                    duration_seconds=240,
                    is_published=True,
                )
                for index, track_id
                in enumerate(
                    track_ids,
                    start=1,
                )
            ]
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

        for device_id, device_type in (
            (
                "computer",
                "desktop",
            ),
            (
                "phone",
                "mobile",
            ),
        ):
            poll = await client.post(
                "/api/users/me/playback-devices/poll",
                headers=headers,
                json={
                    "device_id":
                        device_id,
                    "name":
                        device_id.title(),
                    "device_type":
                        device_type,
                },
            )

            assert poll.status_code == 200, poll.text

        initial = await client.patch(
            "/api/users/me/playback-state",
            headers=headers,
            json={
                "track_id":
                    str(
                        track_ids[0],
                    ),
                "position_seconds":
                    42.0,
                "paused":
                    False,
                "queue_track_ids": [
                    str(
                        track_id,
                    )
                    for track_id
                    in track_ids
                ],
                "queue_index":
                    0,
                "device_id":
                    "computer",
            },
        )

        assert initial.status_code == 200, initial.text

        transfer = await client.post(
            (
                "/api/users/me/playback-devices/"
                "phone/commands"
            ),
            headers=headers,
            json={
                "source_device_id":
                    "computer",
                "action":
                    "transfer",
                "track_id":
                    str(
                        track_ids[1],
                    ),
                "position_seconds":
                    47.25,
                "paused":
                    False,
                "queue_track_ids": [
                    str(
                        track_id,
                    )
                    for track_id
                    in track_ids
                ],
                "queue_index":
                    1,
            },
        )

        assert transfer.status_code == 201, transfer.text

        state = await client.get(
            "/api/users/me/playback-state",
            headers=headers,
        )

        assert state.status_code == 200, state.text
        payload = state.json()

        assert payload[
            "device_id"
        ] == "phone"

        assert payload[
            "track"
        ][
            "id"
        ] == str(
            track_ids[1],
        )

        assert payload[
            "position_seconds"
        ] == pytest.approx(
            47.25,
            abs=0.05,
        )

        assert payload[
            "queue_index"
        ] == 1

        assert [
            item[
                "id"
            ]
            for item in payload[
                "queue"
            ]
        ] == [
            str(
                track_id,
            )
            for track_id
            in track_ids
        ]
