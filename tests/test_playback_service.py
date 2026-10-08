from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from backend.app.api.schemas.playback import (
    PlaybackDevicePollRequest,
    PlaybackRemoteCommandRequest,
    PlaybackStateUpdateRequest,
)
from backend.app.database import get_session_factory
from backend.app.models.account import (
    AccountType,
    PlaybackCommand,
    PlaybackDevice,
    User,
    UserAppState,
    UserRole,
)
from backend.app.models.media import Track
from backend.app.services.playback import (
    build_account_playback_queue,
    poll_playback_device,
    prune_offline_playback_devices,
    send_playback_device_command,
    update_playback_state,
)


def _track(track_id, *, published=True) -> Track:
    return Track(
        id=track_id,
        title=f"Track {track_id}",
        artist="Playback Service",
        album="Queue Contract",
        b2_object_key=f"audio/{track_id}.mp3",
        mime_type="audio/mpeg",
        file_size=4096,
        duration_seconds=180,
        is_published=published,
    )


@pytest.mark.asyncio
async def test_queue_canonicalization_preserves_selected_track_and_omits_unpublished() -> None:
    first_id = uuid4()
    unpublished_id = uuid4()
    missing_id = uuid4()
    selected_id = uuid4()

    session_factory = get_session_factory()
    async with session_factory() as session:
        session.add_all(
            [
                _track(first_id),
                _track(unpublished_id, published=False),
                _track(selected_id),
            ]
        )
        await session.commit()

        state = UserAppState(
            user_id=uuid4(),
            playback_queue_track_ids=[
                str(first_id),
                str(unpublished_id),
                str(missing_id),
                str(selected_id),
            ],
            playback_queue_index=1,
        )

        queue, queue_index = await build_account_playback_queue(
            session,
            state,
            selected_id,
        )

    assert [item.id for item in queue] == [
        first_id,
        selected_id,
    ]
    assert queue_index == 1


@pytest.mark.asyncio
async def test_queue_canonicalization_caps_at_500() -> None:
    ignored_track_id = uuid4()
    queue_ids = [uuid4() for _ in range(500)] + [ignored_track_id]

    session_factory = get_session_factory()
    async with session_factory() as session:
        session.add(_track(ignored_track_id))
        await session.commit()

        state = UserAppState(
            user_id=uuid4(),
            playback_queue_track_ids=[
                str(track_id)
                for track_id in queue_ids
            ],
            playback_queue_index=500,
        )

        queue, queue_index = await build_account_playback_queue(
            session,
            state,
            None,
        )

    assert queue == []
    assert queue_index is None


def _registered_user(run_id: str) -> User:
    return User(
        id=uuid4(),
        username=f"playback-{run_id}",
        username_normalized=f"playback-{run_id}",
        email=f"playback-{run_id}@example.test",
        password_hash="not-used-by-playback-tests",
        role=UserRole.USER,
        account_type=AccountType.REGISTERED,
        is_active=True,
    )


@pytest.mark.asyncio
async def test_pruning_retains_stale_device_with_connected_socket(
    monkeypatch,
) -> None:
    run_id = uuid4().hex[:8]
    now = datetime.now(UTC)
    user = _registered_user(run_id)

    session_factory = get_session_factory()
    async with session_factory() as session:
        session.add(user)
        await session.flush()

        session.add(
            PlaybackDevice(
                user_id=user.id,
                device_id="connected-device",
                name="Connected Device",
                device_type="desktop",
                last_seen_at=now - timedelta(minutes=5),
            )
        )
        await session.commit()

        async def connected_device_ids(_user_id):
            return {"connected-device"}

        monkeypatch.setattr(
            "backend.app.services.playback.playback_realtime_hub.connected_device_ids",
            connected_device_ids,
        )

        removed = await prune_offline_playback_devices(
            session,
            user,
            now=now,
        )

        device = await session.get(
            PlaybackDevice,
            (user.id, "connected-device"),
        )

    assert removed == []
    assert device is not None


@pytest.mark.asyncio
async def test_pruning_removes_stale_device_commands_and_playback_ownership(
    monkeypatch,
) -> None:
    run_id = uuid4().hex[:8]
    now = datetime.now(UTC)
    stale_seen_at = now - timedelta(minutes=5)
    user = _registered_user(run_id)

    session_factory = get_session_factory()
    async with session_factory() as session:
        session.add(user)
        await session.flush()

        session.add(
            PlaybackDevice(
                user_id=user.id,
                device_id="stale-device",
                name="Stale Device",
                device_type="mobile",
                last_seen_at=stale_seen_at,
            )
        )
        session.add(
            PlaybackCommand(
                user_id=user.id,
                target_device_id="stale-device",
                source_device_id="controller",
                action="pause",
                consumed_at=None,
            )
        )
        session.add(
            UserAppState(
                user_id=user.id,
                playback_device_id="stale-device",
                playback_paused=False,
                playback_updated_at=stale_seen_at,
            )
        )
        await session.commit()

        async def connected_device_ids(_user_id):
            return set()

        monkeypatch.setattr(
            "backend.app.services.playback.playback_realtime_hub.connected_device_ids",
            connected_device_ids,
        )

        removed = await prune_offline_playback_devices(
            session,
            user,
            now=now,
        )

        device = await session.get(
            PlaybackDevice,
            (user.id, "stale-device"),
        )
        commands = (
            await session.execute(
                select(PlaybackCommand).where(
                    PlaybackCommand.user_id == user.id,
                    PlaybackCommand.target_device_id == "stale-device",
                )
            )
        ).scalars().all()
        state = await session.get(
            UserAppState,
            user.id,
        )

    assert removed == ["stale-device"]
    assert device is None
    assert commands == []
    assert state is not None
    assert state.playback_paused is True
    assert state.playback_device_id is None
    assert state.playback_updated_at == now



