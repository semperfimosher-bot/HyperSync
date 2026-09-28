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


def _catalog_uuid_or_none(
    value: UUID | str | None,
) -> UUID | None:
    if value is None:
        return None

    if isinstance(
        value,
        UUID,
    ):
        return value

    try:
        return UUID(
            str(
                value,
            ).strip()
        )
    except (
        TypeError,
        ValueError,
        AttributeError,
    ):
        return None


def _catalog_uuid_list(
    values: list[
        UUID | str
    ],
    *,
    limit: int,
) -> list[
    UUID
]:
    result: list[
        UUID
    ] = []
    seen: set[
        UUID
    ] = set()

    for value in values:
        track_id = (
            _catalog_uuid_or_none(
                value,
            )
        )

        if (
            track_id is None
            or track_id in seen
        ):
            continue

        seen.add(
            track_id,
        )

        result.append(
            track_id,
        )

        if (
            len(
                result,
            )
            >= limit
        ):
            break

    return result


class AutoplayRequest(
    BaseModel,
):
    current_track_id: (
        UUID | str | None
    ) = None

    exclude_track_ids: list[
        UUID | str
    ] = Field(
        default_factory=list,
        max_length=100,
    )

    context_track_ids: list[
        UUID | str
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
    genre: str | None = None
    release_year: int | None = None

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
                _catalog_uuid_or_none(
                    payload.current_track_id
                )
            ),
            exclude_track_ids=set(
                _catalog_uuid_list(
                    payload.exclude_track_ids,
                    limit=100,
                )
            ),
            context_track_ids=(
                _catalog_uuid_list(
                    payload.context_track_ids,
                    limit=12,
                )
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
