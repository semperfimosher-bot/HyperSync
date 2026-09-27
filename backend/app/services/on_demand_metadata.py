from __future__ import annotations

import asyncio
import hashlib
import math
import re
import unicodedata
from dataclasses import (
    asdict,
    dataclass,
    replace,
)
from difflib import SequenceMatcher
from typing import Any

import httpx

from ..config import get_settings
from .audio_metadata import (
    normalize_track_identity,
    normalize_track_title_identity,
)


@dataclass(frozen=True)
class CatalogTrackCandidate:
    key: str
    title: str
    artist: str
    album: str | None
    duration_seconds: int | None
    artwork_url: str | None
    genre: str | None
    release_year: int | None
    explicit: bool | None
    track_number: int | None
    disc_number: int | None
    isrc: str | None
    deezer_track_id: str | None
    apple_track_id: str | None
    provider: str
    confidence: float

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def _normalized_text(
    value: object,
) -> str:
    text = unicodedata.normalize(
        "NFKC",
        str(
            value
            if value is not None
            else ""
        ),
    ).casefold()

    return " ".join(
        re.findall(
            r"\w+",
            text,
        )
    )


def _similarity(
    left: object,
    right: object,
) -> float:
    left_normalized = _normalized_text(
        left,
    )

    right_normalized = _normalized_text(
        right,
    )

    if (
        not left_normalized
        or not right_normalized
    ):
        return 0.0

    if left_normalized == right_normalized:
        return 1.0

    return SequenceMatcher(
        None,
        left_normalized,
        right_normalized,
    ).ratio()


def _safe_int(
    value: object,
) -> int | None:
    if value is None:
        return None

    try:
        result = int(
            float(
                str(
                    value,
                ),
            )
        )
    except (
        TypeError,
        ValueError,
    ):
        return None

    return result


def _year(
    value: object,
) -> int | None:
    if value is None:
        return None

    match = re.search(
        r"(?<!\d)(19\d{2}|20\d{2}|21\d{2})(?!\d)",
        str(
            value,
        ),
    )

    if not match:
        return None

    year = int(
        match.group(
            1,
        )
    )

    return (
        year
        if 1900 <= year <= 2100
        else None
    )


def _itunes_duration(
    value: object,
) -> int | None:
    raw = _safe_int(
        value,
    )

    if raw is None or raw <= 0:
        return None

    return max(
        1,
        round(
            raw / 1000,
        ),
    )


def _large_itunes_artwork(
    value: object,
) -> str | None:
    if not isinstance(
        value,
        str,
    ):
        return None

    url = value.strip()

    if not url:
        return None

    return re.sub(
        r"\d+x\d+bb",
        "600x600bb",
        url,
    )


_ARTIST_CREDIT_SPLIT_PATTERN = re.compile(
    (
        r"\s+"
        r"(?:&|\band\b|\bx\b|\bwith\b|"
        r"\bfeat(?:uring)?\.?\b|\bft\.?\b)"
        r"\s+"
    ),
    flags=re.IGNORECASE,
)


def _primary_artist_credit(
    artist: str | None,
) -> str:
    raw = str(
        artist
        or ""
    ).strip()

    if not raw:
        return ""

    parts = [
        part.strip()
        for part in (
            _ARTIST_CREDIT_SPLIT_PATTERN
            .split(
                raw,
            )
        )
        if part.strip()
    ]

    return (
        parts[0]
        if parts
        else raw
    )


def _candidate_identity(
    artist: str,
    title: str,
) -> tuple[str, str]:
    return (
        normalize_track_identity(
            artist,
        ),
        normalize_track_title_identity(
            title,
        ),
    )


def _candidate_key(
    *,
    artist: str,
    title: str,
    isrc: str | None,
    deezer_track_id: str | None,
    apple_track_id: str | None,
) -> str:
    strongest = (
        ("isrc:" + isrc.strip().upper())
        if isrc
        else (
            "deezer:" + deezer_track_id
            if deezer_track_id
            else (
                "apple:" + apple_track_id
                if apple_track_id
                else (
                    "identity:"
                    + "\x1f".join(
                        _candidate_identity(
                            artist,
                            title,
                        )
                    )
                )
            )
        )
    )

    digest = hashlib.sha256(
        strongest.encode(
            "utf-8",
        )
    ).hexdigest()[:32]

    return f"music:{digest}"


