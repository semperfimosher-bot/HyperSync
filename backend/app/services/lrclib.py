from __future__ import annotations

import math
import time
from typing import TypedDict

import httpx

from ..config import get_settings


class LrclibLyrics(
    TypedDict,
):
    id: int
    instrumental: bool
    plain_lyrics: str | None
    synced_lyrics: str | None


class LrclibRateLimitedError(
    RuntimeError,
):
    def __init__(
        self,
        retry_after: int,
    ) -> None:
        self.retry_after = (
            retry_after
        )

        super().__init__(
            "LRCLIB rate limited "
            "the request.",
        )


class LrclibUnavailableError(
    RuntimeError,
):
    pass


_blocked_until = 0.0


def _retry_after_seconds(
    value: str | None,
) -> int:
    if not value:
        return 60

    try:
        return max(
            int(float(value)),
            1,
        )
    except ValueError:
        return 60


async def fetch_lrclib_lyrics(
    *,
    title: str,
    artist: str,
    album: str | None,
    duration_seconds: int | None,
) -> LrclibLyrics | None:
    global _blocked_until

    remaining = (
        _blocked_until
        - time.monotonic()
    )

    if remaining > 0:
        raise LrclibRateLimitedError(
            math.ceil(
                remaining,
            ),
        )

    settings = get_settings()

    params: dict[
        str,
        str | int,
    ] = {
        "track_name": title,
        "artist_name": artist,
    }

    if album:
        params["album_name"] = (
            album
        )

    if (
        duration_seconds is not None
        and duration_seconds > 0
    ):
        params["duration"] = (
            duration_seconds
        )

    base_url = (
        settings
        .lrclib_base_url
        .rstrip("/")
    )

    try:
        async with httpx.AsyncClient(
            base_url=base_url,
            headers={
                "User-Agent": (
                    settings
                    .lrclib_client_name
                ),
            },
            timeout=10.0,
        ) as client:
            response = (
                await client.get(
                    "/api/get",
                    params=params,
                )
            )

    except httpx.HTTPError as exc:
        raise LrclibUnavailableError(
            "Unable to reach LRCLIB.",
        ) from exc

    if response.status_code == 404:
        return None

    if response.status_code == 429:
        retry_after = (
            _retry_after_seconds(
                response.headers.get(
                    "Retry-After",
                ),
            )
        )

        _blocked_until = (
            time.monotonic()
            + retry_after
        )

        raise LrclibRateLimitedError(
            retry_after,
        )

    try:
        response.raise_for_status()

        payload = response.json()

        return {
            "id": int(
                payload["id"],
            ),
            "instrumental": bool(
                payload.get(
                    "instrumental",
                    False,
                ),
            ),
            "plain_lyrics": (
                payload.get(
                    "plainLyrics",
                )
                or None
            ),
            "synced_lyrics": (
                payload.get(
                    "syncedLyrics",
                )
                or None
            ),
        }

    except (
        KeyError,
        TypeError,
        ValueError,
        httpx.HTTPStatusError,
    ) as exc:
        raise LrclibUnavailableError(
            "LRCLIB returned an "
            "invalid response.",
        ) from exc
    