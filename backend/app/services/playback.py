from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import cast
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import delete, or_, select
from sqlalchemy.dialects.postgresql import (
    insert as postgresql_insert,
)
from sqlalchemy.ext.asyncio import AsyncSession

from ..api.routes.catalog import (
    _track_artwork_version,
    _track_media_version,
)
from ..api.schemas.playback import (
    PlaybackDeviceKind,
    PlaybackDevicePollRequest,
    PlaybackDevicePollResponse,
    PlaybackDeviceResponse,
    PlaybackRemoteAction,
    PlaybackRemoteCommandRequest,
    PlaybackRemoteCommandResponse,
    PlaybackStateResponse,
    PlaybackStateUpdateRequest,
    PlaybackTrackResponse,
)
from ..models.account import (
    AccountType,
    PlaybackCommand,
    PlaybackDevice,
    User,
    UserAppState,
)
from ..models.media import Track
from .playback_events import PlaybackEvent, notify_playback_event
from .playback_realtime import PlaybackRealtimeHub, playback_realtime_hub
from .track_urls import artwork_url, audio_url

PLAYBACK_DEVICE_ONLINE_TTL = timedelta(seconds=90)
PLAYBACK_DEVICE_LIST_LIMIT = 20
PLAYBACK_COMMAND_BATCH_LIMIT = 32


def require_registered_playback_user(
    user: User,
) -> None:
    if user.account_type != AccountType.REGISTERED:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="A registered account is required for playback sync.",
        )


def playback_track_response(
    track: Track,
) -> PlaybackTrackResponse:
    return PlaybackTrackResponse(
        id=track.id,
        title=track.title,
        artist=track.artist,
        album=track.album,
        genre=getattr(
            track,
            "genre",
            None,
        ),
        release_year=getattr(
            track,
            "release_year",
            None,
        ),
        duration_seconds=(
            track.duration_seconds
        ),
        audio_url=audio_url(
            track,
        ),
        artwork_url=artwork_url(
            track,
        ),
        mime_type=track.mime_type,
        file_size=track.file_size,
        media_version=(
            _track_media_version(
                track,
            )
        ),
        artwork_version=(
            _track_artwork_version(
                track,
            )
        ),
    )


def playback_queue_track_response(
    track: Track,
) -> PlaybackTrackResponse:
    return PlaybackTrackResponse(
        id=track.id,
        title=track.title,
        artist=track.artist,
        album=track.album,
        genre=getattr(
            track,
            "genre",
            None,
        ),
        release_year=getattr(
            track,
            "release_year",
            None,
        ),
        duration_seconds=(
            track.duration_seconds
        ),
        audio_url=(
            f"/api/audio/{track.id}"
        ),
        artwork_url=(
            (
                "/api/catalog/tracks/"
                f"{track.id}/artwork"
            )
            if track.artwork_object_key
            else None
        ),
        mime_type=track.mime_type,
        file_size=track.file_size,
        media_version=(
            _track_media_version(
                track,
            )
        ),
        artwork_version=(
            _track_artwork_version(
                track,
            )
        ),
    )


async def build_account_playback_queue(
    session: AsyncSession,
    state: UserAppState | None,
    selected_track_id: UUID | None,
) -> tuple[
    list[PlaybackTrackResponse],
    int | None,
]:
    if state is None:
        return [], None

    raw_ids = (
        state.playback_queue_track_ids
        if isinstance(
            state.playback_queue_track_ids,
            list,
        )
        else []
    )

    queue_ids: list[UUID] = []

    for raw_id in raw_ids[:500]:
        try:
            queue_ids.append(
                UUID(
                    str(
                        raw_id,
                    )
                )
            )
        except (
            TypeError,
            ValueError,
        ):
            continue

    if (
        not queue_ids
        and selected_track_id
        is not None
    ):
        queue_ids = [
            selected_track_id,
        ]

    if not queue_ids:
        return [], None

    result = await session.execute(
        select(
            Track,
        ).where(
            Track.id.in_(
                set(
                    queue_ids,
                )
            ),
            Track.is_published.is_(
                True,
            ),
        )
    )

    by_id = {
        track.id:
            track
        for track in result.scalars().all()
    }

    queue: list[
        PlaybackTrackResponse
    ] = []

    requested_index = (
        state.playback_queue_index
        if isinstance(
            state.playback_queue_index,
            int,
        )
        else None
    )

    canonical_index: int | None = None

    for original_index, queue_id in enumerate(
        queue_ids,
    ):
        track = by_id.get(
            queue_id,
        )

        if track is None:
            continue

        if (
            requested_index
            == original_index
        ):
            canonical_index = len(
                queue,
            )

        queue.append(
            playback_queue_track_response(
                track,
            )
        )

    if selected_track_id is not None:
        selected_index = next(
            (
                index
                for index, item in enumerate(
                    queue,
                )
                if item.id
                == selected_track_id
            ),
            None,
        )

        if selected_index is not None:
            canonical_index = (
                selected_index
            )

    if (
        canonical_index is None
        and queue
    ):
        canonical_index = 0

    return (
        queue,
        canonical_index,
    )


