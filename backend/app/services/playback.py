from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..api.routes.catalog import (
    _track_artwork_version,
    _track_media_version,
)
from ..api.schemas.playback import (
    PlaybackStateResponse,
    PlaybackTrackResponse,
)
from ..models.account import (
    AccountType,
    User,
    UserAppState,
)
from ..models.media import Track
from .track_urls import artwork_url, audio_url


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
