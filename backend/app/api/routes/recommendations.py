from __future__ import annotations

from uuid import UUID

from fastapi import (
    APIRouter,
)
from pydantic import (
    BaseModel,
    Field,
)

from ...services.autoplay import (
    recommend_autoplay_tracks,
)
from ..dependencies import (
    DatabaseSession,
    OptionalCurrentUser,
)
from .catalog import (
    _track_artwork_url,
    _track_artwork_version,
    _track_audio_url,
    _track_media_version,
)

router = APIRouter(
    prefix="/recommendations",
    tags=[
        "recommendations",
    ],
)


class AutoplayRequest(
    BaseModel,
):
    current_track_id: (
        UUID | None
    ) = None

    exclude_track_ids: list[
        UUID
    ] = Field(
        default_factory=list,
        max_length=100,
    )

    context_track_ids: list[
        UUID
    ] = Field(
        default_factory=list,
        max_length=12,
    )

    limit: int = Field(
        default=8,
        ge=1,
        le=20,
    )


class AutoplayTrackResponse(
    BaseModel,
):
    id: UUID

    title: str

    artist: str

    album: str | None

    audio_url: str | None

    artwork_url: str | None

    mime_type: str | None

    file_size: int | None

    media_version: str | None
    artwork_version: str | None


@router.post(
    "/autoplay",
    response_model=list[
        AutoplayTrackResponse
    ],
)
async def autoplay(
    payload: AutoplayRequest,
    session: DatabaseSession,
    user: OptionalCurrentUser,
) -> list[
    AutoplayTrackResponse
]:
    tracks = (
        await recommend_autoplay_tracks(
            session,
            user_id=(
                user.id
                if user is not None
                else None
            ),
            current_track_id=(
                payload.current_track_id
            ),
            exclude_track_ids=set(
                payload.exclude_track_ids
            ),
            context_track_ids=(
                payload.context_track_ids
            ),
            limit=(
                payload.limit
            ),
        )
    )

    return [
        AutoplayTrackResponse(
            id=track.id,

            title=track.title,

            artist=track.artist,

            album=track.album,

            audio_url=(
                _track_audio_url(
                    track,
                )
            ),

            artwork_url=(
                _track_artwork_url(
                    track,
                )
            ),

            mime_type=(
                track.mime_type
            ),

            file_size=(
                track.file_size
            ),

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
        for track in tracks
    ]