async def build_playback_state(
    session: AsyncSession,
    user: User,
) -> PlaybackStateResponse:
    require_registered_playback_user(
        user,
    )

    state = await session.get(
        UserAppState,
        user.id,
    )

    if (
        state is None
        or state.playback_track_id
        is None
    ):
        return PlaybackStateResponse(
            position_seconds=0.0,
            paused=True,
            device_id=(
                state.playback_device_id
                if state is not None
                else None
            ),
            updated_at=(
                state.playback_updated_at
                if state is not None
                else None
            ),
        )

    track = await session.get(
        Track,
        state.playback_track_id,
    )

    queue, queue_index = (
        await build_account_playback_queue(
            session,
            state,
            state.playback_track_id,
        )
    )

    if (
        track is None
        or not track.is_published
    ):
        return PlaybackStateResponse(
            position_seconds=0.0,
            paused=True,
            device_id=(
                state.playback_device_id
            ),
            updated_at=(
                state.playback_updated_at
            ),
        )

    return PlaybackStateResponse(
        track=playback_track_response(
            track,
        ),
        position_seconds=max(
            float(
                state.playback_position_seconds
                or 0.0
            ),
            0.0,
        ),
        paused=bool(
            state.playback_paused
        ),
        device_id=(
            state.playback_device_id
        ),
        queue=queue,
        queue_index=queue_index,
        updated_at=(
            state.playback_updated_at
        ),
    )


@dataclass(frozen=True)
class PlaybackStateMutationResult:
    state: PlaybackStateResponse
    changed: bool


async def update_playback_state(
    payload: PlaybackStateUpdateRequest,
    user: User,
    session: AsyncSession,
) -> PlaybackStateMutationResult:
    require_registered_playback_user(
        user,
    )

    track = None

    if payload.track_id is not None:
        result = await session.execute(
            select(
                Track,
            ).where(
                Track.id == payload.track_id,
                Track.is_published.is_(
                    True,
                ),
            )
        )

        track = (
            result.scalar_one_or_none()
        )

        if track is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Track not found.",
            )

    state = await session.get(
        UserAppState,
        user.id,
    )

    if state is None:
        state = UserAppState(
            user_id=user.id,
        )

        session.add(
            state,
        )

    elif (
        state.playback_device_id
        and state.playback_device_id
        != payload.device_id
    ):
        active_device = await session.get(
            PlaybackDevice,
            (
                user.id,
                state.playback_device_id,
            ),
        )

        if (
            active_device is not None
            and (
                playback_device_is_online(
                    active_device.last_seen_at,
                )
                or await playback_realtime_hub.is_connected(
                    user.id,
                    state.playback_device_id,
                )
            )
        ):
            return PlaybackStateMutationResult(
                state=await build_playback_state(
                    session,
                    user,
                ),
                changed=False,
            )

    position = max(
        float(
            payload.position_seconds
        ),
        0.0,
    )

    if (
        track is not None
        and track.duration_seconds is not None
        and track.duration_seconds > 0
    ):
        position = min(
            position,
            float(
                track.duration_seconds
            ),
        )

    if track is None:
        position = 0.0

    state.playback_track_id = (
        track.id
        if track is not None
        else None
    )

    state.playback_position_seconds = (
        position
    )

    state.playback_paused = (
        True
        if track is None
        else payload.paused
    )

    state.playback_device_id = (
        payload.device_id
    )

    queue_ids = [
        str(queue_id)
        for queue_id in payload.queue_track_ids[:500]
    ]

    queue_index = (
        payload.queue_index
        if (
            payload.queue_index is not None
            and payload.queue_index < len(queue_ids)
        )
        else None
    )

    if track is None:
        queue_ids = []
        queue_index = None
    else:
        track_id_value = str(track.id)

        if not queue_ids:
            queue_ids = [
                track_id_value,
            ]
            queue_index = 0
        elif (
            queue_index is None
            or queue_ids[queue_index]
            != track_id_value
        ):
            try:
                queue_index = queue_ids.index(
                    track_id_value,
                )
            except ValueError:
                queue_ids.insert(
                    0,
                    track_id_value,
                )
                queue_ids = queue_ids[:500]
                queue_index = 0

    state.playback_queue_track_ids = (
        queue_ids
    )

    state.playback_queue_index = (
        queue_index
    )

    state.playback_updated_at = (
        datetime.now(
            UTC,
        )
    )

    await notify_playback_event(
        session,
        PlaybackEvent(
            kind="playback_state_changed",
            user_id=user.id,
            source_device_id=payload.device_id,
        ),
    )
    await session.commit()

    return PlaybackStateMutationResult(
        state=await build_playback_state(
            session,
            user,
        ),
        changed=True,
    )


