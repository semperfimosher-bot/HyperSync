from __future__ import annotations

import asyncio
from typing import Any

from botocore.exceptions import (
    ClientError,
)

from ..models.media import Track
from .b2 import head_b2_object

_MISSING_CODES = {
    "404",
    "NoSuchKey",
    "NotFound",
}


def _missing_b2_error(
    error: ClientError,
) -> bool:
    response = getattr(
        error,
        "response",
        {},
    )

    code = str(
        (
            response.get(
                "Error",
                {},
            )
            or {}
        ).get(
            "Code",
            "",
        )
    )

    status = (
        response.get(
            "ResponseMetadata",
            {},
        )
        or {}
    ).get(
        "HTTPStatusCode",
    )

    return (
        code in _MISSING_CODES
        or status == 404
    )


async def audit_track_storage(
    tracks: list[Track],
    *,
    concurrency: int = 8,
) -> dict[str, Any]:
    worker_count = max(
        1,
        min(
            int(
                concurrency,
            ),
            16,
        ),
    )

    missing_audio: list[dict[str, str]] = []
    missing_artwork: list[dict[str, str]] = []
    errors: list[dict[str, str]] = []

    jobs: asyncio.Queue[
        tuple[
            Track,
            str,
            str,
        ]
    ] = asyncio.Queue()

    for track in tracks:
        jobs.put_nowait(
            (
                track,
                track.b2_object_key,
                "audio",
            )
        )

        if track.artwork_object_key:
            jobs.put_nowait(
                (
                    track,
                    track.artwork_object_key,
                    "artwork",
                )
            )

    objects_checked = jobs.qsize()

    async def check_object(
        track: Track,
        *,
        object_key: str,
        kind: str,
    ) -> None:
        try:
            await asyncio.to_thread(
                head_b2_object,
                object_key,
            )

        except ClientError as exc:
            if _missing_b2_error(
                exc,
            ):
                target = (
                    missing_audio
                    if kind == "audio"
                    else missing_artwork
                )

                target.append(
                    {
                        "track_id":
                            str(
                                track.id,
                            ),
                        "title":
                            track.title,
                        "artist":
                            track.artist,
                        "object_key":
                            object_key,
                    }
                )
                return

            errors.append(
                {
                    "track_id":
                        str(
                            track.id,
                        ),
                    "kind":
                        kind,
                    "object_key":
                        object_key,
                    "error":
                        str(
                            exc,
                        )[:240],
                }
            )

        except Exception as exc:
            errors.append(
                {
                    "track_id":
                        str(
                            track.id,
                        ),
                    "kind":
                        kind,
                    "object_key":
                        object_key,
                    "error":
                        str(
                            exc,
                        )[:240],
                }
            )

    async def worker() -> None:
        while True:
            try:
                (
                    track,
                    object_key,
                    kind,
                ) = jobs.get_nowait()
            except asyncio.QueueEmpty:
                return

            try:
                await check_object(
                    track,
                    object_key=object_key,
                    kind=kind,
                )
            finally:
                jobs.task_done()

    workers = [
        asyncio.create_task(
            worker(),
        )
        for _index in range(
            min(
                worker_count,
                max(
                    objects_checked,
                    1,
                ),
            )
        )
    ]

    if workers:
        await asyncio.gather(
            *workers,
        )

    return {
        "healthy": (
            not missing_audio
            and not missing_artwork
            and not errors
        ),
        "tracks_checked":
            len(
                tracks,
            ),
        "objects_checked":
            objects_checked,
        "missing_audio_count":
            len(
                missing_audio,
            ),
        "missing_artwork_count":
            len(
                missing_artwork,
            ),
        "error_count":
            len(
                errors,
            ),
        "missing_audio":
            missing_audio[
                :50
            ],
        "missing_artwork":
            missing_artwork[
                :50
            ],
        "errors":
            errors[
                :50
            ],
    }