def _query_confidence(
    *,
    query: str,
    title: str,
    artist: str,
    album: str | None,
) -> float:
    normalized_query = _normalized_text(
        query,
    )

    if not normalized_query:
        return 0.0

    title_score = _similarity(
        query,
        title,
    )

    artist_title_score = _similarity(
        query,
        f"{artist} {title}",
    )

    title_artist_score = _similarity(
        query,
        f"{title} {artist}",
    )

    album_score = (
        _similarity(
            query,
            f"{artist} {album}",
        )
        if album
        else 0.0
    )

    contains_bonus = (
        0.12
        if (
            _normalized_text(
                title,
            )
            in normalized_query
            or normalized_query
            in _normalized_text(
                f"{artist} {title}",
            )
        )
        else 0.0
    )

    return min(
        1.0,
        max(
            title_score,
            artist_title_score,
            title_artist_score,
            album_score,
        )
        + contains_bonus,
    )


def _deezer_candidate(
    item: dict[str, Any],
    *,
    query: str,
) -> CatalogTrackCandidate | None:
    title = str(
        item.get(
            "title_short",
        )
        or item.get(
            "title",
        )
        or ""
    ).strip()

    artist_value = item.get(
        "artist",
    )

    album_value = item.get(
        "album",
    )

    artist = (
        str(
            artist_value.get(
                "name",
            )
            or ""
        ).strip()
        if isinstance(
            artist_value,
            dict,
        )
        else ""
    )

    if not title or not artist:
        return None

    album = (
        str(
            album_value.get(
                "title",
            )
            or ""
        ).strip()
        if isinstance(
            album_value,
            dict,
        )
        else ""
    ) or None

    artwork = None

    if isinstance(
        album_value,
        dict,
    ):
        for field in (
            "cover_xl",
            "cover_big",
            "cover_medium",
            "cover",
        ):
            raw = album_value.get(
                field,
            )

            if isinstance(
                raw,
                str,
            ) and raw.strip():
                artwork = raw.strip()
                break

    raw_id = item.get(
        "id",
    )

    deezer_track_id = (
        str(
            raw_id,
        )
        if raw_id is not None
        else None
    )

    raw_isrc = item.get(
        "isrc",
    )

    isrc = (
        str(
            raw_isrc,
        ).strip().upper()
        if raw_isrc
        else None
    )

    duration = _safe_int(
        item.get(
            "duration",
        )
    )

    if duration is not None:
        duration = max(
            duration,
            0,
        ) or None

    genre = None

    genres_value = item.get(
        "genres",
    )

    if isinstance(
        genres_value,
        dict,
    ):
        genre_data = genres_value.get(
            "data",
        )

        if isinstance(
            genre_data,
            list,
        ) and genre_data:
            first = genre_data[0]

            if isinstance(
                first,
                dict,
            ):
                raw_genre = first.get(
                    "name",
                )

                if isinstance(
                    raw_genre,
                    str,
                ):
                    genre = (
                        raw_genre.strip()
                        or None
                    )

    confidence = _query_confidence(
        query=query,
        title=title,
        artist=artist,
        album=album,
    )

    return CatalogTrackCandidate(
        key=_candidate_key(
            artist=artist,
            title=title,
            isrc=isrc,
            deezer_track_id=(
                deezer_track_id
            ),
            apple_track_id=None,
        ),
        title=title,
        artist=artist,
        album=album,
        duration_seconds=(
            duration
        ),
        artwork_url=artwork,
        genre=genre,
        release_year=_year(
            item.get(
                "release_date",
            ),
        ),
        explicit=(
            bool(
                item.get(
                    "explicit_lyrics",
                )
            )
            if item.get(
                "explicit_lyrics",
            )
            is not None
            else None
        ),
        track_number=_safe_int(
            item.get(
                "track_position",
            ),
        ),
        disc_number=_safe_int(
            item.get(
                "disk_number",
            ),
        ),
        isrc=isrc,
        deezer_track_id=(
            deezer_track_id
        ),
        apple_track_id=None,
        provider="deezer",
        confidence=confidence,
    )


