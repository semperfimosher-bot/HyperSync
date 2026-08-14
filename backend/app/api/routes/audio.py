from collections.abc import Iterator
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Response
from sqlalchemy import select

from ...database import get_session_factory
from ...models.media import Track
from ...services.b2 import get_b2_bucket

router = APIRouter(
    prefix="/audio",
    tags=["audio"],
)


DEFAULT_CHUNK_SIZE = 1024 * 1024


def parse_range(
    range_header: str | None,
    file_size: int,
) -> tuple[int, int]:
    if not range_header:
        return 0, file_size - 1

    if not range_header.startswith("bytes="):
        raise HTTPException(
            status_code=416,
            detail="Invalid range header.",
        )

    value = range_header.removeprefix("bytes=")

    if "," in value:
        raise HTTPException(
            status_code=416,
            detail="Multiple ranges are not supported.",
        )

    start_text, end_text = value.split("-", 1)

    if not start_text:
        suffix_length = int(end_text)

        if suffix_length <= 0:
            raise HTTPException(
                status_code=416,
                detail="Invalid range.",
            )

        start = max(
            file_size - suffix_length,
            0,
        )
        end = file_size - 1

    else:
        start = int(start_text)

        if start >= file_size:
            raise HTTPException(
                status_code=416,
                detail="Range is outside the file.",
            )

        if end_text:
            end = min(
                int(end_text),
                file_size - 1,
            )
        else:
            end = file_size - 1

    if start > end:
        raise HTTPException(
            status_code=416,
            detail="Invalid range.",
        )

    return start, end


@router.get("/{track_id}")
async def stream_audio(
    track_id: UUID,
    range: str | None = Header(default=None),
):
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

    bucket = get_b2_bucket()

    file_info = bucket.get_file_info_by_name(
        track.b2_object_key,
    )

    file_size = file_info.size

    start, end = parse_range(
        range,
        file_size,
    )

    downloaded = bucket.download_file_by_name(
        track.b2_object_key,
        range_=(start, end),
    )

    response_headers = {
        "Accept-Ranges": "bytes",
        "Content-Length": str(end - start + 1),
        "Content-Type": track.mime_type,
        "Cache-Control": ("public, max-age=86400, stale-while-revalidate=604800"),
        "Content-Disposition": (f'inline; filename="{track.title}.mp3"'),
    }

    if range:
        response_headers["Content-Range"] = f"bytes {start}-{end}/{file_size}"

    async def body() -> Iterator[bytes]:
        yield downloaded.get_bytes_read()

    status_code = 206 if range else 200

    return Response(
        content=downloaded.get_bytes_read(),
        status_code=status_code,
        headers=response_headers,
        media_type=track.mime_type,
    )
