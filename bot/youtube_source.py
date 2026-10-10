from __future__ import annotations

import asyncio
import mimetypes
import os
import re
import tempfile
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast
from urllib.parse import urlsplit

import yt_dlp

from backend.app.config import get_settings
from backend.app.services.audio_metadata import (
    normalize_track_identity,
    normalize_track_title_identity,
)
from backend.app.services.on_demand_metadata import (
    CatalogTrackCandidate,
)

_REJECT_TERMS = (
    "live",
    "remix",
    "sped up",
    "sped-up",
    "slowed",
    "reverb",
    "nightcore",
    "karaoke",
    "instrumental",
    "cover",
    "reaction",
    "8d audio",
    "bass boosted",
    "fan made",
    "fanmade",
    "concert",
    "performance",
)

_PREFERRED_TERMS = (
    "official audio",
    "official music",
    "provided to youtube",
    "topic",
    "audio",
)


@dataclass(frozen=True)
class YouTubeSource:
    webpage_url: str
    direct_url: str
    title: str
    uploader: str
    duration_seconds: int | None
    score: float
    source_id: str
    extension: str | None
    mime_type: str | None
    http_headers: dict[str, str]


@dataclass(frozen=True)
class DownloadedAudio:
    content: bytes
    filename: str
    mime_type: str


