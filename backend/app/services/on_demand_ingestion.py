from __future__ import annotations

import asyncio
import contextlib
import hmac
import secrets
import time
from dataclasses import (
    dataclass,
    field,
)
from typing import Any
from urllib.parse import urlsplit
from uuid import UUID, uuid4

import httpx
from bot.service import (
    job_completed,
    job_failed,
    job_started,
    queue_job,
)
from bot.youtube_source import (
    DownloadedAudio,
    YouTubeSource,
    download_youtube_audio,
    resolve_youtube_source,
)

from ..config import get_settings
from ..database import get_session_factory
from ..models.account import (
    ListeningEvent,
)
from ..models.media import Track
from .catalog_ingestion import (
    find_duplicate_track,
    publish_authorized_audio,
)
from .media_identity import (
    existing_primary_title_keys,
    track_identity_keys,
)
from .on_demand_metadata import (
    CatalogTrackCandidate,
    search_catalog_metadata,
)
from .playback_realtime import (
    playback_realtime_hub,
)


@dataclass
class ProvisionSession:
    id: UUID
    candidate: CatalogTrackCandidate
    state: str
    created_at: float
    updated_at: float
    stream_token: str
    source: YouTubeSource | None = None
    track_id: UUID | None = None
    error: str | None = None
    ingest_started: bool = False
    source_task: asyncio.Task | None = field(
        default=None,
        repr=False,
    )
    ingest_task: asyncio.Task | None = field(
        default=None,
        repr=False,
    )
    pending_listener_user_ids: set[
        UUID
    ] = field(
        default_factory=set,
        repr=False,
    )


_lock = asyncio.Lock()

_candidates: dict[
    str,
    CatalogTrackCandidate,
] = {}

_sessions_by_key: dict[
    str,
    ProvisionSession,
] = {}

_sessions_by_id: dict[
    UUID,
    ProvisionSession,
] = {}

_background_warm_tasks: set[
    asyncio.Task[Any]
] = set()


def _track_background_warm_task(
    task: asyncio.Task[Any],
) -> asyncio.Task[Any]:
    _background_warm_tasks.add(
        task,
    )

    task.add_done_callback(
        _background_warm_tasks.discard,
    )

    return task


def _now() -> float:
    return time.monotonic()


def _candidate_identity_key(
    candidate: CatalogTrackCandidate,
) -> tuple[str, str]:
    (
        _artist_key,
        primary_artist_key,
        title_key,
    ) = track_identity_keys(
        title=candidate.title,
        artist=candidate.artist,
    )

    return (
        primary_artist_key,
        title_key,
    )


def _session_snapshot(
    session: ProvisionSession,
) -> dict[str, Any]:
    settings = get_settings()

    return {
        "provision_id":
            str(
                session.id,
            ),
        "candidate_key":
            session.candidate.key,
        "state":
            session.state,
        "track_id":
            (
                str(
                    session.track_id,
                )
                if session.track_id
                else None
            ),
        "stream_url":
            (
                "/api/on-demand/"
                f"{session.id}/stream"
                "?token="
                f"{session.stream_token}"
                if (
                    session.source
                    is not None
                    and session.state
                    not in {
                        "failed",
                    }
                )
                else None
            ),
        "error":
            session.error,
        "title":
            session.candidate.title,
        "artist":
            session.candidate.artist,
        "album":
            session.candidate.album,
        "duration_seconds":
            session.candidate
            .duration_seconds,
        "artwork_url":
            session.candidate
            .artwork_url,
        "genre":
            session.candidate.genre,
        "release_year":
            session.candidate
            .release_year,
        "provider":
            session.candidate.provider,
        "source_score":
            (
                round(
                    session.source.score,
                    1,
                )
                if session.source
                is not None
                else None
            ),
        "source_title":
            (
                session.source.title
                if session.source
                is not None
                else None
            ),
        "expires_in_seconds":
            max(
                0,
                int(
                    settings
                    .on_demand_session_ttl_seconds
                    - (
                        _now()
                        - session.updated_at
                    )
                ),
            ),
    }


