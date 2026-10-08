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
    PlaybackDeviceResponse,
    PlaybackStateResponse,
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
from .playback_realtime import playback_realtime_hub
from .track_urls import artwork_url, audio_url

PLAYBACK_DEVICE_ONLINE_TTL = timedelta(seconds=90)
PLAYBACK_DEVICE_LIST_LIMIT = 20


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
    await session.execute(
        statement,
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

    if (
        state is not None
        and state.playback_device_id
        in stale_device_ids
    ):
        state.playback_paused = True
        state.playback_device_id = None
        state.playback_updated_at = reference

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