@pytest.mark.asyncio
async def test_poll_consumes_oldest_32_commands_without_replay() -> None:
    run_id = uuid4().hex[:8]
    now = datetime.now(UTC)
    user = _registered_user(run_id)

    session_factory = get_session_factory()
    async with session_factory() as session:
        session.add(user)
        await session.flush()

        session.add(
            PlaybackDevice(
                user_id=user.id,
                device_id="poll-device",
                name="Poll Device",
                device_type="desktop",
                last_seen_at=now,
            )
        )
        session.add_all(
            [
                PlaybackCommand(
                    user_id=user.id,
                    target_device_id="poll-device",
                    source_device_id=f"source-{index:02d}",
                    action="pause",
                    created_at=now + timedelta(milliseconds=index),
                )
                for index in range(35)
            ]
        )
        await session.commit()

        payload = PlaybackDevicePollRequest(
            device_id="poll-device",
            name="Poll Device",
            device_type="desktop",
        )

        first = await poll_playback_device(
            payload,
            user,
            session,
        )
        second = await poll_playback_device(
            payload,
            user,
            session,
        )
        third = await poll_playback_device(
            payload,
            user,
            session,
        )

    assert len(first.commands) == 32
    assert [
        command.source_device_id
        for command in first.commands
    ] == [
        f"source-{index:02d}"
        for index in range(32)
    ]
    assert [
        command.source_device_id
        for command in second.commands
    ] == [
        "source-32",
        "source-33",
        "source-34",
    ]
    assert third.commands == []


@pytest.mark.asyncio
async def test_command_coalescing_and_handoff_supersession(
    monkeypatch,
) -> None:
    run_id = uuid4().hex[:8]
    now = datetime.now(UTC)
    user = _registered_user(run_id)

    async def not_connected(_user_id, _device_id):
        return False

    async def not_delivered(_user_id, _device_id, _payload):
        return False

    async def ignore_broadcast(
        _user_id,
        _payload,
        *,
        exclude_device_id=None,
    ):
        del exclude_device_id

    monkeypatch.setattr(
        "backend.app.services.playback.playback_realtime_hub.is_connected",
        not_connected,
    )
    monkeypatch.setattr(
        "backend.app.services.playback.playback_realtime_hub.send_to",
        not_delivered,
    )
    monkeypatch.setattr(
        "backend.app.services.playback.playback_realtime_hub.broadcast",
        ignore_broadcast,
    )

    session_factory = get_session_factory()
    async with session_factory() as session:
        session.add(user)
        await session.flush()
        session.add(
            PlaybackDevice(
                user_id=user.id,
                device_id="target-device",
                name="Target Device",
                device_type="mobile",
                last_seen_at=now,
            )
        )
        await session.commit()

        await send_playback_device_command(
            "target-device",
            PlaybackRemoteCommandRequest(
                source_device_id="controller",
                action="seek",
                value=10,
            ),
            user,
            session,
        )
        await send_playback_device_command(
            "target-device",
            PlaybackRemoteCommandRequest(
                source_device_id="controller",
                action="volume",
                value=0.25,
            ),
            user,
            session,
        )
        await send_playback_device_command(
            "target-device",
            PlaybackRemoteCommandRequest(
                source_device_id="controller",
                action="seek",
                value=20,
            ),
            user,
            session,
        )

        pending = (
            await session.execute(
                select(PlaybackCommand)
                .where(
                    PlaybackCommand.user_id == user.id,
                    PlaybackCommand.target_device_id == "target-device",
                    PlaybackCommand.consumed_at.is_(None),
                )
                .order_by(PlaybackCommand.created_at.asc())
            )
        ).scalars().all()

        assert [
            (command.action, command.value)
            for command in pending
        ] == [
            ("volume", 0.25),
            ("seek", 20.0),
        ]

        await send_playback_device_command(
            "target-device",
            PlaybackRemoteCommandRequest(
                source_device_id="controller",
                action="transfer",
            ),
            user,
            session,
        )

        superseded = (
            await session.execute(
                select(PlaybackCommand).where(
                    PlaybackCommand.user_id == user.id,
                    PlaybackCommand.target_device_id == "target-device",
                    PlaybackCommand.consumed_at.is_(None),
                )
            )
        ).scalars().all()

    assert len(superseded) == 1
    assert superseded[0].action == "transfer"


