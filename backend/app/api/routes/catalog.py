import asyncio
import base64
import binascii
import hashlib
import json
import logging
import mimetypes
import tempfile
import time
from collections.abc import Sequence
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
from pydantic import BaseModel
from sqlalchemy import or_, select

from ...config import get_settings
from ...database import get_session_factory
from ...models.media import (
    Track,
    TrackLyrics,
)
from ...services.b2 import (
    create_presigned_download_url,
    get_b2_bucket,
)
from ...services.disk_response import DiskJSONResponse
from ...services.lrclib import (
    LrclibRateLimitedError,
    LrclibUnavailableError,
    fetch_lrclib_lyrics,
)
from ...services.thread_work import run_blocking, run_blocking_resource
from .audio import B2StreamingResponse, close_b2_download

router = APIRouter(
    prefix="/catalog",
    tags=["catalog"],
)

logger = logging.getLogger(
    __name__,
)

LYRICS_NEGATIVE_CACHE_EPOCH = datetime.now(
    UTC,
)
LYRICS_PROVIDER_COOLDOWN_SECONDS = 15.0
_lyrics_provider_cooldown_until: dict[UUID, float] = {}
LYRICS_COOLDOWN_MAX_ENTRIES = 1024


def _set_lyrics_cooldown(track_id: UUID, seconds: float) -> None:
    now = time.monotonic()
    for key, expires in list(_lyrics_provider_cooldown_until.items()):
        if expires <= now:
            _lyrics_provider_cooldown_until.pop(key, None)
    _lyrics_provider_cooldown_until[track_id] = now + seconds
    while len(_lyrics_provider_cooldown_until) > LYRICS_COOLDOWN_MAX_ENTRIES:
        _lyrics_provider_cooldown_until.pop(next(iter(_lyrics_provider_cooldown_until)))


class TrackResponse(BaseModel):
    id: UUID
    title: str
    artist: str
    album: str | None
    genre: str | None = None
    release_year: int | None = None
    duration_seconds: int | None
    audio_url: str | None = None
    artwork_url: str | None = None
    mime_type: str | None = None
    file_size: int | None = None
    media_version: str | None = None
    artwork_version: str | None = None


def _presigned_or_fallback(
    object_key: str,
    fallback_url: str,
) -> str:
    try:
        return create_presigned_download_url(
            object_key,
        )

    except Exception:
        logger.exception(
            ("Unable to create presigned media URL for %s; using API fallback."),
            object_key,
        )

        return fallback_url


def _track_audio_url(
    track: Track,
) -> str | None:
    if not track.b2_object_key:
        return None

    if track.b2_object_key.startswith(
        (
            "http://",
            "https://",
        ),
    ):
        return track.b2_object_key

    settings = get_settings()

    if settings.environment != "production":
        return f"/api/audio/{track.id}"

    return _presigned_or_fallback(
        track.b2_object_key,
        f"/api/audio/{track.id}",
    )


def _track_artwork_url(
    track: Track,
) -> str | None:
    if not track.artwork_object_key:
        return None

    if track.artwork_object_key.startswith(
        (
            "http://",
            "https://",
        ),
    ):
        return track.artwork_object_key

    settings = get_settings()

    if settings.environment != "production":
        return f"/api/catalog/tracks/{track.id}/artwork"

    return _presigned_or_fallback(
        track.artwork_object_key,
        (f"/api/catalog/tracks/{track.id}/artwork"),
    )


def _track_media_version(
    track: Track,
) -> str | None:
    if not track.b2_object_key:
        return None

    return hashlib.sha256(
        track.b2_object_key.encode(
            "utf-8",
        ),
    ).hexdigest()


def _track_artwork_version(
    track: Track,
) -> str | None:
    if not track.artwork_object_key:
        return None

    return hashlib.sha256(
        track.artwork_object_key.encode(
            "utf-8",
        ),
    ).hexdigest()


class CatalogPageResponse(BaseModel):
    items: list[TrackResponse]
    next_cursor: str | None = None


def _catalog_cursor(last_id: UUID, highwater: UUID, query: str) -> str:
    payload = json.dumps(
        [
            1,
            str(last_id),
            str(highwater),
            hashlib.sha256(query.encode("utf-8")).hexdigest(),
        ]
    ).encode("utf-8")
    return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def _decode_catalog_cursor(cursor: str, query: str) -> tuple[UUID, UUID]:
    try:
        payload = json.loads(
            base64.b64decode(
                cursor + "=" * (-len(cursor) % 4),
                altchars=b"-_",
                validate=True,
            )
        )
        if not isinstance(payload, list) or len(payload) != 4:
            raise ValueError("Invalid cursor payload")
        version, last, highwater, query_hash = payload
        if not isinstance(last, str) or not isinstance(highwater, str):
            raise ValueError("Invalid cursor IDs")
        last_id, highwater_id = UUID(last), UUID(highwater)
        if (
            version != 1
            or last_id > highwater_id
            or query_hash != hashlib.sha256(query.encode("utf-8")).hexdigest()
        ):
            raise ValueError("Cursor does not match query")
        return last_id, highwater_id
    except (ValueError, TypeError, binascii.Error, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=400, detail="Invalid catalog cursor.") from exc


