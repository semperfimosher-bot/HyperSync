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
    semaphore = asyncio.Semaphore(
        max(
            1,
            min(
                int(
                    concurrency,
                ),
                16,
            ),
        )
    )

    missing_audio: list[dict[str, str]] = []
    missing_artwork: list[dict[str, str]] = []
    errors: list[dict[str, str]] = []

    async def check_object(
        track: Track,
        *,
        object_key: str,
        kind: str,
    ) -> None:
        try:
            async with semaphore:
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

    tasks = []

    for track in tracks:
        tasks.append(
            check_object(
                track,
                object_key=(
                    track.b2_object_key
                ),
                kind="audio",
            )
        )

        if track.artwork_object_key:
            tasks.append(
                check_object(
                    track,
                    object_key=(
                        track.artwork_object_key
                    ),
                    kind="artwork",
                )
            )

    if tasks:
        await asyncio.gather(
            *tasks,
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
            len(
                tasks,
            ),
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