@pytest.mark.asyncio
async def test_update_playback_state_clamps_position_and_normalizes_queue() -> None:
    run_id = uuid4().hex[:8]
    track_id = uuid4()
    unpublished_id = uuid4()
    user = _registered_user(run_id)

    session_factory = get_session_factory()
    async with session_factory() as session:
        session.add_all(
            [
                user,
                _track(track_id),
                _track(unpublished_id, published=False),
            ]
        )
        await session.commit()

        result = await update_playback_state(
            PlaybackStateUpdateRequest(
                track_id=track_id,
                position_seconds=999,
                paused=False,
                device_id="state-device",
                queue_track_ids=[
                    unpublished_id,
                    track_id,
                ],
                queue_index=0,
            ),
            user,
            session,
        )

        assert result.changed is True
        assert result.state.track is not None
        assert result.state.track.id == track_id
        assert result.state.position_seconds == 180
        assert result.state.paused is False
        assert result.state.device_id == "state-device"
        assert [item.id for item in result.state.queue] == [track_id]
        assert result.state.queue_index == 0


@pytest.mark.asyncio
async def test_update_playback_state_clears_state_when_track_is_null() -> None:
    run_id = uuid4().hex[:8]
    track_id = uuid4()
    user = _registered_user(run_id)

    session_factory = get_session_factory()
    async with session_factory() as session:
        session.add_all(
            [
                user,
                _track(track_id),
            ]
        )
        await session.commit()

        first = await update_playback_state(
            PlaybackStateUpdateRequest(
                track_id=track_id,
                position_seconds=20,
                paused=False,
                device_id="state-device",
                queue_track_ids=[track_id],
                queue_index=0,
            ),
            user,
            session,
        )

        cleared = await update_playback_state(
            PlaybackStateUpdateRequest(
                track_id=None,
                position_seconds=99,
                paused=False,
                device_id="state-device",
                queue_track_ids=[track_id],
                queue_index=0,
            ),
            user,
            session,
        )

    assert first.changed is True
    assert cleared.changed is True
    assert cleared.state.track is None
    assert cleared.state.position_seconds == 0
    assert cleared.state.paused is True
    assert cleared.state.queue == []
    assert cleared.state.queue_index is None


@pytest.mark.asyncio
async def test_update_playback_state_rejects_unpublished_track() -> None:
    run_id = uuid4().hex[:8]
    track_id = uuid4()
    user = _registered_user(run_id)

    session_factory = get_session_factory()
    async with session_factory() as session:
        session.add_all(
            [
                user,
                _track(track_id, published=False),
            ]
        )
        await session.commit()

        with pytest.raises(
            HTTPException,
            match="Track not found.",
        ):
            await update_playback_state(
                PlaybackStateUpdateRequest(
                    track_id=track_id,
                    position_seconds=1,
                    paused=False,
                    device_id="state-device",
                ),
                user,
                session,
            )


@pytest.mark.asyncio
async def test_update_playback_state_rejects_stale_connected_owner(
    monkeypatch,
) -> None:
    run_id = uuid4().hex[:8]
    track_id = uuid4()
    user = _registered_user(run_id)
    stale_seen_at = datetime.now(UTC) - timedelta(minutes=5)

    async def connected(_user_id, device_id):
        return device_id == "current-device"

    monkeypatch.setattr(
        "backend.app.services.playback.playback_realtime_hub.is_connected",
        connected,
    )

    session_factory = get_session_factory()
    async with session_factory() as session:
        session.add(user)
        await session.flush()

        session.add_all(
            [
                _track(track_id),
                PlaybackDevice(
                    user_id=user.id,
                    device_id="current-device",
                    name="Current Device",
                    device_type="desktop",
                    last_seen_at=stale_seen_at,
                ),
                UserAppState(
                    user_id=user.id,
                    playback_track_id=track_id,
                    playback_position_seconds=42,
                    playback_paused=False,
                    playback_device_id="current-device",
                    playback_queue_track_ids=[str(track_id)],
                    playback_queue_index=0,
                    playback_updated_at=stale_seen_at,
                ),
            ]
        )
        await session.commit()

        result = await update_playback_state(
            PlaybackStateUpdateRequest(
                track_id=track_id,
                position_seconds=99,
                paused=True,
                device_id="old-device",
                queue_track_ids=[str(track_id)],
                queue_index=0,
            ),
            user,
            session,
        )

        assert result.changed is False
        assert result.state.device_id == "current-device"
        assert result.state.position_seconds == 42
        assert result.state.paused is False

        state = await session.get(
            UserAppState,
            user.id,
        )

    assert state is not None
    assert state.playback_device_id == "current-device"
    assert float(state.playback_position_seconds) == 42
    assert state.playback_paused is False