@router.get(
    "/tracks",
    response_model=list[TrackResponse] | CatalogPageResponse,
)
async def list_tracks(
    response: Response,
    q: str | None = Query(
        default=None,
        description="Search by title, artist, album, or genre",
    ),
    page_size: int | None = Query(default=None, ge=1, le=500),
    cursor: str | None = Query(default=None, max_length=1024),
) -> list[TrackResponse] | CatalogPageResponse | DiskJSONResponse:

    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"

    response.headers["Pragma"] = "no-cache"

    response.headers["Expires"] = "0"

    query = (q or "").strip()
    paged = page_size is not None or cursor is not None
    if not paged:
        return await _legacy_catalog_response(query, dict(response.headers))
    limit = page_size or 250
    bounds = _decode_catalog_cursor(cursor, query) if cursor is not None else None
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
                    Track.genre.ilike(term),
                )
            )

        highwater = None
        if paged:
            if bounds is None:
                # A UUID upper bound keeps new high-ID inserts from extending the
                # walk indefinitely. This is keyset traversal, not an MVCC snapshot;
                # uploads behind the cursor become visible on the next refresh.
                highwater = await session.scalar(
                    stmt.with_only_columns(Track.id).order_by(Track.id.desc()).limit(1)
                )
                if highwater is None:
                    return CatalogPageResponse(items=[])
            else:
                last_id, highwater = bounds
                stmt = stmt.where(Track.id > last_id)
            if highwater is not None:
                stmt = stmt.where(Track.id <= highwater)
            stmt = stmt.order_by(Track.id).limit(limit + 1)
        else:
            stmt = stmt.order_by(Track.artist, Track.title, Track.id)
        result = await session.execute(stmt)
        tracks = result.scalars().all()
        has_more = paged and len(tracks) > limit
        if paged:
            tracks = tracks[:limit]

    # Presigning may initialize the synchronous B2 SDK. Keep this bounded
    # page's URL work off the event loop (legacy clients still get all rows).
    items = await asyncio.to_thread(_catalog_track_responses, tracks)
    if not paged:
        return items
    next_cursor = (
        _catalog_cursor(tracks[-1].id, highwater, query)
        if has_more and highwater is not None
        else None
    )
    return CatalogPageResponse(items=items, next_cursor=next_cursor)


async def _legacy_catalog_response(query: str, headers: dict[str, str]) -> DiskJSONResponse:
    """Keep the old sorted array contract using disk rather than a full ORM/JSON list.

    Finish all database/presigning work before response headers. Slow clients
    consume only a disk stream, never a database connection or whole catalog RAM.
    """
    source = tempfile.TemporaryFile(mode="w+b")
    try:
        await run_blocking(source.write, b"[")
        first = True
        async with get_session_factory()() as session:
            stmt = select(Track).where(Track.is_published.is_(True))
            if query:
                term = f"%{query}%"
                stmt = stmt.where(or_(
                    Track.title.ilike(term), Track.artist.ilike(term),
                    Track.album.ilike(term), Track.genre.ilike(term),
                ))
            stmt = stmt.order_by(Track.artist, Track.title, Track.id)
            result = await session.stream(stmt.execution_options(yield_per=250))
            try:
                async for tracks in result.scalars().partitions(250):
                    def encode_page(tracks=tracks, first=first):
                        items = _catalog_track_responses(tracks)
                        return (b"" if first else b",") + b",".join(
                            item.model_dump_json().encode("utf-8") for item in items
                        )
                    encoded = await run_blocking(encode_page)
                    if tracks:
                        await run_blocking(source.write, encoded)
                        first = False
            finally:
                await result.close()
        await run_blocking(source.write, b"]")
        return DiskJSONResponse(source, headers=headers)
    except BaseException:
        await run_blocking(source.close)
        raise


def _catalog_track_responses(tracks: Sequence[Track]) -> list[TrackResponse]:
    return [
        TrackResponse(
            id=track.id,
            title=track.title,
            artist=track.artist,
            album=track.album,
            genre=getattr(track, "genre", None),
            release_year=getattr(track, "release_year", None),
            duration_seconds=track.duration_seconds,
            mime_type=track.mime_type,
            file_size=track.file_size,
            media_version=_track_media_version(track),
            artwork_version=_track_artwork_version(track),
            audio_url=_track_audio_url(track),
            artwork_url=_track_artwork_url(track),
        )
        for track in tracks
    ]


