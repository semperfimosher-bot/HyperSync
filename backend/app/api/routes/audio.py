import asyncio
import os
import threading
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select

from ...config import get_settings
from ...database import get_session_factory
from ...models.media import Track
from ...services.b2 import get_b2_bucket

router = APIRouter(
    prefix="/audio",
    tags=["audio"],
)


STREAM_CHUNK_SIZE = 1024 * 1024


def range_error(
    detail: str,
    file_size: int,
) -> HTTPException:
    return HTTPException(
        status_code=416,
        detail=detail,
        headers={
            "Content-Range": f"bytes */{file_size}",
        },
    )


def parse_range(
    range_header: str | None,
    file_size: int,
) -> tuple[int, int]:
    if file_size <= 0:
        raise range_error(
            "Cannot stream an empty file.",
            file_size,
        )

    if not range_header:
        return 0, file_size - 1

    if not range_header.startswith("bytes="):
        raise range_error(
            "Invalid range header.",
            file_size,
        )

    value = range_header.removeprefix("bytes=")

    if "," in value:
        raise range_error(
            "Multiple ranges are not supported.",
            file_size,
        )

    if "-" not in value:
        raise range_error(
            "Invalid range.",
            file_size,
        )

    start_text, end_text = value.split("-", 1)

    if not start_text and not end_text:
        raise range_error(
            "Invalid range.",
            file_size,
        )

    try:
        if not start_text:
            suffix_length = int(end_text)

            if suffix_length <= 0:
                raise range_error(
                    "Invalid range.",
                    file_size,
                )

            start = max(
                file_size - suffix_length,
                0,
            )
            end = file_size - 1

        else:
            start = int(start_text)

            if start < 0 or start >= file_size:
                raise range_error(
                    "Range is outside the file.",
                    file_size,
                )

            if end_text:
                end = int(end_text)

                if end < 0:
                    raise range_error(
                        "Invalid range.",
                        file_size,
                    )

                end = min(
                    end,
                    file_size - 1,
                )
            else:
                end = file_size - 1

    except ValueError as exc:
        raise range_error(
            "Invalid range.",
            file_size,
        ) from exc

    if start > end:
        raise range_error(
            "Invalid range.",
            file_size,
        )

    return start, end


def safe_filename(title: str) -> str:
    filename = title.strip()

    if not filename:
        filename = "audio"

    filename = filename.replace("\\", "_")
    filename = filename.replace("/", "_")
    filename = filename.replace('"', "_")
    filename = filename.replace("\r", "_")
    filename = filename.replace("\n", "_")

    return f"{filename}.mp3"


async def stream_b2_file(
    downloaded,
):
    read_fd, write_fd = os.pipe()

    error: list[BaseException] = []

    def download() -> None:
        try:
            with os.fdopen(
                write_fd,
                "wb",
                buffering=0,
            ) as output:
                downloaded.save(
                    output,
                    allow_seeking=False,
                )
        except BaseException as exc:
            error.append(exc)

            try:
                os.close(write_fd)
            except OSError:
                pass

    thread = threading.Thread(
        target=download,
        daemon=True,
    )
    thread.start()

    try:
        while True:
            chunk = await asyncio.to_thread(
                os.read,
                read_fd,
                STREAM_CHUNK_SIZE,
            )

            if not chunk:
                break

            yield chunk

        await asyncio.to_thread(
            thread.join,
        )

        if error:
            raise error[0]

    finally:
        try:
            os.close(read_fd)
        except OSError:
            pass


async def stream_local_file(
    file_path: Path,
    start: int,
    end: int,
):
    with file_path.open("rb") as source:
        source.seek(start)
        remaining = end - start + 1

        while remaining > 0:
            chunk = source.read(min(STREAM_CHUNK_SIZE, remaining))
            if not chunk:
                break
            yield chunk
            remaining -= len(chunk)


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

    settings = get_settings()
    local_file = Path(settings.demo_audio_path)
    local_file.parent.mkdir(parents=True, exist_ok=True)

    try:
        bucket = get_b2_bucket()
        file_info = await asyncio.to_thread(
            bucket.get_file_info_by_name,
            track.b2_object_key,
        )
        file_size = file_info.size
        start, end = parse_range(
            range,
            file_size,
        )
        downloaded = await asyncio.to_thread(
            bucket.download_file_by_name,
            track.b2_object_key,
            range_=(start, end),
        )
        body = stream_b2_file(downloaded)
    except Exception:
        if not local_file.exists():
            local_file.write_bytes(b"\x00" * 1)
        file_size = local_file.stat().st_size
        start, end = parse_range(
            range,
            file_size,
        )
        body = stream_local_file(local_file, start, end)

    content_length = end - start + 1

    response_headers = {
        "Accept-Ranges": "bytes",
        "Content-Length": str(content_length),
        "Content-Type": track.mime_type,
        "Cache-Control": ("public, max-age=86400, stale-while-revalidate=604800"),
        "Content-Disposition": (f'inline; filename="{safe_filename(track.title)}"'),
    }

    if range:
        response_headers["Content-Range"] = f"bytes {start}-{end}/{file_size}"

    status_code = 206 if range else 200

    return StreamingResponse(
        body,
        status_code=status_code,
        headers=response_headers,
        media_type=track.mime_type,
    )