def playback_device_is_online(
    last_seen_at: datetime,
    *,
    now: datetime | None = None,
) -> bool:
    reference = (
        now
        if now is not None
        else datetime.now(
            UTC,
        )
    )

    normalized_last_seen = (
        last_seen_at
        if last_seen_at.tzinfo
        is not None
        else last_seen_at.replace(
            tzinfo=UTC,
        )
    )

    return (
        reference -
        normalized_last_seen
        <=
        PLAYBACK_DEVICE_ONLINE_TTL
    )


async def touch_playback_device(
    session: AsyncSession,
    user: User,
    *,
    device_id: str,
    name: str,
    device_type: PlaybackDeviceKind,
    now: datetime | None = None,
) -> None:
    reference = (
        now
        if now is not None
        else datetime.now(
            UTC,
        )
    )

    values = {
        "user_id":
            user.id,
        "device_id":
            device_id,
        "name":
            name,
        "device_type":
            device_type,
        "last_seen_at":
            reference,
    }

    statement = (
        postgresql_insert(
            PlaybackDevice,
        )
        .values(
            **values,
        )
        .on_conflict_do_update(
            index_elements=[
                PlaybackDevice.user_id,
                PlaybackDevice.device_id,
            ],
            set_={
                "name":
                    name,
                "device_type":
                    device_type,
                "last_seen_at":
                    reference,
            },
        )
    )

    # Presence is written with one database statement instead of
    # loading an ORM row and mutating it. The HTTP poll and live
    # WebSocket heartbeat can arrive at the same time, and stale
    # cleanup may also be running. An upsert makes all three cases
    # safe without an ORM UPDATE expecting a row that was deleted.
    existing_result = await session.execute(
        select(PlaybackDevice).where(
            PlaybackDevice.user_id == user.id,
            PlaybackDevice.device_id == device_id,
        )
    )
    existing_device = existing_result.scalar_one_or_none()
    presence_changed = (
        existing_device is None
        or not playback_device_is_online(
            existing_device.last_seen_at,
            now=reference,
        )
        or existing_device.name != name
        or existing_device.device_type != device_type
    )

    await session.execute(
        statement,
    )
    # Polling refreshes last_seen_at frequently. Notify only when this
    # refresh actually changes presence, otherwise remote clients would
    # poll in response to a notification and create a feedback loop.
    if presence_changed:
        await notify_playback_event(
            session,
            PlaybackEvent(
                kind="presence_changed",
                user_id=user.id,
                target_device_id=device_id,
            ),
        )