def _normalize(
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


def is_allowed_direct_media_url(
    value: object,
) -> bool:
    if not isinstance(
        value,
        str,
    ):
        return False

    parsed = urlsplit(
        value,
    )

    host = (
        parsed.hostname
        or ""
    ).casefold().rstrip(
        ".",
    )

    return (
        parsed.scheme
        == "https"
        and (
            host
            == "googlevideo.com"
            or host.endswith(
                ".googlevideo.com",
            )
        )
    )


def _duration(
    value: object,
) -> int | None:
    try:
        number = float(
            cast(str, value),
        )
    except (
        TypeError,
        ValueError,
    ):
        return None

    if number <= 0:
        return None

    return round(
        number,
    )


def _requested_version_terms(
    title: str,
) -> set[str]:
    normalized = _normalize(
        title,
    )

    return {
        term
        for term in _REJECT_TERMS
        if _normalize(
            term,
        ) in normalized
    }


def score_source_candidate(
    item: dict[str, Any],
    metadata: CatalogTrackCandidate,
) -> float:
    title = str(
        item.get(
            "title",
        )
        or ""
    ).strip()

    uploader = str(
        item.get(
            "uploader",
        )
        or item.get(
            "channel",
        )
        or ""
    ).strip()

    if not title:
        return -1000.0

    normalized_title = _normalize(
        title,
    )

    normalized_uploader = _normalize(
        uploader,
    )

    wanted_artist = normalize_track_identity(
        metadata.artist,
    )

    wanted_title = normalize_track_title_identity(
        metadata.title,
    )

    source_root = normalize_track_title_identity(
        title,
    )

    score = 0.0

    if source_root == wanted_title:
        score += 55.0

    elif (
        wanted_title
        and wanted_title
        in source_root
    ):
        score += 34.0

    elif (
        wanted_title
        and wanted_title
        in normalized_title
    ):
        score += 24.0

    else:
        score -= 30.0

    artist_tokens = [
        token
        for token in wanted_artist.split()
        if len(token) >= 2
    ]

    artist_blob = (
        normalized_title
        + " "
        + normalized_uploader
    )

    if (
        wanted_artist
        and wanted_artist
        in artist_blob
    ):
        score += 24.0

    elif (
        artist_tokens
        and all(
            token in artist_blob
            for token in artist_tokens
        )
    ):
        score += 16.0

    else:
        score -= 20.0

    candidate_duration = _duration(
        item.get(
            "duration",
        )
    )

    wanted_duration = (
        metadata.duration_seconds
    )

    if (
        candidate_duration
        and wanted_duration
    ):
        delta = abs(
            candidate_duration
            - wanted_duration
        )

        if delta <= 3:
            score += 24.0
        elif delta <= 7:
            score += 16.0
        elif delta <= 12:
            score += 8.0
        elif delta <= 20:
            score -= 8.0
        else:
            score -= 45.0

    requested_versions = (
        _requested_version_terms(
            metadata.title,
        )
    )

    if requested_versions:
        matched_requested_version = (
            any(
                _normalize(
                    term,
                )
                in normalized_title
                for term in requested_versions
            )
        )

        score += (
            24.0
            if matched_requested_version
            else -24.0
        )

    for term in _REJECT_TERMS:
        normalized_term = _normalize(
            term,
        )

        if (
            normalized_term
            and normalized_term
            in normalized_title
            and term
            not in requested_versions
        ):
            score -= 55.0

    preferred_blob = (
        normalized_title
        + " "
        + normalized_uploader
    )

    for term in _PREFERRED_TERMS:
        if _normalize(
            term,
        ) in preferred_blob:
            score += 7.0

    if (
        normalized_uploader.endswith(
            " topic",
        )
        or "vevo"
        in normalized_uploader
    ):
        score += 12.0

    view_count = item.get(
        "view_count",
    )

    try:
        views = int(
            view_count
            or 0
        )
    except (
        TypeError,
        ValueError,
    ):
        views = 0

    if views >= 1_000_000:
        score += 4.0
    elif views >= 100_000:
        score += 2.0

    return score


def rank_source_candidates(
    entries: list[dict[str, Any]],
    metadata: CatalogTrackCandidate,
) -> list[tuple[float, dict[str, Any]]]:
    ranked = [
        (
            score_source_candidate(
                item,
                metadata,
            ),
            item,
        )
        for item in entries
        if isinstance(
            item,
            dict,
        )
    ]

    ranked.sort(
        key=lambda item: (
            -item[0],
            str(
                item[1].get(
                    "title",
                    "",
                )
            ).casefold(),
        )
    )

    return ranked


def _cookies_option() -> dict[str, str]:
    settings = get_settings()

    cookies_file = (
        settings
        .yt_dlp_cookies_file
        .strip()
    )

    if not cookies_file:
        return {}

    path = Path(
        cookies_file,
    ).expanduser()

    if not path.exists():
        return {}

    return {
        "cookiefile":
            str(
                path,
            ),
    }


def _deno_runtime_options() -> dict[str, dict[str, str]]:
    configured = os.environ.get(
        "YT_DLP_DENO_PATH",
        "",
    ).strip()

    if configured:
        configured_path = Path(
            configured,
        ).expanduser()

        if configured_path.is_file():
            return {
                "deno": {
                    "path": str(
                        configured_path,
                    ),
                },
            }

    if os.name == "nt":
        default_path = (
            Path.home()
            / ".deno"
            / "bin"
            / "deno.exe"
        )

        if default_path.is_file():
            return {
                "deno": {
                    "path": str(
                        default_path,
                    ),
                },
            }

    return {
        "deno": {},
    }


def _common_options() -> dict[str, Any]:
    settings = get_settings()

    return {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "socket_timeout":
            float(
                settings
                .yt_dlp_socket_timeout_seconds
            ),
        "retries": 1,
        "fragment_retries": 1,
        "js_runtimes": _deno_runtime_options(),
        **_cookies_option(),
    }


def _source_search_queries(
    metadata: CatalogTrackCandidate,
) -> tuple[str, ...]:
    queries = (
        f"{metadata.artist} {metadata.title} official audio",
        f"{metadata.title} {metadata.artist}",
        f"{metadata.artist} {metadata.title}",
        f"{metadata.title} official audio",
    )

    return tuple(
        dict.fromkeys(
            " ".join(query.split())
            for query in queries
            if query.strip()
        )
    )


def _search_sync(
    metadata: CatalogTrackCandidate,
    *,
    query: str | None = None,
) -> list[dict[str, Any]]:
    settings = get_settings()

    search_count = max(
        3,
        min(
            int(
                settings
                .yt_dlp_search_results
            ),
            15,
        ),
    )

    if query is None:
        query = (
            f"{metadata.artist} "
            f"{metadata.title} "
            "official audio"
        )

    options = {
        **_common_options(),
        "extract_flat":
            "in_playlist",
        "skip_download":
            True,
    }

    with yt_dlp.YoutubeDL(
        cast(Any, options),
    ) as ydl:
        payload = ydl.extract_info(
            (
                f"ytsearch{search_count}:"
                f"{query}"
            ),
            download=False,
        )

    entries = (
        payload.get(
            "entries",
        )
        if isinstance(
            payload,
            dict,
        )
        else None
    )

    return cast(list[dict[str, Any]], [
        entry
        for entry in (
            entries
            if isinstance(
                entries,
                list,
            )
            else []
        )
        if isinstance(
            entry,
            dict,
        )
    ])


def _webpage_url(
    item: dict[str, Any],
) -> str | None:
    for field in (
        "webpage_url",
        "url",
    ):
        raw = item.get(
            field,
        )

        if (
            isinstance(
                raw,
                str,
            )
            and raw.startswith(
                (
                    "http://",
                    "https://",
                )
            )
        ):
            return raw

    raw_id = item.get(
        "id",
    )

    if raw_id:
        return (
            "https://www.youtube.com/"
            "watch?v="
            + str(
                raw_id,
            )
        )

    return None


def _candidate_deduplication_key(
    item: dict[str, Any],
) -> str:
    for field in (
        "id",
        "webpage_url",
        "url",
    ):
        value = item.get(field)
        if value:
            return str(value)

    title = str(item.get("title") or "")
    uploader = str(item.get("uploader") or item.get("channel") or "")
    return title + "\x1f" + uploader


def _resolve_sync(
    metadata: CatalogTrackCandidate,
) -> YouTubeSource:
    # Some tracks are indexed under a different title/artist order or
    # without the "official audio" suffix. Retry only when the first
    # search does not produce a strong match; keep the same scoring and
    # rejection rules across every query.
    entries_by_key: dict[str, dict[str, Any]] = {}
    ranked: list[tuple[float, dict[str, Any]]] = []

    for query in _source_search_queries(metadata):
        for item in _search_sync(
            metadata,
            query=query,
        ):
            item_id = _candidate_deduplication_key(item)
            entries_by_key.setdefault(item_id, item)

        ranked = rank_source_candidates(
            list(entries_by_key.values()),
            metadata,
        )
        # Avoid extra upstream requests when the initial results already
        # contain a strong candidate. We still search again for borderline
        # results instead of rejecting a valid recording prematurely.
        if ranked and ranked[0][0] >= 65.0:
            break

    if (
        not ranked
        or ranked[0][0] < 38.0
    ):
        raise RuntimeError(
            "No clean, high-confidence "
            "YouTube audio source matched "
            "the requested recording."
        )

    score, selected = ranked[0]

    webpage_url = _webpage_url(
        selected,
    )

    if not webpage_url:
        raise RuntimeError(
            "The selected YouTube result "
            "does not have a usable URL."
        )

    options = {
        **_common_options(),
        "format":
            (
                "bestaudio[ext=m4a][acodec^=mp4a]/"
                "bestaudio[ext=m4a]/"
                "bestaudio[acodec!=none]/"
                "bestaudio/best"
            ),
        "skip_download":
            True,
    }

    with yt_dlp.YoutubeDL(
        cast(Any, options),
    ) as ydl:
        info = ydl.extract_info(
            webpage_url,
            download=False,
        )

    if not isinstance(
        info,
        dict,
    ):
        raise RuntimeError(
            "yt-dlp returned invalid source data."
        )

    direct_url = info.get(
        "url",
    )

    if not isinstance(direct_url, str) or not is_allowed_direct_media_url(
        direct_url,
    ):
        raise RuntimeError(
            "yt-dlp did not resolve an allowed "
            "HTTPS YouTube media stream."
        )

    raw_headers = info.get(
        "http_headers",
    )

    headers = {
        str(
            key,
        ):
        str(
            value,
        )
        for key, value in (
            raw_headers.items()
            if isinstance(
                raw_headers,
                dict,
            )
            else []
        )
        if key and value
    }

    extension = (
        str(
            info.get(
                "ext",
            )
            or ""
        ).strip()
        or None
    )

    mime_type = (
        mimetypes.guess_type(
            "audio."
            + (
                extension
                or ""
            )
        )[0]
        if extension
        else None
    )

    source_id = str(
        info.get(
            "id",
        )
        or selected.get(
            "id",
        )
        or ""
    ).strip()

    return YouTubeSource(
        webpage_url=webpage_url,
        direct_url=direct_url,
        title=str(
            info.get(
                "title",
            )
            or selected.get(
                "title",
            )
            or metadata.title
        ),
        uploader=str(
            info.get(
                "uploader",
            )
            or info.get(
                "channel",
            )
            or selected.get(
                "uploader",
            )
            or selected.get(
                "channel",
            )
            or ""
        ),
        duration_seconds=(
            _duration(
                info.get(
                    "duration",
                )
            )
            or _duration(
                selected.get(
                    "duration",
                )
            )
        ),
        score=score,
        source_id=source_id,
        extension=extension,
        mime_type=mime_type,
        http_headers=headers,
    )


async def resolve_youtube_source(
    metadata: CatalogTrackCandidate,
) -> YouTubeSource:
    settings = get_settings()

    return await asyncio.wait_for(
        asyncio.to_thread(
            _resolve_sync,
            metadata,
        ),
        timeout=max(
            float(
                settings
                .on_demand_source_timeout_seconds
            ),
            1.0,
        ),
    )


def _download_sync(
    source: YouTubeSource,
) -> DownloadedAudio:
    with tempfile.TemporaryDirectory(
        prefix="hypersynced-ytdlp-",
    ) as temp_dir:
        output_template = str(
            Path(
                temp_dir,
            )
            / "%(id)s.%(ext)s"
        )

        options = {
            **_common_options(),
            "format":
                (
                    "bestaudio[ext=m4a][acodec^=mp4a]/"
                    "bestaudio[ext=m4a]/"
                    "bestaudio[acodec!=none]/"
                    "bestaudio/best"
                ),
            "outtmpl":
                output_template,
            "overwrites":
                True,
        }

        with yt_dlp.YoutubeDL(
            cast(Any, options),
        ) as ydl:
            info = ydl.extract_info(
                source.webpage_url,
                download=True,
            )

            if not isinstance(
                info,
                dict,
            ):
                raise RuntimeError(
                    "yt-dlp returned invalid "
                    "download information."
                )

            path = Path(
                ydl.prepare_filename(
                    info,
                )
            )

        if (
            not path.exists()
            or not path.is_file()
        ):
            matches = [
                item
                for item in Path(
                    temp_dir,
                ).iterdir()
                if item.is_file()
            ]

            if not matches:
                raise RuntimeError(
                    "yt-dlp did not create "
                    "an audio file."
                )

            path = max(
                matches,
                key=lambda item:
                    item.stat().st_size,
            )

        content = path.read_bytes()

        if not content:
            raise RuntimeError(
                "Downloaded audio is empty."
            )

        mime_type = (
            mimetypes.guess_type(
                path.name,
            )[0]
            or source.mime_type
            or "application/octet-stream"
        )

        return DownloadedAudio(
            content=content,
            filename=path.name,
            mime_type=mime_type,
        )


async def download_youtube_audio(
    source: YouTubeSource,
) -> DownloadedAudio:
    return await asyncio.to_thread(
        _download_sync,
        source,
    )
