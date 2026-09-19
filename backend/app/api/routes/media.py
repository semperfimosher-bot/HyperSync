import hashlib
import logging
from uuid import UUID

from fastapi import (
    APIRouter,
    HTTPException,
    Query,
    Response,
    status,
)
from pydantic import BaseModel
from sqlalchemy import select

from ...config import get_settings
from ...database import get_session_factory
from ...models.media import Track
from ...services.b2 import (
    create_presigned_download_url,
)

router = APIRouter(
    prefix="/media",
    tags=["media"],
)


logger = logging.getLogger(
    __name__,
)


class MediaSourceResponse(BaseModel):
    url: str
    media_version: str
    mime_type: str
    file_size: int
    expires_in_seconds: int


def media_version_for_track(
    track: Track,
) -> str | None:
    object_key = track.b2_object_key

    if not object_key:
        return None

    return hashlib.sha256(
        object_key.encode(
            "utf-8",
        ),
    ).hexdigest()


@router.get(
    "/{track_id}/source",
    response_model=MediaSourceResponse,
)
async def get_media_source(
    track_id: UUID,
    response: Response,
    version: str = Query(
        min_length=1,
        max_length=128,
    ),
) -> MediaSourceResponse:
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"

    session_factory = get_session_factory()

    async with session_factory() as session:
        result = await session.execute(
            select(
                Track,
            ).where(
                Track.id == track_id,
                Track.is_published.is_(
                    True,
                ),
            ),
        )

        track = result.scalar_one_or_none()

    if track is None:
        raise HTTPException(
            status_code=(status.HTTP_404_NOT_FOUND),
            detail="Track not found.",
        )

    current_version = media_version_for_track(
        track,
    )

    if not current_version or version != current_version:
        raise HTTPException(
            status_code=(status.HTTP_409_CONFLICT),
            detail=("The requested media version is no longer current."),
        )

    file_size = track.file_size

    if (
        not isinstance(
            file_size,
            int,
        )
        or file_size <= 0
    ):
        raise HTTPException(
            status_code=(status.HTTP_503_SERVICE_UNAVAILABLE),
            detail=("Track media metadata is unavailable."),
        )

    settings = get_settings()

    ttl = max(
        int(settings.b2_presigned_url_ttl_seconds),
        60,
    )

    try:
        url = create_presigned_download_url(
            track.b2_object_key,
        )

    except Exception as exc:
        logger.exception(
            ("Unable to authorize direct media source for track %s."),
            track.id,
        )

        raise HTTPException(
            status_code=(status.HTTP_503_SERVICE_UNAVAILABLE),
            detail=("Direct media delivery is temporarily unavailable."),
            headers={
                "Retry-After": "2",
            },
        ) from exc

    return MediaSourceResponse(
        url=url,
        media_version=(current_version),
        mime_type=(track.mime_type or "application/octet-stream"),
        file_size=file_size,
        expires_in_seconds=ttl,
    )