async def prune_offline_playback_devices(
    session: AsyncSession,
    user: User,
    *,
    now: datetime | None = None,
) -> list[str]:
    reference = (
        now
        if now is not None
        else datetime.now(
            UTC,
        )
    )

    cutoff = (
        reference -
        PLAYBACK_DEVICE_ONLINE_TTL
    )

    connected_device_ids = (
        await playback_realtime_hub
        .connected_device_ids(
            user.id,
        )
    )

    stale_conditions = [
        PlaybackDevice.user_id
        == user.id,
        PlaybackDevice.last_seen_at
        < cutoff,
    ]

    if connected_device_ids:
        stale_conditions.append(
            PlaybackDevice.device_id.not_in(
                connected_device_ids,
            )
        )

    stale_result = await session.execute(
        delete(
            PlaybackDevice,
        )
        .where(
            *stale_conditions,
        )
        .returning(
            PlaybackDevice.device_id,
        )
    )

    stale_device_ids = [
        str(
            device_id,
        )
        for device_id in
        stale_result.scalars().all()
    ]

    if not stale_device_ids:
        return []

    await session.execute(
        delete(
            PlaybackCommand,
        ).where(
            PlaybackCommand.user_id
            == user.id,
            PlaybackCommand.target_device_id.in_(
                stale_device_ids,
            ),
        )
    )

    state = await session.get(
        UserAppState,
        user.id,
    )

    playback_state_changed = False
    if (
        state is not None
        and state.playback_device_id
        in stale_device_ids
    ):
        state.playback_paused = True
        state.playback_device_id = None
        state.playback_updated_at = reference
        playback_state_changed = True

    await notify_playback_event(
        session,
        PlaybackEvent(
            kind="presence_changed",
            user_id=user.id,
        ),
    )
    if playback_state_changed:
        await notify_playback_event(
            session,
            PlaybackEvent(
                kind="playback_state_changed",
                user_id=user.id,
            ),
        )

    return stale_device_ids


async def list_playback_devices(
    session: AsyncSession,
    user: User,
    *,
    active_device_id: str | None,
    now: datetime | None = None,
) -> list[
    PlaybackDeviceResponse
]:
    reference = (
        now
        if now is not None
        else datetime.now(
            UTC,
        )
    )

    connected_device_ids = (
        await playback_realtime_hub
        .connected_device_ids(
            user.id,
        )
    )

    online_cutoff = (
        reference -
        PLAYBACK_DEVICE_ONLINE_TTL
    )

    online_condition = (
        PlaybackDevice.last_seen_at
        >= online_cutoff
    )

    if connected_device_ids:
        online_condition = or_(
            online_condition,
            PlaybackDevice.device_id.in_(
                connected_device_ids,
            ),
        )

    result = await session.execute(
        select(
            PlaybackDevice,
        )
        .where(
            PlaybackDevice.user_id
            == user.id,
            online_condition,
        )
        .order_by(
            PlaybackDevice.last_seen_at.desc(),
        )
        .limit(
            PLAYBACK_DEVICE_LIST_LIMIT,
        )
    )

    devices = list(
        result.scalars().all()
    )

    return [
        PlaybackDeviceResponse(
            device_id=(
                device.device_id
            ),
            name=device.name,
            device_type=cast(
                PlaybackDeviceKind,
                device.device_type
                if device.device_type in {
                    "desktop",
                    "mobile",
                    "tablet",
                    "browser",
                }
                else "browser",
            ),
            is_online=(
                device.device_id
                in connected_device_ids
                or playback_device_is_online(
                    device.last_seen_at,
                    now=reference,
                )
            ),
            is_active=(
                active_device_id
                is not None
                and device.device_id
                == active_device_id
            ),
            last_seen_at=(
                device.last_seen_at
            ),
        )
        for device in devices
    ]


def playback_command_response(
    command: PlaybackCommand,
    *,
    queue: list[
        PlaybackTrackResponse
    ] | None = None,
    queue_index: int | None = None,
) -> PlaybackRemoteCommandResponse:
    return PlaybackRemoteCommandResponse(
        id=command.id,
        source_device_id=(
            command.source_device_id
        ),
        target_device_id=(
            command.target_device_id
        ),
        action=cast(
            PlaybackRemoteAction,
            command.action,
        ),
        value=command.value,
        queue=(
            queue
            if queue is not None
            else []
        ),
        queue_index=queue_index,
        created_at=(
            command.created_at
        ),
    )


def _as_utc_playback_time(
    value: datetime | None,
) -> datetime | None:
    if value is None:
        return None

    if value.tzinfo is None:
        return value.replace(
            tzinfo=UTC,
        )

    return value.astimezone(
        UTC,
    )


