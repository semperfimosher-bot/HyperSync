from __future__ import annotations

import asyncio
import math
from difflib import SequenceMatcher
import re
import time
import unicodedata
from typing import TypedDict
from uuid import UUID

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..database import get_session_factory
from ..models.media import Track
from .generated_playlists import (
    refresh_smart_playlists_for_track,
)


class ExternalTrackMetadata(TypedDict):
    source: str
    recording_id: str | None
    genre: str | None
    release_year: int | None
    confidence: float


class TrackEnrichmentResult(TypedDict):
    matched: bool
    changed: bool
    source: str | None
    recording_id: str | None
    confidence: float | None
    genre: str | None
    release_year: int | None


_GENRE_ALIASES: dict[str, str] = {
    "country": "Country",
    "americana": "Americana",
    "bluegrass": "Bluegrass",
    "western": "Western",
    "hip hop": "Hip-Hop/Rap",
    "hip-hop": "Hip-Hop/Rap",
    "rap": "Hip-Hop/Rap",
    "trap": "Trap",
    "r&b": "R&B/Soul",
    "rnb": "R&B/Soul",
    "soul": "Soul",
    "neo soul": "Neo Soul",
    "pop": "Pop",
    "dance pop": "Dance Pop",
    "synthpop": "Synthpop",
    "dream pop": "Dream Pop",
    "rock": "Rock",
    "alternative": "Alternative",
    "alternative rock": "Alternative Rock",
    "indie": "Indie",
    "indie rock": "Indie Rock",
    "classic rock": "Classic Rock",
    "metal": "Metal",
    "metalcore": "Metalcore",
    "deathcore": "Deathcore",
    "punk": "Punk",
    "pop punk": "Pop Punk",
    "hardcore": "Hardcore",
    "electronic": "Electronic",
    "electronica": "Electronic",
    "edm": "EDM",
    "house": "House",
    "techno": "Techno",
    "trance": "Trance",
    "dubstep": "Dubstep",
    "ambient": "Ambient",
    "downtempo": "Downtempo",
    "lofi": "Lo-Fi",
    "lo-fi": "Lo-Fi",
    "jazz": "Jazz",
    "blues": "Blues",
    "folk": "Folk",
    "acoustic": "Acoustic",
    "classical": "Classical",
    "orchestral": "Orchestral",
    "instrumental": "Instrumental",
    "latin": "Latin",
    "reggaeton": "Reggaeton",
    "bachata": "Bachata",
    "salsa": "Salsa",
    "funk": "Funk",
    "disco": "Disco",
    "gospel": "Gospel",
    "christian": "Christian",
    "worship": "Worship",
    "reggae": "Reggae",
    "ska": "Ska",
    "singer songwriter": "Singer/Songwriter",
    "soundtrack": "Soundtrack",
    "world": "World",
    "new age": "New Age",
}


_request_lock = asyncio.Lock()
_last_request_at = 0.0
_lookup_cache: dict[
    str,
    tuple[
        float,
        ExternalTrackMetadata | None,
    ],
] = {}
_artist_genre_cache: dict[
    str,
    tuple[
        float,
        str | None,
    ],
] = {}

_lastfm_lookup_cache: dict[
    str,
    tuple[
        float,
        ExternalTrackMetadata | None,
    ],
] = {}

_apple_request_lock = asyncio.Lock()
_apple_last_request_at = 0.0
_apple_lookup_cache: dict[
    str,
    tuple[
        float,
        ExternalTrackMetadata | None,
    ],
] = {}


