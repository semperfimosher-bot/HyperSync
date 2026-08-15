import asyncio
import mimetypes
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import or_, select

from ...config import get_settings
from ...database import get_session_factory
from ...models.media import Track
from ...services.b2 import get_b2_bucket
from .audio import stream_b2_file

router = APIRouter(
    prefix="/catalog",
    tags=["catalog"],
)


class TrackResponse(BaseModel):
    id: UUID
    title: str
    artist: str
    album: str | None
    duration_seconds: int | None
    artwork_url: str | None = None


def _track_artwork_url(track: Track) -> str | None:
    if not track.artwork_object_key:
        return None

    if track.artwork_object_key.startswith(("http://", "https://")):
        return track.artwork_object_key

    return f"/api/catalog/tracks/{track.id}/artwork"


@router.get(
    "/tracks",
    response_model=list[TrackResponse],
)
async def list_tracks(
    q: str | None = Query(default=None, description="Search by title, artist, or album"),
) -> list[TrackResponse]:
    session_factory = get_session_factory()

    async with session_factory() as session:
        stmt = select(Track).where(Track.is_published.is_(True))

        if q and q.strip():
            term = f"%{q.strip()}%"
            stmt = stmt.where(
                or_(
                    Track.title.ilike(term),
                    Track.artist.ilike(term),
                    Track.album.ilike(term),
                )
            )

        stmt = stmt.order_by(Track.artist, Track.title)
        result = await session.execute(stmt)

        tracks = result.scalars().all()

        return [
            TrackResponse(
                id=track.id,
                title=track.title,
                artist=track.artist,
                album=track.album,
                duration_seconds=track.duration_seconds,
                artwork_url=_track_artwork_url(track),
            )
            for track in tracks
        ]


@router.get(
    "/tracks/{track_id}",
    response_model=TrackResponse,
)
async def get_track(track_id: UUID) -> TrackResponse:
    session_factory = get_session_factory()

    async with session_factory() as session:
        result = await session.execute(
            select(Track).where(
                Track.id == track_id,
                Track.is_published.is_(True),
            )
        )

        track = result.scalar_one_or_none()

        if track is None:
            raise HTTPException(
                status_code=404,
                detail="Track not found.",
            )

        return TrackResponse(
            id=track.id,
            title=track.title,
            artist=track.artist,
            album=track.album,
            duration_seconds=track.duration_seconds,
            artwork_url=_track_artwork_url(track),
        )


@router.get("/tracks/{track_id}/artwork")
async def get_track_artwork(track_id: UUID):
    session_factory = get_session_factory()

    async with session_factory() as session:
        result = await session.execute(
            select(Track).where(
                Track.id == track_id,
                Track.is_published.is_(True),
            )
        )
        track = result.scalar_one_or_none()

    if track is None:
        raise HTTPException(
            status_code=404,
            detail="Track not found.",
        )

    object_key = track.artwork_object_key
    if not object_key:
        raise HTTPException(
            status_code=404,
            detail="Artwork not available for this track.",
        )

    if object_key.startswith(("http://", "https://")):
        from fastapi.responses import RedirectResponse

        return RedirectResponse(url=object_key, status_code=302)

    settings = get_settings()

    try:
        bucket = get_b2_bucket()
        downloaded = await asyncio.to_thread(
            bucket.download_file_by_name,
            object_key,
        )
        content_type, _ = mimetypes.guess_type(object_key)
        if not content_type:
            content_type = "image/jpeg"

        cache_seconds = max(settings.b2_presigned_url_ttl_seconds, 300)
        return StreamingResponse(
            stream_b2_file(downloaded),
            media_type=content_type,
            headers={
                "Cache-Control": f"public, max-age={cache_seconds}, stale-while-revalidate={cache_seconds * 2}",
            },
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Artwork unavailable: {str(exc)}",
        ) from exc