async def _cleanup_expired_locked() -> None:
    settings = get_settings()

    ttl = max(
        int(
            settings
            .on_demand_session_ttl_seconds
        ),
        60,
    )

    cutoff = _now() - ttl

    expired_ids: list[UUID] = []

    for session_id, session in (
        _sessions_by_id.items()
    ):
        if (
            session.updated_at >= cutoff
            or session.state
            in {
                "resolving",
                "ingesting",
            }
        ):
            continue

        expired_ids.append(
            session_id,
        )

    for session_id in expired_ids:
        session = _sessions_by_id.pop(
            session_id,
            None,
        )

        if session is None:
            continue

        current = _sessions_by_key.get(
            session.candidate.key,
        )

        if current is session:
            _sessions_by_key.pop(
                session.candidate.key,
                None,
            )


async def remember_candidates(
    candidates: list[
        CatalogTrackCandidate
    ],
) -> None:
    async with _lock:
        await _cleanup_expired_locked()

        for candidate in candidates:
            _candidates[
                candidate.key
            ] = candidate


async def candidate_for_key(
    key: str,
) -> CatalogTrackCandidate | None:
    clean = key.strip()

    if not clean:
        return None

    async with _lock:
        return _candidates.get(
            clean,
        )


async def _find_existing_track(
    candidate: CatalogTrackCandidate,
) -> Track | None:
    session_factory = (
        get_session_factory()
    )

    async with session_factory() as session:
        return await find_duplicate_track(
            session,
            title=candidate.title,
            artist=candidate.artist,
        )


async def _resolve_source(
    session: ProvisionSession,
) -> None:
    try:
        existing = (
            await _find_existing_track(
                session.candidate,
            )
        )

        if existing is not None:
            async with _lock:
                session.track_id = (
                    existing.id
                )

                session.state = "ready"

                session.updated_at = (
                    _now()
                )

            return

        source = (
            await resolve_youtube_source(
                session.candidate,
            )
        )

        async with _lock:
            session.source = source

            if session.state not in {
                "failed",
                "ready",
            }:
                session.state = (
                    "stream-ready"
                )

            session.updated_at = (
                _now()
            )

    except Exception as exc:
        async with _lock:
            session.state = "failed"

            session.error = (
                str(
                    exc,
                )[:500]
            )

            session.updated_at = (
                _now()
            )

        raise


