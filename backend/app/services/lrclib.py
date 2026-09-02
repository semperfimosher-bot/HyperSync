from __future__ import annotations

import math
import re
import time
import unicodedata
from typing import TypedDict

import httpx

from ..config import get_settings


class LrclibLyrics(TypedDict):
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
        self.retry_after = retry_after

        super().__init__(
            "LRCLIB rate limited the request.",
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


def _normalize_text(
    value: object,
) -> str:
    if not isinstance(
        value,
        str,
    ):
        return ""

    normalized = unicodedata.normalize(
        "NFKC",
        value,
    ).casefold()

    words = re.findall(
        r"\w+",
        normalized,
    )

    return " ".join(words)


def _duration(
    value: object,
) -> float | None:
    if not isinstance(
        value,
        (
            int,
            float,
            str,
        ),
    ):
        return None

    try:
        result = float(value)
    except ValueError:
        return None

    if not math.isfinite(result):
        return None

    return result


def _optional_text(
    value: object,
) -> str | None:
    if not isinstance(
        value,
        str,
    ):
        return None

    value = value.strip()

    return value or None


def _payload_to_lyrics(
    payload: dict[str, object],
) -> LrclibLyrics:
    raw_id = payload.get(
        "id",
    )

    if not isinstance(
        raw_id,
        (
            int,
            str,
        ),
    ):
        raise LrclibUnavailableError(
            "LRCLIB returned invalid data.",
        )

    try:
        lrclib_id = int(raw_id)
    except ValueError as exc:
        raise LrclibUnavailableError(
            "LRCLIB returned invalid data.",
        ) from exc

    return {
        "id": lrclib_id,
        "instrumental": bool(
            payload.get(
                "instrumental",
                False,
            ),
        ),
        "plain_lyrics": _optional_text(
            payload.get(
                "plainLyrics",
            ),
        ),
        "synced_lyrics": _optional_text(
            payload.get(
                "syncedLyrics",
            ),
        ),
    }


def _choose_search_candidate(
    results: list[dict[str, object]],
    *,
    title: str,
    artist: str,
    album: str | None,
    duration_seconds: int | None,
) -> dict[str, object] | None:
    wanted_title = _normalize_text(
        title,
    )

    wanted_artist = _normalize_text(
        artist,
    )

    wanted_album = _normalize_text(
        album,
    )

    wanted_duration = (
        float(duration_seconds) if (duration_seconds is not None and duration_seconds > 0) else None
    )

    matches: list[
        tuple[
            float,
            int,
            dict[str, object],
        ]
    ] = []

    for candidate in results:
        candidate_title = _normalize_text(
            candidate.get(
                "trackName",
            )
            or candidate.get(
                "name",
            ),
        )

        candidate_artist = _normalize_text(
            candidate.get(
                "artistName",
            ),
        )

        # We only accept the same normalized
        # title and artist. This prevents
        # attaching lyrics from a different song.
        if candidate_title != wanted_title:
            continue

        if candidate_artist != wanted_artist:
            continue

        candidate_duration = _duration(
            candidate.get(
                "duration",
            ),
        )

        if wanted_duration is not None:
            if candidate_duration is None:
                continue

            duration_delta = abs(candidate_duration - wanted_duration)

            # LRCLIB recommends duration for
            # distinguishing different versions.
            #
            # We allow a tiny difference for
            # browser/Mutagen rounding.
            if duration_delta > 3.0:
                continue
        else:
            duration_delta = 0.0

        candidate_album = _normalize_text(
            candidate.get(
                "albumName",
            ),
        )

        # Album is useful as a tie-breaker,
        # but it should not reject an otherwise
        # exact title/artist/duration match.
        album_penalty = 0 if (wanted_album and candidate_album == wanted_album) else 1

        matches.append(
            (
                duration_delta,
                album_penalty,
                candidate,
            ),
        )

    if not matches:
        return None

    matches.sort(
        key=lambda item: (
            item[0],
            item[1],
        ),
    )

    # With a valid duration, the closest
    # safely-matching version wins.
    if wanted_duration is not None:
        return matches[0][2]

    # Without duration, an exact album can
    # disambiguate the result.
    if wanted_album:
        album_matches = [item for item in matches if item[1] == 0]

        if len(album_matches) == 1:
            return album_matches[0][2]

    # If there is exactly one safe candidate,
    # use it even without duration.
    if len(matches) == 1:
        return matches[0][2]

    # Multiple ambiguous recordings and no
    # trustworthy discriminator: don't guess.
    return None


def _handle_rate_limit(
    response: httpx.Response,
) -> None:
    global _blocked_until

    if response.status_code != 429:
        return

    retry_after = _retry_after_seconds(
        response.headers.get(
            "Retry-After",
        ),
    )

    _blocked_until = time.monotonic() + retry_after

    raise LrclibRateLimitedError(
        retry_after,
    )


async def fetch_lrclib_lyrics(
    *,
    title: str,
    artist: str,
    album: str | None,
    duration_seconds: int | None,
) -> LrclibLyrics | None:
    remaining = _blocked_until - time.monotonic()

    if remaining > 0:
        raise LrclibRateLimitedError(
            math.ceil(
                remaining,
            ),
        )

    settings = get_settings()

    exact_params: dict[
        str,
        str | int,
    ] = {
        "track_name": title,
        "artist_name": artist,
    }

    if album:
        exact_params["album_name"] = album

    if duration_seconds is not None and 1 <= duration_seconds <= 3600:
        exact_params["duration"] = duration_seconds

    base_url = settings.lrclib_base_url.rstrip("/")

    try:
        async with httpx.AsyncClient(
            base_url=base_url,
            headers={
                "User-Agent": (settings.lrclib_client_name),
            },
            timeout=10.0,
        ) as client:
            # First try LRCLIB's strict
            # exact metadata endpoint.
            exact_response = await client.get(
                "/api/get",
                params=exact_params,
            )

            _handle_rate_limit(
                exact_response,
            )

            if exact_response.status_code == 200:
                try:
                    exact_payload = exact_response.json()
                except ValueError as exc:
                    raise LrclibUnavailableError(
                        ("LRCLIB returned invalid JSON."),
                    ) from exc

                if not isinstance(
                    exact_payload,
                    dict,
                ):
                    raise LrclibUnavailableError(
                        ("LRCLIB returned invalid data."),
                    )

                return _payload_to_lyrics(
                    exact_payload,
                )

            if exact_response.status_code != 404:
                exact_response.raise_for_status()

            # Exact matching commonly fails when
            # album/edition metadata differs.
            #
            # Search by title + artist and verify
            # the candidates ourselves.
            search_response = await client.get(
                "/api/search",
                params={
                    "track_name": title,
                    "artist_name": artist,
                },
            )

            _handle_rate_limit(
                search_response,
            )

            search_response.raise_for_status()

            try:
                raw_results = search_response.json()
            except ValueError as exc:
                raise LrclibUnavailableError(
                    ("LRCLIB returned invalid search JSON."),
                ) from exc

            if not isinstance(
                raw_results,
                list,
            ):
                raise LrclibUnavailableError(
                    ("LRCLIB returned invalid search data."),
                )

            results: list[dict[str, object]] = [
                item
                for item in raw_results
                if isinstance(
                    item,
                    dict,
                )
            ]

            candidate = _choose_search_candidate(
                results,
                title=title,
                artist=artist,
                album=album,
                duration_seconds=(duration_seconds),
            )

            if candidate is None:
                return None

            return _payload_to_lyrics(
                candidate,
            )

    except (
        LrclibRateLimitedError,
        LrclibUnavailableError,
    ):
        raise

    except httpx.HTTPError as exc:
        raise LrclibUnavailableError(
            "Unable to reach LRCLIB.",
        ) from exc