def _apple_candidate(
    item: dict[str, Any],
    *,
    query: str,
) -> CatalogTrackCandidate | None:
    kind = str(
        item.get(
            "kind",
        )
        or ""
    ).casefold()

    if kind and kind != "song":
        return None

    title = str(
        item.get(
            "trackName",
        )
        or ""
    ).strip()

    artist = str(
        item.get(
            "artistName",
        )
        or ""
    ).strip()

    if not title or not artist:
        return None

    album = (
        str(
            item.get(
                "collectionName",
            )
            or ""
        ).strip()
        or None
    )

    raw_id = item.get(
        "trackId",
    )

    apple_track_id = (
        str(
            raw_id,
        )
        if raw_id is not None
        else None
    )

    confidence = _query_confidence(
        query=query,
        title=title,
        artist=artist,
        album=album,
    )

    explicitness = str(
        item.get(
            "trackExplicitness",
        )
        or ""
    ).casefold()

    explicit = (
        True
        if explicitness == "explicit"
        else (
            False
            if explicitness
            in {
                "cleaned",
                "notexplicit",
            }
            else None
        )
    )

    return CatalogTrackCandidate(
        key=_candidate_key(
            artist=artist,
            title=title,
            isrc=None,
            deezer_track_id=None,
            apple_track_id=(
                apple_track_id
            ),
        ),
        title=title,
        artist=artist,
        album=album,
        duration_seconds=(
            _itunes_duration(
                item.get(
                    "trackTimeMillis",
                )
            )
        ),
        artwork_url=(
            _large_itunes_artwork(
                item.get(
                    "artworkUrl100",
                )
                or item.get(
                    "artworkUrl60",
                )
            )
        ),
        genre=(
            str(
                item.get(
                    "primaryGenreName",
                )
                or ""
            ).strip()
            or None
        ),
        release_year=_year(
            item.get(
                "releaseDate",
            ),
        ),
        explicit=explicit,
        track_number=_safe_int(
            item.get(
                "trackNumber",
            ),
        ),
        disc_number=_safe_int(
            item.get(
                "discNumber",
            ),
        ),
        isrc=None,
        deezer_track_id=None,
        apple_track_id=(
            apple_track_id
        ),
        provider="itunes",
        confidence=confidence,
    )


async def _fetch_deezer_detail(
    client: httpx.AsyncClient,
    candidate: CatalogTrackCandidate,
) -> CatalogTrackCandidate:
    if not candidate.deezer_track_id:
        return candidate

    try:
        response = await client.get(
            f"/track/{candidate.deezer_track_id}",
        )

        response.raise_for_status()

        payload = response.json()

        if not isinstance(
            payload,
            dict,
        ):
            return candidate

        enriched = _deezer_candidate(
            payload,
            query=(
                f"{candidate.artist} "
                f"{candidate.title}"
            ),
        )

        if enriched is None:
            return candidate

        return replace(
            enriched,
            confidence=max(
                candidate.confidence,
                enriched.confidence,
            ),
        )

    except (
        httpx.HTTPError,
        ValueError,
    ):
        return candidate