async def poll_playback_device(
    payload: PlaybackDevicePollRequest,
    user: User,
    session: AsyncSession,
):
    require_registered_playback_user(
        user,
    )

    now = datetime.now(
        UTC,
    )

    await touch_playback_device(
        session,
        user,
        device_id=(
            payload.device_id
        ),
        name=payload.name,
        device_type=(
            payload.device_type
        ),
        now=now,
    )

    await prune_offline_playback_devices(
        session,
        user,
        now=now,
    )

    commands_result = (
        await session.execute(
            select(
                PlaybackCommand,
            )
            .where(
                PlaybackCommand.user_id
                == user.id,
                PlaybackCommand.target_device_id
                == payload.device_id,
                PlaybackCommand.consumed_at.is_(
                    None,
                ),
            )
            .order_by(
                PlaybackCommand.created_at.asc(),
            )
            .limit(
                PLAYBACK_COMMAND_BATCH_LIMIT,
            )
        )
    )

    commands = list(
        commands_result.scalars().all()
    )

    for command in commands:
        command.consumed_at = now

    await session.commit()

    playback_state = (
        await build_playback_state(
            session,
            user,
        )
    )

    devices = (
        await list_playback_devices(
            session,
            user,
            active_device_id=(
                playback_state.device_id
            ),
            now=now,
        )
    )

    return PlaybackDevicePollResponse(
        devices=devices,
        commands=[
            playback_command_response(
                command,
            )
            for command in commands
        ],
        playback_state=(
            playback_state
        ),
    )


