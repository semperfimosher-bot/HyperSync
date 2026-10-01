import asyncio
import os
import threading
import unicodedata
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, status
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
# Each active B2 stream needs a dedicated blocking writer thread in addition
# to an async request. Bound this independently of the DB pool so a burst of
# long-lived media requests cannot create an unbounded number of OS threads.
_b2_stream_slots: threading.BoundedSemaphore | None = None
_b2_stream_slots_lock = threading.Lock()


def _get_b2_stream_slots() -> threading.BoundedSemaphore:
    global _b2_stream_slots
    with _b2_stream_slots_lock:
        if _b2_stream_slots is None:
            limit = min(max(1, int(get_settings().audio_stream_max_concurrency)), 64)
            _b2_stream_slots = threading.BoundedSemaphore(limit)
        return _b2_stream_slots


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


def safe_filename(
    title: str,
) -> str:
    filename = title.strip()

    if not filename:
        filename = "audio"

    filename = filename.replace(
        "\\",
        "_",
    )

    filename = filename.replace(
        "/",
        "_",
    )

    filename = filename.replace(
        '"',
        "_",
    )

    filename = filename.replace(
        "\r",
        "_",
    )

    filename = filename.replace(
        "\n",
        "_",
    )

    filename = (
        unicodedata.normalize(
            "NFKD",
            filename,
        )
        .encode(
            "ascii",
            "ignore",
        )
        .decode(
            "ascii",
        )
        .strip()
    )

    if not filename:
        filename = "audio"

    return f"{filename}.mp3"


async def stream_b2_file(downloaded):
    """Prepare a bounded B2 stream before response headers are sent.

    The SDK's ``save`` call blocks, so each live stream requires a writer
    thread. Acquire capacity before returning the response to let the route
    return a retryable 503 instead of starting unlimited threads.
    """
    slots = _get_b2_stream_slots()
    if not slots.acquire(blocking=False):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Audio streaming capacity is busy. Please retry shortly.",
            headers={"Retry-After": "2"},
        )

    read_fd = write_fd = None
    thread = None
    error: list[BaseException] = []

    try:
        read_fd, write_fd = os.pipe()
        reader_descriptor = read_fd
        writer_descriptor = write_fd

        def download() -> None:
            try:
                with os.fdopen(writer_descriptor, "wb", buffering=0) as output:
                    downloaded.save(output, allow_seeking=False)
            except BaseException as exc:
                error.append(exc)
                # fdopen's context manager owns and closes the descriptor,
                # including when save() raises. Closing it again here could
                # close a different request's descriptor after OS reuse.
            finally:
                # A slot tracks the dedicated OS writer, not how quickly a
                # client drains bytes already buffered in the pipe.
                slots.release()

        thread = threading.Thread(target=download, daemon=True)
        thread.start()
    except BaseException:
        for descriptor in (read_fd, write_fd):
            if descriptor is not None:
                try:
                    os.close(descriptor)
                except OSError:
                    pass
        slots.release()
        raise

    assert read_fd is not None
    assert thread is not None

    async def body():
        try:
            while True:
                chunk = await asyncio.to_thread(
                    os.read,
                    reader_descriptor,
                    STREAM_CHUNK_SIZE,
                )
                if not chunk:
                    break
                yield chunk

            await asyncio.to_thread(thread.join)
            if error:
                raise error[0]
        finally:
            try:
                os.close(reader_descriptor)
            except OSError:
                pass
            # Closing the reader releases a writer blocked on a disconnected
            # client. Bound request cleanup if the upstream SDK is still
            # waiting on its own network timeout; its slot remains held until
            # the writer exits.
            await asyncio.to_thread(thread.join, 5)

    return body()


def resolve_local_audio_fallback(
    object_key: str,
) -> Path | None:
    settings = get_settings()

    if settings.environment == "production":
        return None

    raw_path = Path(
        object_key,
    )

    if (
        raw_path.is_absolute()
        or ".." in raw_path.parts
    ):
        return None

    candidate = raw_path.resolve()

    demo_path = Path(
        settings.demo_audio_path,
    ).resolve()

    allowed_roots = [
        Path(
            settings.local_upload_root,
        ).resolve(),
        demo_path.parent,
    ]

    try:
        allowed = any(
            candidate.is_relative_to(
                root,
            )
            for root
            in allowed_roots
        )
    except ValueError:
        allowed = False

    if (
        allowed
        and candidate.exists()
        and candidate.is_file()
    ):
        return candidate

    return None


async def stream_local_file(
    file_path: Path,
    start: int,
    end: int,
):
    with file_path.open("rb") as source:
        source.seek(start)

        remaining = end - start + 1

        while remaining > 0:
            chunk = source.read(
                min(
                    STREAM_CHUNK_SIZE,
                    remaining,
                )
            )

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
        body = await stream_b2_file(downloaded)

    except HTTPException:
        raise

    except Exception as storage_error:
        fallback_file = (
            resolve_local_audio_fallback(
                track.b2_object_key,
            )
        )

        if fallback_file is None:
            raise HTTPException(
                status_code=(
                    status.HTTP_503_SERVICE_UNAVAILABLE
                ),
                detail=(
                    "Audio storage is temporarily unavailable."
                ),
                headers={
                    "Retry-After":
                        "2",
                },
            ) from storage_error

        file_size = (
            fallback_file.stat().st_size
        )

        start, end = parse_range(
            range,
            file_size,
        )

        body = stream_local_file(
            fallback_file,
            start,
            end,
        )

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