@router.get(
    "/tracks/{track_id}",
    response_model=TrackResponse,
)
async def get_track(
    track_id: UUID,
) -> TrackResponse:
    session_factory = get_session_factory()

    async with session_factory() as session:
        result = await session.execute(
            select(Track).where(
                Track.id == track_id,
                Track.is_published.is_(
                    True,
                ),
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
        duration_seconds=(track.duration_seconds),
        mime_type=(track.mime_type),
        file_size=(track.file_size),
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

    source: Literal["lrclib"] = "lrclib"

    lrclib_id: int | None = None

    instrumental: bool = False

    plain_lyrics: str | None = None

    synced_lyrics: str | None = None


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


def _utc_datetime(
    value: datetime,
) -> datetime:
    if value.tzinfo is None:
        return value.replace(
            tzinfo=UTC,
        )

    return value.astimezone(
        UTC,
    )


def _lyrics_response(
    lyrics: TrackLyrics,
) -> TrackLyricsResponse:
    return TrackLyricsResponse(
        status=_lyrics_status(
            lyrics,
        ),
        lrclib_id=(lyrics.lrclib_id),
        instrumental=(lyrics.instrumental),
        plain_lyrics=(lyrics.plain_lyrics),
        synced_lyrics=(lyrics.synced_lyrics),
    )


@router.get(
    "/tracks/{track_id}/lyrics",
    response_model=TrackLyricsResponse,
)
async def get_track_lyrics(
    track_id: UUID,
    response: Response,
) -> TrackLyricsResponse:
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"

    settings = get_settings()

    session_factory = get_session_factory()

    async with session_factory() as session:
        result = await session.execute(
            select(Track).where(
                Track.id == track_id,
                Track.is_published.is_(
                    True,
                ),
            ),
        )

        track = result.scalar_one_or_none()

        if track is None:
            raise HTTPException(
                status_code=404,
                detail="Track not found.",
            )

        cached = await session.get(
            TrackLyrics,
            track.id,
        )

        if cached is not None and cached.lrclib_id is not None:
            return _lyrics_response(
                cached,
            )

        if cached is not None:
            checked_at = _utc_datetime(
                cached.checked_at,
            )

            retry_at = checked_at + timedelta(
                hours=(settings.lrclib_not_found_retry_hours),
            )

            now = datetime.now(
                UTC,
            )

            cache_is_from_this_run = (
                checked_at
                >= LYRICS_NEGATIVE_CACHE_EPOCH
            )

            if cache_is_from_this_run and retry_at > now:
                return _lyrics_response(
                    cached,
                )

        cooldown_until = _lyrics_provider_cooldown_until.get(track.id)
        if cooldown_until is not None:
            if cooldown_until > time.monotonic():
                return TrackLyricsResponse(
                    status="not_found",
                )
            _lyrics_provider_cooldown_until.pop(track.id, None)

        try:
            fetched = await fetch_lrclib_lyrics(
                title=track.title,
                artist=track.artist,
                album=track.album,
                duration_seconds=(track.duration_seconds),
            )

        except LrclibRateLimitedError as exc:
            cooldown = min(
                max(float(exc.retry_after), LYRICS_PROVIDER_COOLDOWN_SECONDS),
                60.0,
            )
            _set_lyrics_cooldown(track.id, cooldown)
            logger.debug(
                "LRCLIB rate limited lyrics lookup for track %s; retrying after cooldown.",
                track.id,
            )
            return TrackLyricsResponse(
                status="not_found",
            )

        except LrclibUnavailableError:
            _set_lyrics_cooldown(track.id, LYRICS_PROVIDER_COOLDOWN_SECONDS)
            logger.debug(
                "LRCLIB temporarily unavailable for track %s; serving a graceful empty result.",
                track.id,
            )
            return TrackLyricsResponse(
                status="not_found",
            )

        if cached is None:
            lyrics_row = TrackLyrics(
                track_id=track.id,
            )

            session.add(
                lyrics_row,
            )
        else:
            lyrics_row = cached

        lyrics_row.checked_at = datetime.now(
            UTC,
        )

        if fetched is None:
            lyrics_row.lrclib_id = None
            lyrics_row.instrumental = False
            lyrics_row.plain_lyrics = None
            lyrics_row.synced_lyrics = None

        else:
            lyrics_row.lrclib_id = fetched["id"]

            lyrics_row.instrumental = fetched["instrumental"]

            if lyrics_row.instrumental:
                lyrics_row.plain_lyrics = None

                lyrics_row.synced_lyrics = None

            elif fetched["synced_lyrics"]:
                lyrics_row.plain_lyrics = None

                lyrics_row.synced_lyrics = fetched["synced_lyrics"]

            else:
                lyrics_row.plain_lyrics = fetched["plain_lyrics"]

                lyrics_row.synced_lyrics = None

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
        bucket = await run_blocking(get_b2_bucket)
        downloaded = await run_blocking_resource(
            bucket.download_file_by_name,
            close_b2_download,
            object_key,
        )
        content_type, _ = mimetypes.guess_type(object_key)
        if not content_type:
            content_type = "image/jpeg"

        cache_seconds = max(settings.b2_presigned_url_ttl_seconds, 300)
        return B2StreamingResponse(
            downloaded,
            media_type=content_type,
            headers={
                "Cache-Control": (
                    f"public, max-age={cache_seconds}, stale-while-revalidate={cache_seconds * 2}"
                ),
                "Vary": "Origin",
            },
        )
    except Exception as exc:
        logger.exception("Unable to retrieve catalog artwork from storage.")
        raise HTTPException(
            status_code=500,
            detail="Artwork is temporarily unavailable. Please retry later.",
        ) from exc
