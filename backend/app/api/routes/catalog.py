from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from ...database import get_session_factory
from ...models.media import Track

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


@router.get(
    "/tracks",
    response_model=list[TrackResponse],
)
async def list_tracks() -> list[TrackResponse]:
    session_factory = get_session_factory()

    async with session_factory() as session:
        result = await session.execute(
            select(Track).where(Track.is_published.is_(True)).order_by(Track.artist, Track.title)
        )

        tracks = result.scalars().all()

        return [
            TrackResponse(
                id=track.id,
                title=track.title,
                artist=track.artist,
                album=track.album,
                duration_seconds=track.duration_seconds,
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
        )