async def _search_deezer(
    query: str,
    *,
    limit: int,
    artist_only: bool = False,
) -> list[CatalogTrackCandidate]:
    settings = get_settings()

    requested_limit = max(
        1,
        min(
            int(limit),
            500,
        ),
    )

    provider_query = (
        'artist:"'
        + query.replace(
            '"',
            " ",
        ).strip()
        + '"'
        if artist_only
        else query
    )

    async with httpx.AsyncClient(
        base_url=(
            settings
            .deezer_api_base_url
            .rstrip(
                "/",
            )
        ),
        timeout=float(
            settings
            .deezer_timeout_seconds
        ),
        headers={
            "Accept":
                "application/json",
            "User-Agent":
                settings
                .musicbrainz_user_agent,
        },
    ) as client:
        candidates: list[
            CatalogTrackCandidate
        ] = []

        index = 0

        while (
            len(candidates)
            < requested_limit
        ):
            page_limit = min(
                100,
                requested_limit
                - len(candidates),
            )

            try:
                response = await client.get(
                    "/search/track",
                    params={
                        "q":
                            provider_query,
                        "limit":
                            page_limit,
                        "index":
                            index,
                    },
                )

                response.raise_for_status()

                payload = response.json()

            except (
                httpx.HTTPError,
                ValueError,
            ):
                break

            if not isinstance(
                payload,
                dict,
            ):
                break

            raw_items = payload.get(
                "data",
            )

            if (
                not isinstance(
                    raw_items,
                    list,
                )
                or not raw_items
            ):
                break

            page_candidates = [
                candidate
                for item in raw_items
                if isinstance(
                    item,
                    dict,
                )
                for candidate in [
                    _deezer_candidate(
                        item,
                        query=query,
                    )
                ]
                if candidate is not None
            ]

            candidates.extend(
                page_candidates,
            )

            index += len(
                raw_items,
            )

            if (
                not payload.get(
                    "next",
                )
                or len(
                    raw_items,
                )
                < page_limit
            ):
                break

        candidates = candidates[
            :requested_limit
        ]

        detail_count = min(
            len(
                candidates,
            ),
            max(
                0,
                settings
                .deezer_detail_limit,
            ),
        )

        if detail_count > 0:
            detailed = await asyncio.gather(
                *[
                    _fetch_deezer_detail(
                        client,
                        candidate,
                    )
                    for candidate
                    in candidates[
                        :detail_count
                    ]
                ],
            )

            candidates = (
                list(
                    detailed,
                )
                + candidates[
                    detail_count:
                ]
            )

        return candidates


async def _search_itunes(
    query: str,
    *,
    limit: int,
    artist_only: bool = False,
) -> list[CatalogTrackCandidate]:
    settings = get_settings()

    async with httpx.AsyncClient(
        base_url=(
            settings
            .apple_search_base_url
            .rstrip(
                "/",
            )
        ),
        timeout=float(
            settings
            .apple_search_timeout_seconds
        ),
        headers={
            "Accept":
                "application/json",
            "User-Agent":
                settings
                .musicbrainz_user_agent,
        },
    ) as client:
        try:
            response = await client.get(
                "/search",
                params={
                    "term":
                        query,
                    "country":
                        settings
                        .apple_search_country,
                    "media":
                        "music",
                    "entity":
                        "song",
                    "limit":
                        max(
                            1,
                            min(
                                limit,
                                200,
                            ),
                        ),
                    "explicit":
                        "Yes",
                    **(
                        {
                            "attribute":
                                "artistTerm",
                        }
                        if artist_only
                        else {}
                    ),
                },
            )

            response.raise_for_status()

            payload = response.json()

        except (
            httpx.HTTPError,
            ValueError,
        ):
            return []

    if not isinstance(
        payload,
        dict,
    ):
        return []

    raw_items = payload.get(
        "results",
    )

    if not isinstance(
        raw_items,
        list,
    ):
        return []

    return [
        candidate
        for item in raw_items
        if isinstance(
            item,
            dict,
        )
        for candidate in [
            _apple_candidate(
                item,
                query=query,
            )
        ]
        if candidate is not None
    ]


def _duration_compatible(
    left: int | None,
    right: int | None,
) -> bool:
    if (
        left is None
        or right is None
    ):
        return True

    return abs(
        left - right,
    ) <= 15


