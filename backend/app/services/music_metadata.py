from __future__ import annotations

import asyncio
import math
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


async def lookup_external_track_metadata(
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