async def send_playback_device_command(
    target_device_id: str,
    payload: PlaybackRemoteCommandRequest,
    user: User,
    session: AsyncSession,
):
    require_registered_playback_user(
        user,
    )

    target = await session.get(
        PlaybackDevice,
        (
            user.id,
            target_device_id,
        ),
    )

    if target is None:
        raise HTTPException(
            status_code=(
                status.HTTP_404_NOT_FOUND
            ),
            detail=(
                "Playback device not found."
            ),
        )

    now = datetime.now(
        UTC,
    )

    target_connected = (
        await playback_realtime_hub
        .is_connected(
            user.id,
            target_device_id,
        )
    )

    if (
        not target_connected
        and not playback_device_is_online(
            target.last_seen_at,
            now=now,
        )
    ):
        await session.execute(
            delete(
                PlaybackCommand,
            ).where(
                PlaybackCommand.user_id
                == user.id,
                PlaybackCommand.target_device_id
                == target_device_id,
            )
        )

        await session.delete(
            target,
        )

        await session.commit()

        raise HTTPException(
            status_code=(
                status.HTTP_404_NOT_FOUND
            ),
            detail=(
                "Playback device not found."
            ),
        )

    value = payload.value
    selected_track = None

    canonical_queue: list[
        PlaybackTrackResponse
    ] = []

    canonical_queue_index: int | None = (
        None
    )

    if payload.action == "seek":
        if (
            value is None
            or value < 0
            or value > 86_400
        ):
            raise HTTPException(
                status_code=(
                    status.HTTP_400_BAD_REQUEST
                ),
                detail=(
                    "Seek commands require a "
                    "position between 0 and "
                    "86400 seconds."
                ),
            )

    elif payload.action == "volume":
        if (
            value is None
            or value < 0
            or value > 1
        ):
            raise HTTPException(
                status_code=(
                    status.HTTP_400_BAD_REQUEST
                ),
                detail=(
                    "Volume commands require "
                    "a value between 0 and 1."
                ),
            )

    elif (
        payload.action
        == "play_track"
        and payload.track_id
        is None
    ):
        raise HTTPException(
            status_code=(
                status.HTTP_400_BAD_REQUEST
            ),
            detail=(
                "Play-track commands require "
                "a track id."
            ),
        )

    elif (
        payload.action
        in {
            "play_track",
            "transfer",
        }
        and payload.track_id
        is not None
    ):
        value = None

        track_result = await session.execute(
            select(
                Track,
            ).where(
                Track.id
                == payload.track_id,
                Track.is_published.is_(
                    True,
                ),
            )
        )

        selected_track = (
            track_result
            .scalar_one_or_none()
        )

        if selected_track is None:
            raise HTTPException(
                status_code=(
                    status.HTTP_404_NOT_FOUND
                ),
                detail="Track not found.",
            )

        requested_queue_ids = list(
            payload.queue_track_ids
        )

        requested_queue_index = (
            payload.queue_index
        )

        if (
            requested_queue_index
            is None
            or requested_queue_index
            >= len(
                requested_queue_ids,
            )
            or requested_queue_ids[
                requested_queue_index
            ]
            != payload.track_id
        ):
            requested_queue_index = (
                next(
                    (
                        index
                        for (
                            index,
                            queue_track_id,
                        )
                        in enumerate(
                            requested_queue_ids
                        )
                        if queue_track_id
                        == payload.track_id
                    ),
                    None,
                )
            )

        if not requested_queue_ids:
            requested_queue_ids = [
                payload.track_id,
            ]

            requested_queue_index = 0

        queue_track_result = (
            await session.execute(
                select(
                    Track,
                ).where(
                    Track.id.in_(
                        set(
                            requested_queue_ids,
                        )
                    ),
                    Track.is_published.is_(
                        True,
                    ),
                )
            )
        )

        queue_track_by_id = {
            track.id:
                track
            for track
            in queue_track_result.scalars().all()
        }

        canonical_queue = []

        for (
            original_index,
            queue_track_id,
        ) in enumerate(
            requested_queue_ids,
        ):
            queue_track = (
                queue_track_by_id.get(
                    queue_track_id,
                )
            )

            if queue_track is None:
                continue

            if (
                requested_queue_index
                == original_index
            ):
                canonical_queue_index = (
                    len(
                        canonical_queue,
                    )
                )

            canonical_queue.append(
                playback_queue_track_response(
                    queue_track,
                )
            )

        if (
            canonical_queue_index
            is None
        ):
            for (
                index,
                queue_track,
            ) in enumerate(
                canonical_queue,
            ):
                if (
                    queue_track.id
                    == payload.track_id
                ):
                    canonical_queue_index = (
                        index
                    )

                    break

        if (
            canonical_queue_index
            is None
        ):
            canonical_queue.insert(
                0,
                playback_queue_track_response(
                    selected_track,
                ),
            )

            canonical_queue_index = 0

    else:
        value = None

    if payload.action in {
        "transfer",
        "play_track",
    }:
        # A fresh handoff/song choice supersedes every
        # unconsumed command that targeted that device.
        await session.execute(
            delete(
                PlaybackCommand,
            ).where(
                PlaybackCommand.user_id
                == user.id,
                PlaybackCommand.target_device_id
                == target_device_id,
                PlaybackCommand.consumed_at
                .is_(
                    None,
                ),
            )
        )

    elif payload.action in {
        "seek",
        "volume",
    }:
        # Rapid scrubbing/volume changes should never build
        # a stale command backlog. Only the newest value matters.
        await session.execute(
            delete(
                PlaybackCommand,
            ).where(
                PlaybackCommand.user_id
                == user.id,
                PlaybackCommand.target_device_id
                == target_device_id,
                PlaybackCommand.action
                == payload.action,
                PlaybackCommand.consumed_at
                .is_(
                    None,
                ),
            )
        )

    command = PlaybackCommand(
        user_id=user.id,
        target_device_id=(
            target_device_id
        ),
        source_device_id=(
            payload.source_device_id
        ),
        action=payload.action,
        value=value,
    )

    session.add(
        command,
    )

    previous_pause_command = None
    playback_state_row = None
    broadcast_playback_state = False

    if payload.action in {
        "transfer",
        "play_track",
    }:
        playback_state_row = (
            await session.get(
                UserAppState,
                user.id,
            )
        )

        if playback_state_row is None:
            playback_state_row = (
                UserAppState(
                    user_id=user.id,
                )
            )

            session.add(
                playback_state_row,
            )

        previous_device_id = (
            playback_state_row
            .playback_device_id
        )

        if payload.action == "transfer":
            if selected_track is not None:
                playback_state_row.playback_track_id = (
                    selected_track.id
                )

            if payload.position_seconds is not None:
                playback_state_row.playback_position_seconds = (
                    max(
                        float(
                            payload.position_seconds,
                        ),
                        0.0,
                    )
                )

                if payload.paused is not None:
                    playback_state_row.playback_paused = (
                        bool(
                            payload.paused,
                        )
                    )
            else:
                updated_at = (
                    _as_utc_playback_time(
                        playback_state_row
                        .playback_updated_at,
                    )
                )

                if (
                    not playback_state_row
                    .playback_paused
                    and updated_at
                    is not None
                ):
                    elapsed = max(
                        (
                            now -
                            updated_at
                        ).total_seconds(),
                        0.0,
                    )

                    playback_state_row.playback_position_seconds = (
                        max(
                            float(
                                playback_state_row
                                .playback_position_seconds
                                or 0.0
                            ),
                            0.0,
                        )
                        + elapsed
                    )

            if canonical_queue:
                playback_state_row.playback_queue_track_ids = [
                    str(
                        queue_track.id,
                    )
                    for queue_track
                    in canonical_queue
                ]

                playback_state_row.playback_queue_index = (
                    canonical_queue_index
                )

            elif payload.queue_track_ids:
                transfer_queue_ids = [
                    str(
                        queue_id,
                    )
                    for queue_id
                    in payload.queue_track_ids[:500]
                ]

                playback_state_row.playback_queue_track_ids = (
                    transfer_queue_ids
                )

                playback_state_row.playback_queue_index = (
                    payload.queue_index
                    if (
                        payload.queue_index
                        is not None
                        and payload.queue_index
                        < len(
                            transfer_queue_ids,
                        )
                    )
                    else None
                )
        else:
            playback_state_row.playback_track_id = (
                selected_track.id
                if selected_track
                is not None
                else None
            )

            playback_state_row.playback_position_seconds = (
                0.0
            )

            playback_state_row.playback_paused = (
                False
            )

            playback_state_row.playback_queue_track_ids = [
                str(
                    queue_track.id,
                )
                for queue_track
                in canonical_queue
            ]

            playback_state_row.playback_queue_index = (
                canonical_queue_index
            )

        playback_state_row.playback_device_id = (
            target_device_id
        )

        playback_state_row.playback_updated_at = (
            now
        )

        broadcast_playback_state = True

        if (
            previous_device_id
            and previous_device_id
            != target_device_id
        ):
            previous_pause_command = (
                PlaybackCommand(
                    user_id=user.id,
                    target_device_id=(
                        previous_device_id
                    ),
                    source_device_id=(
                        payload
                        .source_device_id
                    ),
                    action="pause",
                )
            )

            session.add(
                previous_pause_command,
            )

    if payload.action in {
        "play",
        "pause",
        "seek",
        "stop",
    }:
        if playback_state_row is None:
            playback_state_row = (
                await session.get(
                    UserAppState,
                    user.id,
                )
            )

        if (
            playback_state_row is not None
            and playback_state_row.playback_device_id
            == target_device_id
        ):
            updated_at = (
                _as_utc_playback_time(
                    playback_state_row
                    .playback_updated_at,
                )
            )

            if (
                not playback_state_row
                    .playback_paused
                and updated_at is not None
            ):
                elapsed = max(
                    (
                        now -
                        updated_at
                    ).total_seconds(),
                    0.0,
                )

                playback_state_row.playback_position_seconds = (
                    max(
                        float(
                            playback_state_row
                            .playback_position_seconds
                            or 0.0
                        ),
                        0.0,
                    )
                    + elapsed
                )

            if payload.action == "play":
                playback_state_row.playback_paused = (
                    False
                )

            elif payload.action == "pause":
                playback_state_row.playback_paused = (
                    True
                )

            elif payload.action == "seek":
                playback_state_row.playback_position_seconds = (
                    max(
                        float(
                            value
                            or 0.0
                        ),
                        0.0,
                    )
                )

            elif payload.action == "stop":
                playback_state_row.playback_track_id = (
                    None
                )

                playback_state_row.playback_position_seconds = (
                    0.0
                )

                playback_state_row.playback_paused = (
                    True
                )

                playback_state_row.playback_queue_track_ids = (
                    []
                )

                playback_state_row.playback_queue_index = (
                    None
                )

            playback_state_row.playback_updated_at = (
                now
            )

            broadcast_playback_state = True

    # Flush to obtain durable command ids before notifying listeners. The
    # notification is part of this transaction and cannot precede its commit.
    await session.flush()
    await notify_playback_event(
        session,
        PlaybackEvent(
            kind="command_ready",
            user_id=user.id,
            target_device_id=target_device_id,
            source_device_id=payload.source_device_id,
            command_id=command.id,
        ),
    )
    if previous_pause_command is not None:
        await notify_playback_event(
            session,
            PlaybackEvent(
                kind="command_ready",
                user_id=user.id,
                target_device_id=previous_pause_command.target_device_id,
                source_device_id=previous_pause_command.source_device_id,
                command_id=previous_pause_command.id,
            ),
        )
    if broadcast_playback_state:
        await notify_playback_event(
            session,
            PlaybackEvent(
                kind="playback_state_changed",
                user_id=user.id,
                source_device_id=payload.source_device_id,
            ),
        )

    await session.commit()

    await session.refresh(
        command,
    )

    if previous_pause_command is not None:
        await session.refresh(
            previous_pause_command,
        )

    command_response = (
        playback_command_response(
            command,
            queue=(
                canonical_queue
                if payload.action
                == "play_track"
                else None
            ),
            queue_index=(
                canonical_queue_index
                if payload.action
                == "play_track"
                else None
            ),
        )
    )

    playback_state = (
        await build_playback_state(
            session,
            user,
        )
    )

    if previous_pause_command is not None:
        previous_response = (
            playback_command_response(
                previous_pause_command,
            )
        )

        # Notify the previous owner of the ownership change
        # before the target command is delivered. Current clients
        # use the attached playback state as the handoff start,
        # keep the old audio alive until the target publishes its
        # applied state, then overlap for one additional second.
        # The pause command remains a backward-compatible fallback.
        previous_pause_delivered = (
            await playback_realtime_hub.send_to(
                user.id,
                previous_pause_command
                .target_device_id,
                {
                    "type":
                        "command",
                    "command":
                        previous_response.model_dump(
                            mode="json",
                        ),
                    "playback_state":
                        playback_state.model_dump(
                            mode="json",
                        ),
                },
            )
        )

        if previous_pause_delivered:
            previous_pause_command.consumed_at = (
                datetime.now(
                    UTC,
                )
            )

    if broadcast_playback_state:
        await playback_realtime_hub.broadcast(
            user.id,
            {
                "type":
                    "playback_state",
                "playback_state":
                    playback_state.model_dump(
                        mode="json",
                    ),
            },
        )

    command_delivered = (
        await playback_realtime_hub.send_to(
            user.id,
            target_device_id,
            {
                "type": "command",
                "command":
                    command_response.model_dump(
                        mode="json",
                    ),
                "playback_state":
                    playback_state.model_dump(
                        mode="json",
                    ),
            },
        )
    )

    if command_delivered:
        command.consumed_at = (
            datetime.now(
                UTC,
            )
        )

    if (
        command_delivered
        or (
            previous_pause_command
            is not None
            and previous_pause_command
            .consumed_at
            is not None
        )
    ):
        await session.commit()

    return command_response