def _merge_pair(
    primary: CatalogTrackCandidate,
    secondary: CatalogTrackCandidate,
) -> CatalogTrackCandidate:
    isrc = (
        primary.isrc
        or secondary.isrc
    )

    deezer_id = (
        primary.deezer_track_id
        or secondary.deezer_track_id
    )

    apple_id = (
        primary.apple_track_id
        or secondary.apple_track_id
    )

    title = (
        primary.title
        if primary.provider
        .startswith(
            "deezer",
        )
        else secondary.title
    )

    artist = (
        primary.artist
        if primary.provider
        .startswith(
            "deezer",
        )
        else secondary.artist
    )

    return CatalogTrackCandidate(
        key=_candidate_key(
            artist=artist,
            title=title,
            isrc=isrc,
            deezer_track_id=(
                deezer_id
            ),
            apple_track_id=(
                apple_id
            ),
        ),
        title=title,
        artist=artist,
        album=(
            primary.album
            or secondary.album
        ),
        duration_seconds=(
            primary.duration_seconds
            or secondary.duration_seconds
        ),
        artwork_url=(
            primary.artwork_url
            or secondary.artwork_url
        ),
        genre=(
            secondary.genre
            if (
                secondary.provider
                .startswith(
                    "itunes",
                )
                and secondary.genre
            )
            else (
                primary.genre
                or secondary.genre
            )
        ),
        release_year=(
            primary.release_year
            or secondary.release_year
        ),
        explicit=(
            primary.explicit
            if primary.explicit
            is not None
            else secondary.explicit
        ),
        track_number=(
            primary.track_number
            or secondary.track_number
        ),
        disc_number=(
            primary.disc_number
            or secondary.disc_number
        ),
        isrc=isrc,
        deezer_track_id=(
            deezer_id
        ),
        apple_track_id=(
            apple_id
        ),
        provider="deezer+itunes",
        confidence=max(
            primary.confidence,
            secondary.confidence,
        ),
    )


def merge_catalog_candidates(
    deezer: list[CatalogTrackCandidate],
    itunes: list[CatalogTrackCandidate],
    *,
    limit: int,
) -> list[CatalogTrackCandidate]:
    merged: list[
        CatalogTrackCandidate
    ] = []

    used_itunes: set[int] = set()

    for deezer_candidate in deezer:
        deezer_identity = (
            _candidate_identity(
                deezer_candidate.artist,
                deezer_candidate.title,
            )
        )

        match_index = None

        for index, apple_candidate in enumerate(
            itunes,
        ):
            if index in used_itunes:
                continue

            if (
                _candidate_identity(
                    apple_candidate.artist,
                    apple_candidate.title,
                )
                != deezer_identity
            ):
                continue

            if not _duration_compatible(
                deezer_candidate
                .duration_seconds,
                apple_candidate
                .duration_seconds,
            ):
                continue

            match_index = index
            break

        if match_index is None:
            merged.append(
                deezer_candidate,
            )
            continue

        used_itunes.add(
            match_index,
        )

        merged.append(
            _merge_pair(
                deezer_candidate,
                itunes[
                    match_index
                ],
            )
        )

    for index, candidate in enumerate(
        itunes,
    ):
        if index not in used_itunes:
            merged.append(
                candidate,
            )

    ranked: list[
        CatalogTrackCandidate
    ] = []

    for candidate in merged:
        identity = _candidate_identity(
            candidate.artist,
            candidate.title,
        )

        compatible_index = None

        for index, current in enumerate(
            ranked,
        ):
            if (
                _candidate_identity(
                    current.artist,
                    current.title,
                )
                != identity
            ):
                continue

            if not _duration_compatible(
                current.duration_seconds,
                candidate.duration_seconds,
            ):
                continue

            compatible_index = index
            break

        if compatible_index is None:
            ranked.append(
                candidate,
            )

            continue

        if (
            candidate.confidence
            > ranked[
                compatible_index
            ].confidence
        ):
            ranked[
                compatible_index
            ] = candidate

    ranked.sort(
        key=lambda candidate: (
            -candidate.confidence,
            candidate.artist.casefold(),
            candidate.title.casefold(),
        )
    )

    return ranked[
        :max(
            0,
            limit,
        )
    ]


