import asyncio
import mimetypes
from datetime import (
    UTC,
    datetime,
    timedelta,
)
from typing import Literal
from uuid import UUID

from fastapi import (
    APIRouter,
    HTTPException,
    Query,
    Response,
)
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import or_, select

from ...config import get_settings
from ...database import get_session_factory
from ...models.media import (
    Track,
    TrackLyrics,
)
from ...services.b2 import get_b2_bucket
from ...services.lrclib import (
    LrclibRateLimitedError,
    LrclibUnavailableError,
    fetch_lrclib_lyrics,
)
from .audio import stream_b2_file

router = APIRouter(
    prefix="/catalog",
    tags=["catalog"],
)

LYRICS_NEGATIVE_CACHE_EPOCH = (
    datetime.now(
        UTC,
    )
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
    response: Response,
    q: str | None = Query(
        default=None,
        description="Search by title, artist, or album",
    ),
) -> list[TrackResponse]:

    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"

    response.headers["Pragma"] = "no-cache"

    response.headers["Expires"] = "0"

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


LyricsStatus = Literal[
    "synced",
    "plain",
    "instrumental",
    "not_found",
]


class TrackLyricsResponse(
    BaseModel,
):
    status: LyricsStatus

    source: Literal[
        "lrclib"
    ] = "lrclib"

    lrclib_id: int | None = None

    instrumental: bool = False

    plain_lyrics: (
        str | None
    ) = None

    synced_lyrics: (
        str | None
    ) = None

def _lyrics_status(
    lyrics: TrackLyrics,
) -> LyricsStatus:
    if lyrics.instrumental:
        return "instrumental"

    if lyrics.synced_lyrics:
        return "synced"

    if lyrics.plain_lyrics:
        return "plain"

    return "not_found"


def _lyrics_response(
    lyrics: TrackLyrics,
) -> TrackLyricsResponse:
    return TrackLyricsResponse(
        status=_lyrics_status(
            lyrics,
        ),
        lrclib_id=(
            lyrics.lrclib_id
        ),
        instrumental=(
            lyrics.instrumental
        ),
        plain_lyrics=(
            lyrics.plain_lyrics
        ),
        synced_lyrics=(
            lyrics.synced_lyrics
        ),
    )

@router.get(
    "/tracks/{track_id}/lyrics",
    response_model=TrackLyricsResponse,
)
async def get_track_lyrics(
    track_id: UUID,
    response: Response,
) -> TrackLyricsResponse:
    response.headers[
        "Cache-Control"
    ] = (
        "no-store, no-cache, "
        "must-revalidate, max-age=0"
    )

    settings = get_settings()

    session_factory = (
        get_session_factory()
    )

    async with session_factory() as session:
        result = await session.execute(
            select(Track).where(
                Track.id == track_id,
                Track.is_published.is_(
                    True,
                ),
            ),
        )

        track = (
            result.scalar_one_or_none()
        )

        if track is None:
            raise HTTPException(
                status_code=404,
                detail="Track not found.",
            )

        cached = await session.get(
            TrackLyrics,
            track.id,
        )

        if (
            cached is not None
            and cached.lrclib_id
            is not None
        ):
            return _lyrics_response(
                cached,
            )

        if cached is not None:
            retry_at = (
                cached.checked_at
                + timedelta(
                    hours=(
                        settings
                        .lrclib_not_found_retry_hours
                    ),
                )
            )

            now = datetime.now(
                UTC,
            )

            cache_is_from_this_run = (
                cached.checked_at
                >= LYRICS_NEGATIVE_CACHE_EPOCH
            )

            if (
                cache_is_from_this_run
                and retry_at > now
            ):
                return _lyrics_response(
                    cached,
                )

        try:
            fetched = (
                await fetch_lrclib_lyrics(
                    title=track.title,
                    artist=track.artist,
                    album=track.album,
                    duration_seconds=(
                        track.duration_seconds
                    ),
                )
            )

        except LrclibRateLimitedError as exc:
            raise HTTPException(
                status_code=503,
                detail=(
                    "Lyrics service is "
                    "temporarily rate limited."
                ),
                headers={
                    "Retry-After": str(
                        exc.retry_after,
                    ),
                },
            ) from exc

        except LrclibUnavailableError as exc:
            raise HTTPException(
                status_code=503,
                detail=(
                    "Lyrics service is "
                    "temporarily unavailable."
                ),
            ) from exc

        if cached is None:
            lyrics_row = TrackLyrics(
                track_id=track.id,
            )

            session.add(
                lyrics_row,
            )
        else:
            lyrics_row = cached

        lyrics_row.checked_at = (
            datetime.now(
                UTC,
            )
        )

        if fetched is None:
            lyrics_row.lrclib_id = None
            lyrics_row.instrumental = False
            lyrics_row.plain_lyrics = None
            lyrics_row.synced_lyrics = None

        else:
            lyrics_row.lrclib_id = (
                fetched["id"]
            )

            lyrics_row.instrumental = (
                fetched[
                    "instrumental"
                ]
            )

            if lyrics_row.instrumental:
                lyrics_row.plain_lyrics = (
                    None
                )

                lyrics_row.synced_lyrics = (
                    None
                )

            elif fetched[
                "synced_lyrics"
            ]:
                lyrics_row.plain_lyrics = (
                    None
                )

                lyrics_row.synced_lyrics = (
                    fetched[
                        "synced_lyrics"
                    ]
                )

            else:
                lyrics_row.plain_lyrics = (
                    fetched[
                        "plain_lyrics"
                    ]
                )

                lyrics_row.synced_lyrics = (
                    None
                )

        await session.commit()

        return _lyrics_response(
            lyrics_row,
        )

        await session.commit()

        return _lyrics_response(
            lyrics_row,
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
                "Cache-Control": (
                    f"public, max-age={cache_seconds}, stale-while-revalidate={cache_seconds * 2}"
                ),
                "Vary": "Origin",
            },
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Artwork unavailable: {str(exc)}",
        ) from exc