def is_allowed_artwork_url(
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

    allowed_suffixes = (
        "dzcdn.net",
        "mzstatic.com",
    )

    return (
        parsed.scheme
        == "https"
        and any(
            host == suffix
            or host.endswith(
                "." + suffix,
            )
            for suffix
            in allowed_suffixes
        )
    )


async def _fetch_artwork(
    url: str | None,
) -> tuple[
    bytes | None,
    str | None,
]:
    if not url:
        return (
            None,
            None,
        )

    if not is_allowed_artwork_url(
        url,
    ):
        return (
            None,
            None,
        )

    try:
        async with httpx.AsyncClient(
            timeout=8.0,
            follow_redirects=True,
        ) as client:
            async with client.stream(
                "GET",
                url,
                headers={
                    "Accept":
                        "image/*",
                },
            ) as response:
                response.raise_for_status()

                if not is_allowed_artwork_url(
                    str(
                        response.url,
                    )
                ):
                    return (
                        None,
                        None,
                    )

                mime_type = (
                    response.headers.get(
                        "content-type",
                        "",
                    )
                    .split(
                        ";",
                        1,
                    )[0]
                    .strip()
                    .lower()
                )

                if not mime_type.startswith(
                    "image/",
                ):
                    return (
                        None,
                        None,
                    )

                data = bytearray()

                async for chunk in (
                    response.aiter_bytes()
                ):
                    data.extend(
                        chunk,
                    )

                    if len(data) > (
                        10 * 1024 * 1024
                    ):
                        return (
                            None,
                            None,
                        )

        return (
            bytes(
                data,
            ),
            mime_type,
        )

    except (
        httpx.HTTPError,
        ValueError,
    ):
        return (
            None,
            None,
        )


async def _record_listening_event(
    track_id: UUID,
    user_id: UUID,
) -> None:
    session_factory = (
        get_session_factory()
    )

    async with session_factory() as db:
        db.add(
            ListeningEvent(
                user_id=user_id,
                track_id=track_id,
            )
        )

        await db.commit()

    await playback_realtime_hub.broadcast(
        user_id,
        {
            "type":
                "listening_history_changed",
            "track_id":
                str(
                    track_id,
                ),
        },
    )


async def _run_ingest(
    session: ProvisionSession,
) -> None:
    job_name = (
        "ingest: "
        + session.candidate.artist
        + " - "
        + session.candidate.title
    )

    queue_job()

    job_started(
        job_name,
    )

    try:
        source = session.source

        if source is None:
            await _ensure_source(
                session,
            )

            source = session.source

        if source is None:
            raise RuntimeError(
                "Audio source is not ready."
            )

        async with _lock:
            session.state = "ingesting"

            session.updated_at = (
                _now()
            )

        audio_task = asyncio.create_task(
            download_youtube_audio(
                source,
            )
        )

        artwork_task = (
            asyncio.create_task(
                _fetch_artwork(
                    session.candidate
                    .artwork_url,
                )
            )
        )

        audio, artwork = (
            await asyncio.gather(
                audio_task,
                artwork_task,
            )
        )

        if not isinstance(
            audio,
            DownloadedAudio,
        ):
            raise RuntimeError(
                "Audio acquisition did not "
                "return a valid file."
            )

        artwork_data, artwork_type = (
            artwork
        )

        result = (
            await publish_authorized_audio(
                metadata=session.candidate,
                audio_content=(
                    audio.content
                ),
                audio_filename=(
                    audio.filename
                ),
                audio_mime_type=(
                    audio.mime_type
                ),
                artwork_data=(
                    artwork_data
                ),
                artwork_mime_type=(
                    artwork_type
                ),
                source_provider=(
                    "youtube"
                ),
                source_id=(
                    source.source_id
                    or None
                ),
            )
        )

        async with _lock:
            session.track_id = (
                result.track_id
            )

            session.error = None

            pending_listener_user_ids = (
                set(
                    session
                    .pending_listener_user_ids
                )
            )

            session.pending_listener_user_ids.clear()

            session.updated_at = (
                _now()
            )

        if pending_listener_user_ids:
            await asyncio.gather(
                *[
                    _record_listening_event(
                        result.track_id,
                        user_id,
                    )
                    for user_id
                    in pending_listener_user_ids
                ],
                return_exceptions=True,
            )

        async with _lock:
            session.state = "ready"

            session.updated_at = (
                _now()
            )

        job_completed(
            (
                "Catalog ingest complete: "
                f"{result.artist} - "
                f"{result.title}."
            )
        )

    except Exception as exc:
        async with _lock:
            session.state = "failed"

            session.error = (
                str(
                    exc,
                )[:500]
            )

            session.updated_at = (
                _now()
            )

        job_failed(
            (
                "Catalog ingest failed: "
                f"{session.candidate.artist} - "
                f"{session.candidate.title}: "
                f"{str(exc)[:300]}"
            )
        )

    finally:
        async with _lock:
            if (
                session.ingest_task
                is asyncio.current_task()
            ):
                session.ingest_task = (
                    None
                )


async def _ensure_source(
    session: ProvisionSession,
) -> None:
    async with _lock:
        if (
            session.source is not None
            or session.state == "ready"
        ):
            return

        if (
            session.source_task
            is None
        ):
            session.state = "resolving"

            session.updated_at = (
                _now()
            )

            session.source_task = (
                asyncio.create_task(
                    _resolve_source(
                        session,
                    )
                )
            )

        task = session.source_task

    try:
        await task

    finally:
        async with _lock:
            if session.source_task is task:
                session.source_task = None


async def _ensure_ingest(
    session: ProvisionSession,
) -> None:
    async with _lock:
        if (
            session.track_id
            is not None
            or session.ingest_started
            or session.state == "failed"
        ):
            return

        session.ingest_started = True

        session.ingest_task = (
            asyncio.create_task(
                _run_ingest(
                    session,
                )
            )
        )


async def get_or_create_session(
    candidate: CatalogTrackCandidate,
) -> ProvisionSession:
    async with _lock:
        await _cleanup_expired_locked()

        existing = (
            _sessions_by_key.get(
                candidate.key,
            )
        )

        if (
            existing is not None
            and existing.state
            != "failed"
        ):
            existing.updated_at = (
                _now()
            )

            return existing

        now = _now()

        session = ProvisionSession(
            id=uuid4(),
            candidate=candidate,
            state="queued",
            created_at=now,
            updated_at=now,
            stream_token=(
                secrets.token_urlsafe(
                    32,
                )
            ),
        )

        _sessions_by_key[
            candidate.key
        ] = session

        _sessions_by_id[
            session.id
        ] = session

        _candidates[
            candidate.key
        ] = candidate

        return session


async def prewarm_candidate(
    candidate: CatalogTrackCandidate,
) -> None:
    session = (
        await get_or_create_session(
            candidate,
        )
    )

    try:
        await _ensure_source(
            session,
        )

    except Exception:
        # Prewarming is speculative. A failure
        # should not break the search response.
        return


async def prewarm_candidates(
    candidates: list[
        CatalogTrackCandidate
    ],
) -> None:
    settings = get_settings()

    limit = max(
        0,
        min(
            int(
                settings
                .on_demand_prewarm_limit
            ),
            len(
                candidates,
            ),
        ),
    )

    for candidate in candidates[
        :limit
    ]:
        _track_background_warm_task(
            asyncio.create_task(
                prewarm_candidate(
                    candidate,
                )
            )
        )


async def _warm_sessions_in_background(
    sessions: list[ProvisionSession],
    *,
    concurrency: int,
) -> None:
    semaphore = asyncio.Semaphore(
        max(
            1,
            min(
                int(
                    concurrency,
                ),
                32,
            ),
        )
    )

    async def warm_one(
        session: ProvisionSession,
    ) -> None:
        async with semaphore:
            try:
                await _ensure_source(
                    session,
                )
            except Exception:
                # Opening a metadata playlist is
                # speculative. Clicking a track
                # will retry preparation if needed.
                return

    await asyncio.gather(
        *[
            warm_one(
                session,
            )
            for session
            in sessions
        ],
        return_exceptions=True,
    )


async def warm_candidate_keys(
    candidate_keys: list[str],
) -> list[dict[str, Any]]:
    settings = get_settings()

    clean_keys = list(
        dict.fromkeys(
            key.strip()
            for key in candidate_keys
            if key
            and key.strip()
        )
    )[:500]

    candidates = [
        candidate
        for key in clean_keys
        for candidate in [
            await candidate_for_key(
                key,
            )
        ]
        if candidate is not None
    ]

    sessions = [
        await get_or_create_session(
            candidate,
        )
        for candidate
        in candidates
    ]

    if sessions:
        task = asyncio.create_task(
            _warm_sessions_in_background(
                sessions,
                concurrency=(
                    settings
                    .on_demand_prewarm_limit
                ),
            )
        )

        _track_background_warm_task(
            task,
        )

    return [
        _session_snapshot(
            session,
        )
        for session
        in sessions
    ]


async def search_and_remember(
    query: str,
    *,
    limit: int | None = None,
    kind: str = "song",
    prewarm: bool = True,
) -> list[CatalogTrackCandidate]:
    settings = get_settings()

    candidates = (
        await search_catalog_metadata(
            query,
            kind=kind,
            limit=(
                limit
                if limit
                is not None
                else settings
                .on_demand_search_limit
            ),
        )
    )

    session_factory = (
        get_session_factory()
    )

    candidate_keys = {
        key
        for candidate
        in candidates
        for key
        in [
            _candidate_identity_key(
                candidate,
            )
        ]
        if all(
            key,
        )
    }

    async with session_factory() as session:
        existing_identities = (
            await existing_primary_title_keys(
                session,
                candidate_keys,
            )
        )

    missing = [
        candidate
        for candidate
        in candidates
        if _candidate_identity_key(
            candidate,
        )
        not in existing_identities
    ]

    await remember_candidates(
        missing,
    )

    if prewarm:
        await prewarm_candidates(
            missing,
        )

    return missing


async def prepare_candidate(
    candidate_key: str,
    *,
    start_ingest: bool = False,
) -> dict[str, Any]:
    candidate = (
        await candidate_for_key(
            candidate_key,
        )
    )

    if candidate is None:
        raise KeyError(
            "The search result expired. "
            "Search for the song again."
        )

    session = (
        await get_or_create_session(
            candidate,
        )
    )

    await _ensure_source(
        session,
    )

    # Preparing a temporary stream must stay
    # metadata/source-only for normal users.
    # Explicit admin ingest can still start
    # publication immediately.
    if (
        start_ingest
        and session.track_id is None
        and session.state != "failed"
    ):
        await _ensure_ingest(
            session,
        )

    return _session_snapshot(
        session,
    )


async def ingest_candidate_and_wait(
    candidate_key: str,
) -> dict[str, Any]:
    candidate = (
        await candidate_for_key(
            candidate_key,
        )
    )

    if candidate is None:
        raise KeyError(
            "The catalog candidate expired."
        )

    session = (
        await get_or_create_session(
            candidate,
        )
    )

    await _ensure_source(
        session,
    )

    if (
        session.track_id is None
        and session.state != "failed"
    ):
        await _ensure_ingest(
            session,
        )

    async with _lock:
        task = session.ingest_task

    if task is not None:
        await asyncio.shield(
            task,
        )

    return _session_snapshot(
        session,
    )


async def get_provision_session(
    provision_id: UUID,
) -> ProvisionSession | None:
    async with _lock:
        await _cleanup_expired_locked()

        session = (
            _sessions_by_id.get(
                provision_id,
            )
        )

        if session is not None:
            session.updated_at = (
                _now()
            )

        return session


async def record_provision_play(
    provision_id: UUID,
    user_id: UUID,
) -> dict[str, Any] | None:
    session = (
        await get_provision_session(
            provision_id,
        )
    )

    if session is None:
        return None

    track_id: UUID | None = None

    async with _lock:
        track_id = session.track_id

        if track_id is None:
            session.pending_listener_user_ids.add(
                user_id,
            )

            session.updated_at = (
                _now()
            )

    if track_id is not None:
        await _record_listening_event(
            track_id,
            user_id,
        )
    elif session.state != "failed":
        await _ensure_ingest(
            session,
        )

    return {
        "recorded":
            track_id is not None,
        "pending":
            track_id is None
            and session.state != "failed",
        "track_id":
            (
                str(
                    track_id,
                )
                if track_id
                is not None
                else None
            ),
    }


async def provision_status(
    provision_id: UUID,
) -> dict[str, Any] | None:
    session = (
        await get_provision_session(
            provision_id,
        )
    )

    if session is None:
        return None

    return _session_snapshot(
        session,
    )


async def active_provisions() -> list[
    dict[str, Any]
]:
    async with _lock:
        await _cleanup_expired_locked()

        sessions = list(
            _sessions_by_id.values()
        )

    sessions.sort(
        key=lambda item:
            item.updated_at,
        reverse=True,
    )

    return [
        _session_snapshot(
            session,
        )
        for session in sessions[
            :50
        ]
    ]


def stream_token_matches(
    session: ProvisionSession,
    token: str,
) -> bool:
    return hmac.compare_digest(
        session.stream_token,
        token,
    )


def source_headers(
    source: YouTubeSource,
) -> dict[str, str]:
    allowed = {
        "user-agent",
        "referer",
        "origin",
        "accept",
        "accept-language",
    }

    result = {
        str(
            key,
        ):
        str(
            value,
        )
        for key, value in (
            source.http_headers.items()
        )
        if str(
            key,
        ).casefold()
        in allowed
    }

    result.setdefault(
        "Accept",
        "*/*",
    )

    return result


async def reset_transient_state() -> None:
    async with _lock:
        sessions = list(
            _sessions_by_id.values()
        )

        background_tasks = list(
            _background_warm_tasks
        )

        _candidates.clear()

        _sessions_by_key.clear()

        _sessions_by_id.clear()

        _background_warm_tasks.clear()

    for task in background_tasks:
        if not task.done():
            task.cancel()

            with contextlib.suppress(
                asyncio.CancelledError,
            ):
                await task

    for session in sessions:
        for task in (
            session.source_task,
            session.ingest_task,
        ):
            if (
                task is not None
                and not task.done()
            ):
                task.cancel()

                with contextlib.suppress(
                    asyncio.CancelledError,
                ):
                    await task