def rank_catalog_candidates_for_kind(
    candidates: list[CatalogTrackCandidate],
    *,
    query: str,
    kind: str,
    limit: int,
) -> list[CatalogTrackCandidate]:
    normalized_query = _normalized_text(
        query,
    )

    normalized_kind = (
        kind.strip().casefold()
        if kind
        else "song"
    )

    if normalized_kind == "song":
        return candidates[
            :max(
                0,
                limit,
            )
        ]

    ranked: list[
        tuple[
            float,
            CatalogTrackCandidate,
        ]
    ] = []

    for candidate in candidates:
        if normalized_kind == "artist":
            field = _primary_artist_credit(
                candidate.artist,
            )

            normalized_field = (
                _normalized_text(
                    field,
                )
            )

            if (
                not normalized_query
                or normalized_field
                != normalized_query
            ):
                continue

            score = 1.0

        elif normalized_kind == "album":
            if not candidate.album:
                continue

            field = (
                f"{candidate.artist} "
                f"{candidate.album}"
            )

            normalized_field = (
                _normalized_text(
                    field,
                )
            )

            score = max(
                _similarity(
                    query,
                    candidate.album,
                ),
                _similarity(
                    query,
                    field,
                ),
            )

            if (
                normalized_query
                and normalized_query
                in normalized_field
            ):
                score = max(
                    score,
                    0.96,
                )

            if score < 0.52:
                continue

        else:
            return candidates[
                :max(
                    0,
                    limit,
                )
            ]

        ranked.append(
            (
                score,
                candidate,
            )
        )

    if normalized_kind == "album":
        ranked.sort(
            key=lambda item: (
                -item[0],
                item[1].artist.casefold(),
                (
                    item[1].album
                    or ""
                ).casefold(),
                item[1].disc_number
                or 1,
                item[1].track_number
                or 999,
                item[1].title.casefold(),
            )
        )
    else:
        ranked.sort(
            key=lambda item: (
                -item[0],
                -item[1].confidence,
                item[1].artist.casefold(),
                item[1].title.casefold(),
            )
        )

    return [
        candidate
        for _score, candidate in ranked[
            :max(
                0,
                limit,
            )
        ]
    ]


async def search_catalog_metadata(
    query: str,
    *,
    limit: int = 10,
    kind: str = "song",
) -> list[CatalogTrackCandidate]:
    clean_query = " ".join(
        query.strip().split()
    )

    if len(clean_query) < 2:
        return []

    requested_limit = max(
        1,
        min(
            int(
                limit,
            ),
            500,
        ),
    )

    provider_limit = min(
        max(
            requested_limit,
            8,
        ),
        500,
    )

    artist_only = (
        kind.strip().casefold()
        == "artist"
    )

    deezer, itunes = await asyncio.gather(
        _search_deezer(
            clean_query,
            limit=provider_limit,
            artist_only=artist_only,
        ),
        _search_itunes(
            clean_query,
            limit=provider_limit,
            artist_only=artist_only,
        ),
    )

    merged = merge_catalog_candidates(
        deezer,
        itunes,
        limit=min(
            700,
            provider_limit
            + min(
                provider_limit,
                200,
            ),
        ),
    )

    return rank_catalog_candidates_for_kind(
        merged,
        query=clean_query,
        kind=kind,
        limit=requested_limit,
    )


async def resolve_exact_track_metadata(
    *,
    title: str,
    artist: str,
    duration_seconds: int | None = None,
) -> CatalogTrackCandidate | None:
    query = (
        f"{artist.strip()} "
        f"{title.strip()}"
    ).strip()

    candidates = (
        await search_catalog_metadata(
            query,
            limit=12,
        )
    )

    wanted_identity = (
        _candidate_identity(
            artist,
            title,
        )
    )

    ranked: list[
        tuple[
            float,
            CatalogTrackCandidate,
        ]
    ] = []

    for candidate in candidates:
        if (
            _candidate_identity(
                candidate.artist,
                candidate.title,
            )
            != wanted_identity
        ):
            continue

        duration_score = 1.0

        if (
            duration_seconds
            and candidate
            .duration_seconds
        ):
            delta = abs(
                int(
                    duration_seconds,
                )
                - candidate
                .duration_seconds
            )

            if delta > 15:
                continue

            duration_score = max(
                0.0,
                1.0
                - delta / 20,
            )

        score = (
            candidate.confidence
            * 0.8
            + duration_score
            * 0.2
        )

        ranked.append(
            (
                score,
                candidate,
            )
        )

    if not ranked:
        return None

    ranked.sort(
        key=lambda item: (
            -item[0],
            item[1].provider,
        )
    )

    return ranked[0][1]