def _normalize(
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

    return " ".join(
        re.findall(
            r"\w+",
            normalized,
        )
    )


def _year(
    value: object,
) -> int | None:
    if not isinstance(
        value,
        str,
    ):
        return None

    match = re.search(
        r"(?<!\d)(19\d{2}|20\d{2}|21\d{2})(?!\d)",
        value,
    )

    if not match:
        return None

    result = int(
        match.group(
            1,
        )
    )

    return (
        result
        if 1900 <= result <= 2100
        else None
    )


def _duration_seconds(
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
        milliseconds = float(
            value,
        )
    except ValueError:
        return None

    if (
        not math.isfinite(
            milliseconds,
        )
        or milliseconds <= 0
    ):
        return None

    return (
        milliseconds
        / 1000.0
    )


def _artist_credit_name(
    candidate: dict[str, object],
) -> str:
    raw_credit = candidate.get(
        "artist-credit",
    )

    if not isinstance(
        raw_credit,
        list,
    ):
        return ""

    parts: list[str] = []

    for item in raw_credit:
        if not isinstance(
            item,
            dict,
        ):
            continue

        name = item.get(
            "name",
        )

        if not isinstance(
            name,
            str,
        ):
            raw_artist = item.get(
                "artist",
            )

            if isinstance(
                raw_artist,
                dict,
            ):
                name = raw_artist.get(
                    "name",
                )

        if isinstance(
            name,
            str,
        ):
            parts.append(
                name,
            )

        joinphrase = item.get(
            "joinphrase",
        )

        if isinstance(
            joinphrase,
            str,
        ):
            parts.append(
                joinphrase,
            )

    return "".join(
        parts,
    ).strip()


def _first_artist_id(
    candidate: dict[str, object],
) -> str | None:
    raw_credit = candidate.get(
        "artist-credit",
    )

    if not isinstance(
        raw_credit,
        list,
    ):
        return None

    for item in raw_credit:
        if not isinstance(
            item,
            dict,
        ):
            continue

        raw_artist = item.get(
            "artist",
        )

        if not isinstance(
            raw_artist,
            dict,
        ):
            continue

        artist_id = raw_artist.get(
            "id",
        )

        if isinstance(
            artist_id,
            str,
        ) and artist_id:
            return artist_id

    return None


def _canonical_genre_text(
    value: object,
) -> str | None:
    if not isinstance(
        value,
        str,
    ):
        return None

    cleaned = " ".join(
        value.strip().split()
    )

    if not cleaned:
        return None

    normalized = _normalize(
        cleaned,
    )

    canonical = (
        _GENRE_ALIASES.get(
            normalized,
        )
    )

    if canonical:
        return canonical

    for (
        alias,
        mapped,
    ) in _GENRE_ALIASES.items():
        if (
            len(alias) >= 4
            and (
                normalized.startswith(
                    alias + " ",
                )
                or normalized.endswith(
                    " " + alias,
                )
            )
        ):
            return mapped

    return cleaned[:120]


def _text_similarity(
    left: object,
    right: object,
) -> float:
    normalized_left = _normalize(
        left,
    )

    normalized_right = _normalize(
        right,
    )

    if (
        not normalized_left
        or not normalized_right
    ):
        return 0.0

    if (
        normalized_left
        == normalized_right
    ):
        return 1.0

    return SequenceMatcher(
        None,
        normalized_left,
        normalized_right,
    ).ratio()


def _canonical_genre_from_items(
    *values: object,
) -> str | None:
    candidates: list[
        tuple[
            int,
            str,
        ]
    ] = []

    for value in values:
        if not isinstance(
            value,
            list,
        ):
            continue

        for item in value:
            if not isinstance(
                item,
                dict,
            ):
                continue

            raw_name = item.get(
                "name",
            )

            if not isinstance(
                raw_name,
                str,
            ):
                continue

            normalized = _normalize(
                raw_name,
            )

            canonical = (
                _GENRE_ALIASES.get(
                    normalized,
                )
            )

            if not canonical:
                continue

            raw_count = item.get(
                "count",
                0,
            )

            try:
                count = int(
                    raw_count
                    or 0
                )
            except (
                TypeError,
                ValueError,
            ):
                count = 0

            candidates.append(
                (
                    count,
                    canonical,
                )
            )

    if not candidates:
        return None

    candidates.sort(
        key=lambda item: (
            -item[0],
            item[1],
        )
    )

    return candidates[0][1]


def _candidate_match(
    candidate: dict[str, object],
    *,
    title: str,
    artist: str,
    duration_seconds: int | None,
) -> tuple[
    float,
    float,
] | None:
    wanted_title = _normalize(
        title,
    )

    wanted_artist = _normalize(
        artist,
    )

    candidate_title = _normalize(
        candidate.get(
            "title",
        )
    )

    candidate_artist = _normalize(
        _artist_credit_name(
            candidate,
        )
    )

    if (
        candidate_title
        != wanted_title
        or candidate_artist
        != wanted_artist
    ):
        return None

    raw_score = candidate.get(
        "score",
        0,
    )

    try:
        search_score = float(
            raw_score
            or 0,
        )
    except (
        TypeError,
        ValueError,
    ):
        search_score = 0.0

    if search_score < 85:
        return None

    wanted_duration = (
        float(
            duration_seconds,
        )
        if (
            duration_seconds
            is not None
            and duration_seconds > 0
        )
        else None
    )

    candidate_duration = (
        _duration_seconds(
            candidate.get(
                "length",
            )
        )
    )

    if (
        wanted_duration
        is not None
        and candidate_duration
        is not None
    ):
        duration_delta = abs(
            candidate_duration
            - wanted_duration
        )

        if duration_delta > 8.0:
            return None

        confidence = (
            0.99
            if (
                search_score >= 98
                and duration_delta <= 3.0
            )
            else 0.95
        )

        return (
            confidence,
            duration_delta,
        )

    return (
        0.90,
        9999.0,
    )


def _lucene_phrase(
    value: str,
) -> str:
    return (
        value
        .replace(
            "\\",
            "\\\\",
        )
        .replace(
            '"',
            '\\"',
        )
    )


async def _apple_throttle() -> None:
    global _apple_last_request_at

    settings = get_settings()

    interval = max(
        float(
            settings
            .apple_search_min_interval_seconds
        ),
        0.0,
    )

    async with _apple_request_lock:
        delay = (
            interval
            - (
                time.monotonic()
                - _apple_last_request_at
            )
        )

        if delay > 0:
            await asyncio.sleep(
                delay,
            )

        _apple_last_request_at = (
            time.monotonic()
        )


def _apple_candidate_match(
    candidate: dict[str, object],
    *,
    title: str,
    artist: str,
    duration_seconds: int | None,
) -> float | None:
    kind = candidate.get(
        "kind",
    )

    if (
        isinstance(
            kind,
            str,
        )
        and kind.casefold()
        != "song"
    ):
        return None

    title_similarity = (
        _text_similarity(
            candidate.get(
                "trackName",
            ),
            title,
        )
    )

    artist_similarity = (
        _text_similarity(
            candidate.get(
                "artistName",
            ),
            artist,
        )
    )

    if (
        title_similarity < 0.94
        or artist_similarity < 0.88
    ):
        return None

    candidate_duration = (
        _duration_seconds(
            candidate.get(
                "trackTimeMillis",
            )
        )
    )

    wanted_duration = (
        float(
            duration_seconds,
        )
        if (
            duration_seconds
            is not None
            and duration_seconds > 0
        )
        else None
    )

    duration_score = 0.0

    if (
        candidate_duration
        is not None
        and wanted_duration
        is not None
    ):
        delta = abs(
            candidate_duration
            - wanted_duration
        )

        if delta > 12.0:
            return None

        duration_score = (
            1.0
            if delta <= 3.0
            else (
                0.96
                if delta <= 6.0
                else 0.90
            )
        )

    confidence = (
        0.52
        * title_similarity
        + 0.36
        * artist_similarity
        + 0.12
        * (
            duration_score
            if duration_score > 0
            else 0.88
        )
    )

    if confidence < 0.91:
        return None

    return min(
        confidence,
        0.995,
    )


async def lookup_apple_track_metadata(
    *,
    title: str,
    artist: str,
    duration_seconds: int | None,
    client: httpx.AsyncClient | None = None,
    throttle: bool = True,
) -> ExternalTrackMetadata | None:
    settings = get_settings()

    cache_key = (
        _normalize(
            artist,
        )
        + "\x1f"
        + _normalize(
            title,
        )
        + "\x1f"
        + str(
            int(
                duration_seconds
                or 0
            )
        )
    )

    now = time.monotonic()

    if client is None:
        cached = (
            _apple_lookup_cache.get(
                cache_key,
            )
        )

        if (
            cached is not None
            and now - cached[0]
            < (
                settings
                .apple_search_cache_hours
                * 60
                * 60
            )
        ):
            return cached[1]

    owns_client = (
        client is None
    )

    if client is None:
        client = httpx.AsyncClient(
            base_url=(
                settings
                .apple_search_base_url
                .rstrip(
                    "/",
                )
            ),
            headers={
                "User-Agent":
                    settings
                    .musicbrainz_user_agent,
                "Accept":
                    "application/json",
            },
            timeout=float(
                settings
                .apple_search_timeout_seconds
            ),
        )

    try:
        if throttle:
            await _apple_throttle()

        response = await client.get(
            "/search",
            params={
                "term":
                    f"{artist} {title}",
                "country":
                    settings
                    .apple_search_country,
                "media":
                    "music",
                "entity":
                    "song",
                "limit":
                    25,
                "explicit":
                    "Yes",
            },
        )

        response.raise_for_status()

        payload = response.json()

        if not isinstance(
            payload,
            dict,
        ):
            raise ValueError(
                "Apple Search returned invalid data.",
            )

        raw_results = payload.get(
            "results",
        )

        matches: list[
            tuple[
                float,
                dict[
                    str,
                    object,
                ],
            ]
        ] = []

        if isinstance(
            raw_results,
            list,
        ):
            for item in raw_results:
                if not isinstance(
                    item,
                    dict,
                ):
                    continue

                confidence = (
                    _apple_candidate_match(
                        item,
                        title=title,
                        artist=artist,
                        duration_seconds=(
                            duration_seconds
                        ),
                    )
                )

                if confidence is None:
                    continue

                matches.append(
                    (
                        confidence,
                        item,
                    )
                )

        matches.sort(
            key=lambda item: (
                -item[0],
                str(
                    item[1].get(
                        "trackName",
                        "",
                    )
                ).casefold(),
            )
        )

        if not matches:
            result = None

        else:
            confidence = (
                matches[0][0]
            )

            candidate = (
                matches[0][1]
            )

            raw_track_id = (
                candidate.get(
                    "trackId",
                )
            )

            recording_id = (
                str(
                    raw_track_id,
                )
                if raw_track_id
                is not None
                else None
            )

            result = {
                "source":
                    "apple",
                "recording_id":
                    recording_id,
                "genre":
                    _canonical_genre_text(
                        candidate.get(
                            "primaryGenreName",
                        )
                    ),
                "release_year":
                    _year(
                        candidate.get(
                            "releaseDate",
                        )
                    ),
                "confidence":
                    confidence,
            }

        if owns_client:
            _apple_lookup_cache[
                cache_key
            ] = (
                now,
                result,
            )

        return result

    except (
        httpx.HTTPError,
        ValueError,
    ):
        return None

    finally:
        if owns_client:
            await client.aclose()


async def _throttle() -> None:
    global _last_request_at

    settings = get_settings()

    interval = max(
        float(
            settings
            .musicbrainz_min_interval_seconds
        ),
        0.0,
    )

    async with _request_lock:
        delay = (
            interval
            - (
                time.monotonic()
                - _last_request_at
            )
        )

        if delay > 0:
            await asyncio.sleep(
                delay,
            )

        _last_request_at = (
            time.monotonic()
        )


async def _get_json(
    client: httpx.AsyncClient,
    path: str,
    *,
    params: dict[
        str,
        object,
    ],
    throttle: bool,
) -> dict[str, object]:
    if throttle:
        await _throttle()

    response = await client.get(
        path,
        params=params,
    )

    response.raise_for_status()

    payload = response.json()

    if not isinstance(
        payload,
        dict,
    ):
        raise ValueError(
            "MusicBrainz returned invalid data.",
        )

    return payload


async def _recording_detail_genre(
    client: httpx.AsyncClient,
    recording_id: str,
    *,
    throttle: bool,
) -> str | None:
    payload = await _get_json(
        client,
        f"/ws/2/recording/{recording_id}",
        params={
            "inc":
                "genres+tags",
            "fmt":
                "json",
        },
        throttle=throttle,
    )

    return _canonical_genre_from_items(
        payload.get(
            "genres",
        ),
        payload.get(
            "tags",
        ),
    )


async def _artist_genre(
    client: httpx.AsyncClient,
    artist_id: str,
    *,
    throttle: bool,
) -> str | None:
    settings = get_settings()

    now = time.monotonic()

    cached = _artist_genre_cache.get(
        artist_id,
    )

    if (
        cached is not None
        and now - cached[0]
        < (
            settings
            .musicbrainz_cache_hours
            * 60
            * 60
        )
    ):
        return cached[1]

    payload = await _get_json(
        client,
        f"/ws/2/artist/{artist_id}",
        params={
            "inc":
                "genres+tags",
            "fmt":
                "json",
        },
        throttle=throttle,
    )

    genre = _canonical_genre_from_items(
        payload.get(
            "genres",
        ),
        payload.get(
            "tags",
        ),
    )

    _artist_genre_cache[
        artist_id
    ] = (
        now,
        genre,
    )

    return genre


async def _lookup_musicbrainz_track_metadata(
    *,
    title: str,
    artist: str,
    duration_seconds: int | None,
    client: httpx.AsyncClient | None = None,
    throttle: bool = True,
) -> ExternalTrackMetadata | None:
    settings = get_settings()

    cache_key = (
        _normalize(
            artist,
        )
        + "\x1f"
        + _normalize(
            title,
        )
        + "\x1f"
        + str(
            int(
                duration_seconds
                or 0
            )
        )
    )

    now = time.monotonic()

    if client is None:
        cached = _lookup_cache.get(
            cache_key,
        )

        if (
            cached is not None
            and now - cached[0]
            < (
                settings
                .musicbrainz_cache_hours
                * 60
                * 60
            )
        ):
            return cached[1]

    owns_client = (
        client is None
    )

    if client is None:
        client = httpx.AsyncClient(
            base_url=(
                settings
                .musicbrainz_base_url
                .rstrip(
                    "/",
                )
            ),
            headers={
                "User-Agent":
                    settings
                    .musicbrainz_user_agent,
                "Accept":
                    "application/json",
            },
            timeout=float(
                settings
                .musicbrainz_timeout_seconds
            ),
        )

    try:
        payload = await _get_json(
            client,
            "/ws/2/recording/",
            params={
                "query":
                    (
                        'recording:"'
                        + _lucene_phrase(
                            title,
                        )
                        + '" AND artist:"'
                        + _lucene_phrase(
                            artist,
                        )
                        + '"'
                    ),
                "limit":
                    8,
                "fmt":
                    "json",
            },
            throttle=throttle,
        )

        raw_recordings = payload.get(
            "recordings",
        )

        if not isinstance(
            raw_recordings,
            list,
        ):
            result = None

        else:
            matches: list[
                tuple[
                    float,
                    float,
                    dict[
                        str,
                        object,
                    ],
                ]
            ] = []

            for item in raw_recordings:
                if not isinstance(
                    item,
                    dict,
                ):
                    continue

                match = _candidate_match(
                    item,
                    title=title,
                    artist=artist,
                    duration_seconds=(
                        duration_seconds
                    ),
                )

                if match is None:
                    continue

                matches.append(
                    (
                        match[0],
                        match[1],
                        item,
                    )
                )

            matches.sort(
                key=lambda item: (
                    -item[0],
                    item[1],
                    -float(
                        item[2].get(
                            "score",
                            0,
                        )
                        or 0
                    ),
                )
            )

            if not matches:
                result = None

            else:
                confidence = (
                    matches[0][0]
                )

                candidate = (
                    matches[0][2]
                )

                recording_id = (
                    candidate.get(
                        "id",
                    )
                )

                recording_id = (
                    recording_id
                    if isinstance(
                        recording_id,
                        str,
                    )
                    else None
                )

                release_year = _year(
                    candidate.get(
                        "first-release-date",
                    )
                )

                genre = (
                    _canonical_genre_from_items(
                        candidate.get(
                            "genres",
                        ),
                        candidate.get(
                            "tags",
                        ),
                    )
                )

                if (
                    genre is None
                    and recording_id
                ):
                    try:
                        genre = (
                            await _recording_detail_genre(
                                client,
                                recording_id,
                                throttle=(
                                    throttle
                                ),
                            )
                        )
                    except (
                        httpx.HTTPError,
                        ValueError,
                    ):
                        genre = None

                if genre is None:
                    artist_id = (
                        _first_artist_id(
                            candidate,
                        )
                    )

                    if artist_id:
                        try:
                            genre = (
                                await _artist_genre(
                                    client,
                                    artist_id,
                                    throttle=(
                                        throttle
                                    ),
                                )
                            )
                        except (
                            httpx.HTTPError,
                            ValueError,
                        ):
                            genre = None

                result = {
                    "source":
                        "musicbrainz",
                    "recording_id":
                        recording_id,
                    "genre":
                        genre,
                    "release_year":
                        release_year,
                    "confidence":
                        confidence,
                }

        if owns_client:
            _lookup_cache[
                cache_key
            ] = (
                now,
                result,
            )

        return result

    except (
        httpx.HTTPError,
        ValueError,
    ):
        return None

    finally:
        if owns_client:
            await client.aclose()



def _lastfm_genre(
    value: object,
) -> str | None:
    if not isinstance(
        value,
        dict,
    ):
        return None

    raw_tags = value.get(
        "tag",
    )

    if isinstance(
        raw_tags,
        dict,
    ):
        raw_tags = [
            raw_tags,
        ]

    if not isinstance(
        raw_tags,
        list,
    ):
        return None

    for item in raw_tags:
        if not isinstance(
            item,
            dict,
        ):
            continue

        raw_name = item.get(
            "name",
        )

        if not isinstance(
            raw_name,
            str,
        ):
            continue

        canonical = _GENRE_ALIASES.get(
            _normalize(
                raw_name,
            )
        )

        if canonical:
            return canonical

    return None


def _lastfm_track_match(
    track: dict[str, object],
    *,
    title: str,
    artist: str,
    duration_seconds: int | None,
) -> float | None:
    returned_title = _normalize(
        track.get(
            "name",
        )
    )

    raw_artist = track.get(
        "artist",
    )

    if isinstance(
        raw_artist,
        dict,
    ):
        returned_artist = _normalize(
            raw_artist.get(
                "name",
            )
        )
    else:
        returned_artist = _normalize(
            raw_artist,
        )

    if (
        returned_title
        != _normalize(
            title,
        )
        or returned_artist
        != _normalize(
            artist,
        )
    ):
        return None

    returned_duration = (
        _duration_seconds(
            track.get(
                "duration",
            )
        )
    )

    if (
        duration_seconds
        and returned_duration
    ):
        delta = abs(
            returned_duration
            - float(
                duration_seconds,
            )
        )

        if delta > 10.0:
            return None

        return (
            0.97
            if delta <= 4.0
            else 0.94
        )

    return 0.91


async def _lastfm_get_json(
    client: httpx.AsyncClient,
    *,
    method: str,
    params: dict[
        str,
        object,
    ],
) -> dict[str, object]:
    response = await client.get(
        "/2.0/",
        params={
            "method":
                method,
            "format":
                "json",
            **params,
        },
    )

    response.raise_for_status()

    payload = response.json()

    if not isinstance(
        payload,
        dict,
    ):
        raise ValueError(
            "Last.fm returned invalid data.",
        )

    if payload.get(
        "error",
    ) is not None:
        raise ValueError(
            str(
                payload.get(
                    "message",
                    "Last.fm lookup failed.",
                )
            )
        )

    return payload


async def lookup_lastfm_track_metadata(
    *,
    title: str,
    artist: str,
    duration_seconds: int | None,
    client: httpx.AsyncClient | None = None,
    api_key: str | None = None,
) -> ExternalTrackMetadata | None:
    settings = get_settings()

    resolved_api_key = (
        str(
            api_key
            if api_key is not None
            else settings.lastfm_api_key
        )
        .strip()
    )

    if not resolved_api_key:
        return None

    cache_key = (
        _normalize(
            artist,
        )
        + "\x1f"
        + _normalize(
            title,
        )
        + "\x1f"
        + str(
            int(
                duration_seconds
                or 0
            )
        )
    )

    now = time.monotonic()

    if client is None:
        cached = (
            _lastfm_lookup_cache.get(
                cache_key,
            )
        )

        if (
            cached is not None
            and now - cached[0]
            < (
                settings
                .lastfm_cache_hours
                * 60
                * 60
            )
        ):
            return cached[1]

    owns_client = (
        client is None
    )

    if client is None:
        client = httpx.AsyncClient(
            base_url=(
                settings
                .lastfm_base_url
                .rstrip(
                    "/",
                )
            ),
            headers={
                "User-Agent":
                    settings
                    .musicbrainz_user_agent,
                "Accept":
                    "application/json",
            },
            timeout=float(
                settings
                .lastfm_timeout_seconds
            ),
        )

    try:
        track_payload = (
            await _lastfm_get_json(
                client,
                method="track.getInfo",
                params={
                    "api_key":
                        resolved_api_key,
                    "artist":
                        artist,
                    "track":
                        title,
                    "autocorrect":
                        1,
                },
            )
        )

        raw_track = (
            track_payload.get(
                "track",
            )
        )

        if not isinstance(
            raw_track,
            dict,
        ):
            result = None

        else:
            confidence = (
                _lastfm_track_match(
                    raw_track,
                    title=title,
                    artist=artist,
                    duration_seconds=(
                        duration_seconds
                    ),
                )
            )

            if confidence is None:
                result = None

            else:
                raw_mbid = (
                    raw_track.get(
                        "mbid",
                    )
                )

                recording_id = (
                    raw_mbid
                    if isinstance(
                        raw_mbid,
                        str,
                    )
                    and raw_mbid.strip()
                    else None
                )

                genre = _lastfm_genre(
                    raw_track.get(
                        "toptags",
                    )
                )

                if genre is None:
                    try:
                        tags_payload = (
                            await _lastfm_get_json(
                                client,
                                method=(
                                    "track.getTopTags"
                                ),
                                params={
                                    "api_key":
                                        resolved_api_key,
                                    "artist":
                                        artist,
                                    "track":
                                        title,
                                    "autocorrect":
                                        1,
                                },
                            )
                        )

                        genre = (
                            _lastfm_genre(
                                tags_payload.get(
                                    "toptags",
                                )
                            )
                        )

                    except (
                        httpx.HTTPError,
                        ValueError,
                    ):
                        genre = None

                release_year = None

                raw_album = (
                    raw_track.get(
                        "album",
                    )
                )

                album_title = None

                if isinstance(
                    raw_album,
                    dict,
                ):
                    raw_title = (
                        raw_album.get(
                            "title",
                        )
                    )

                    if isinstance(
                        raw_title,
                        str,
                    ):
                        album_title = (
                            raw_title.strip()
                            or None
                        )

                if album_title:
                    try:
                        album_payload = (
                            await _lastfm_get_json(
                                client,
                                method="album.getInfo",
                                params={
                                    "api_key":
                                        resolved_api_key,
                                    "artist":
                                        artist,
                                    "album":
                                        album_title,
                                    "autocorrect":
                                        1,
                                },
                            )
                        )

                        raw_album_info = (
                            album_payload.get(
                                "album",
                            )
                        )

                        if isinstance(
                            raw_album_info,
                            dict,
                        ):
                            release_year = _year(
                                raw_album_info.get(
                                    "releasedate",
                                )
                            )

                            if genre is None:
                                genre = (
                                    _lastfm_genre(
                                        raw_album_info.get(
                                            "tags",
                                        )
                                        or raw_album_info.get(
                                            "toptags",
                                        )
                                    )
                                )

                    except (
                        httpx.HTTPError,
                        ValueError,
                    ):
                        release_year = None

                result = {
                    "source":
                        "lastfm",
                    "recording_id":
                        recording_id,
                    "genre":
                        genre,
                    "release_year":
                        release_year,
                    "confidence":
                        confidence,
                }

        if owns_client:
            _lastfm_lookup_cache[
                cache_key
            ] = (
                now,
                result,
            )

        return result

    except (
        httpx.HTTPError,
        ValueError,
    ):
        return None

    finally:
        if owns_client:
            await client.aclose()


def _merge_external_metadata(
    primary: ExternalTrackMetadata | None,
    fallback: ExternalTrackMetadata | None,
) -> ExternalTrackMetadata | None:
    if primary is None:
        return fallback

    if fallback is None:
        return primary

    genre = (
        primary[
            "genre"
        ]
        or fallback[
            "genre"
        ]
    )

    release_year = (
        primary[
            "release_year"
        ]
        if primary[
            "release_year"
        ]
        is not None
        else fallback[
            "release_year"
        ]
    )

    source = (
        primary[
            "source"
        ]
    )

    if (
        (
            not primary[
                "genre"
            ]
            and fallback[
                "genre"
            ]
        )
        or (
            primary[
                "release_year"
            ]
            is None
            and fallback[
                "release_year"
            ]
            is not None
        )
    ):
        source = (
            primary[
                "source"
            ]
            + "+"
            + fallback[
                "source"
            ]
        )

    return {
        "source":
            source,
        "recording_id":
            (
                primary[
                    "recording_id"
                ]
                or fallback[
                    "recording_id"
                ]
            ),
        "genre":
            genre,
        "release_year":
            release_year,
        "confidence":
            max(
                primary[
                    "confidence"
                ],
                fallback[
                    "confidence"
                ],
            ),
    }


async def lookup_external_track_metadata(
    *,
    title: str,
    artist: str,
    duration_seconds: int | None,
    client: httpx.AsyncClient | None = None,
    throttle: bool = True,
) -> ExternalTrackMetadata | None:
    # Explicit client injection is used by
    # MusicBrainz unit tests. Keep those
    # deterministic and isolated from the
    # configured provider chain.
    if client is not None:
        return await _lookup_musicbrainz_track_metadata(
            title=title,
            artist=artist,
            duration_seconds=(
                duration_seconds
            ),
            client=client,
            throttle=throttle,
        )

    apple = (
        await lookup_apple_track_metadata(
            title=title,
            artist=artist,
            duration_seconds=(
                duration_seconds
            ),
            throttle=throttle,
        )
    )

    # A near-exact Apple match with both
    # fields present is enough to avoid a
    # slower MusicBrainz lookup.
    if (
        apple is not None
        and apple[
            "confidence"
        ] >= 0.965
        and apple[
            "genre"
        ]
        and apple[
            "release_year"
        ]
        is not None
    ):
        return apple

    musicbrainz = (
        await _lookup_musicbrainz_track_metadata(
            title=title,
            artist=artist,
            duration_seconds=(
                duration_seconds
            ),
            throttle=throttle,
        )
    )

    combined = (
        _merge_external_metadata(
            apple,
            musicbrainz,
        )
    )

    if (
        combined is not None
        and combined[
            "genre"
        ]
        and combined[
            "release_year"
        ]
        is not None
    ):
        return combined

    lastfm = (
        await lookup_lastfm_track_metadata(
            title=title,
            artist=artist,
            duration_seconds=(
                duration_seconds
            ),
        )
    )

    return _merge_external_metadata(
        combined,
        lastfm,
    )


async def enrich_track_metadata(
    session: AsyncSession,
    track: Track,
) -> TrackEnrichmentResult:
    missing_genre = not (
        track.genre
        or ""
    ).strip()

    missing_year = (
        track.release_year
        is None
    )

    if (
        not missing_genre
        and not missing_year
    ):
        return {
            "matched":
                False,
            "changed":
                False,
            "source":
                None,
            "recording_id":
                None,
            "confidence":
                None,
            "genre":
                track.genre,
            "release_year":
                track.release_year,
        }

    metadata = (
        await lookup_external_track_metadata(
            title=track.title,
            artist=track.artist,
            duration_seconds=(
                track.duration_seconds
            ),
        )
    )

    if metadata is None:
        return {
            "matched":
                False,
            "changed":
                False,
            "source":
                None,
            "recording_id":
                None,
            "confidence":
                None,
            "genre":
                track.genre,
            "release_year":
                track.release_year,
        }

    changed = False

    if (
        missing_genre
        and metadata[
            "genre"
        ]
    ):
        track.genre = (
            metadata[
                "genre"
            ][:120]
        )

        changed = True

    if (
        missing_year
        and metadata[
            "release_year"
        ]
        is not None
    ):
        track.release_year = (
            metadata[
                "release_year"
            ]
        )

        changed = True

    if changed:
        await session.commit()

        try:
            await refresh_smart_playlists_for_track(
                session,
                track,
            )
        except Exception:
            await session.rollback()

    return {
        "matched":
            True,
        "changed":
            changed,
        "source":
            metadata[
                "source"
            ],
        "recording_id":
            metadata[
                "recording_id"
            ],
        "confidence":
            metadata[
                "confidence"
            ],
        "genre":
            track.genre,
        "release_year":
            track.release_year,
    }


async def enrich_track_metadata_by_id(
    track_id: UUID,
) -> TrackEnrichmentResult | None:
    session_factory = (
        get_session_factory()
    )

    async with session_factory() as session:
        track = await session.get(
            Track,
            track_id,
        )

        if track is None:
            return None

        return await enrich_track_metadata(
            session,
            track,
        )