async def handle_playback_event(
    event: PlaybackEvent,
    *,
    hub: PlaybackRealtimeHub = playback_realtime_hub,
) -> None:
    """Deliver a durable event to sockets owned by this API process."""
    session_factory = get_session_factory()

    if event.kind == "command_ready":
        if event.command_id is None:
            return

        async with session_factory() as session:
            command_result = await session.execute(
                select(PlaybackCommand)
                .where(
                    PlaybackCommand.id == event.command_id,
                    PlaybackCommand.user_id == event.user_id,
                    PlaybackCommand.consumed_at.is_(None),
                )
                .with_for_update()
            )
            command = command_result.scalar_one_or_none()
            if command is None:
                return
            if (
                event.target_device_id is not None
                and command.target_device_id != event.target_device_id
            ):
                return

            user = await session.get(User, event.user_id)
            if user is None or user.account_type != AccountType.REGISTERED:
                return

            playback_state = await build_playback_state(session, user)
            command_response = playback_command_response(
                command,
                queue=(
                    playback_state.queue
                    if command.action in {"play_track", "transfer"}
                    else None
                ),
                queue_index=(
                    playback_state.queue_index
                    if command.action in {"play_track", "transfer"}
                    else None
                ),
            )
            delivered = await hub.send_to(
                user.id,
                command.target_device_id,
                {
                    "type": "command",
                    "command": command_response.model_dump(mode="json"),
                    "playback_state": playback_state.model_dump(mode="json"),
                },
            )
            if delivered:
                command.consumed_at = datetime.now(UTC)
                await session.commit()
            else:
                # Leave the durable command for its owning replica or poll fallback.
                await session.rollback()
        return

    if event.kind == "playback_state_changed":
        async with session_factory() as session:
            user = await session.get(User, event.user_id)
            if user is None or user.account_type != AccountType.REGISTERED:
                return
            playback_state = await build_playback_state(session, user)

        await hub.broadcast(
            event.user_id,
            {
                "type": "playback_state",
                "playback_state": playback_state.model_dump(mode="json"),
            },
        )
        return

    if event.kind == "presence_changed":
        await hub.broadcast(
            event.user_id,
            {"type": "presence_changed"},
        )

