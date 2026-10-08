from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import select

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
    prune_offline_playback_devices,
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
