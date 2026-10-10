from __future__ import annotations

import asyncio
import base64
import contextlib
import hmac
import time
from dataclasses import (
    asdict,
    dataclass,
    field,
)
from typing import Any
from urllib.parse import urlsplit
from uuid import UUID, uuid4

import httpx
from sqlalchemy import (
    or_,
    select,
    text,
)

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
    is_allowed_direct_media_url,
    resolve_youtube_source,
)

from ..config import get_settings
from ..database import (
    get_engine,
    get_session_factory,
)
from ..models.account import (
    ListeningEvent,
)
from ..models.media import (
    Track,
    TrackIdentity,
)
from .catalog_ingestion import (
    find_duplicate_track,
    publish_authorized_audio,
)
from .media_identity import (
    track_identity_keys,
)
from .on_demand_metadata import (
    CatalogTrackCandidate,
    search_catalog_metadata,
)
from .on_demand_state import (
    add_pending_listener as persist_pending_listener,
)
from .on_demand_state import (
    commit_pending_listeners_to_history,
    list_resumable_provision_ids,
)
from .on_demand_state import (
    get_or_create_provision as get_or_create_durable_provision,
)
from .on_demand_state import (
    list_recent_provisions as list_durable_recent_provisions,
)
from .on_demand_state import (
    load_candidate as load_durable_candidate,
)
from .on_demand_state import (
    load_provision as load_durable_provision,
)
from .on_demand_state import (
    persist_candidates as persist_durable_candidates,
)
from .on_demand_state import (
    save_provision as save_durable_provision,
)
from .on_demand_state import (
    touch_provision as touch_durable_provision,
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

# Serialize yt-dlp source resolution and the download-to-publication pipeline.
# yt-dlp can be memory-heavy, and temporary audio files live on container disk.
_youtube_source_semaphore = asyncio.Semaphore(1)
_youtube_download_semaphore = asyncio.Semaphore(1)


async def _try_acquire_distributed_ingest_lock(
    provision_id: UUID,
):
    """Try to become the one replica allowed to ingest a provision."""

    engine = get_engine()

    if engine.dialect.name != "postgresql":
        return (
            True,
            None,
        )

    connection = await engine.connect()

    try:
        result = await connection.execute(
            text(
                "SELECT pg_try_advisory_lock("
                "hashtext(:lock_key)"
                ")"
            ),
            {
                "lock_key":
                    (
                        "hypersync:on-demand-ingest:"
                        + str(
                            provision_id,
                        )
                    ),
            },
        )

        acquired = bool(
            result.scalar_one(),
        )

        if not acquired:
            await connection.close()

            return (
                False,
                None,
            )

        return (
            True,
            connection,
        )

    except Exception:
        await connection.close()
        raise


async def _release_distributed_ingest_lock(
    provision_id: UUID,
    connection,
) -> None:
    if connection is None:
        return

    try:
        await connection.execute(
            text(
                "SELECT pg_advisory_unlock("
                "hashtext(:lock_key)"
                ")"
            ),
            {
                "lock_key":
                    (
                        "hypersync:on-demand-ingest:"
                        + str(
                            provision_id,
                        )
                    ),
            },
        )
    finally:
        await connection.close()


async def _apply_terminal_durable_provision(
    session: ProvisionSession,
) -> bool:
    durable = await load_durable_provision(
        session.id,
    )

    if durable is None:
        return False

    track_id = durable.get(
        "track_id",
    )
    state = str(
        durable.get(
            "state",
            "",
        )
    )
    error = durable.get(
        "error",
    )

    if isinstance(
        track_id,
        UUID,
    ):
        async with _lock:
            session.track_id = track_id
            session.state = "ready"
            session.error = None
            session.ingest_started = True
            session.updated_at = (
                _now()
            )

        return True

    if state == "failed":
        async with _lock:
            session.state = "failed"
            session.error = (
                str(
                    error,
                )[:500]
                if error is not None
                else (
                    "Ingest failed on another "
                    "backend replica."
                )
            )
            session.ingest_started = True
            session.updated_at = (
                _now()
            )

        return True

    return False


def _now() -> float:
    return time.monotonic()


def _stream_token_for_id(
    provision_id: UUID,
) -> str:
    settings = get_settings()

    secret = (
        settings.bot_jwt_secret.strip()
        or settings.jwt_secret.strip()
    )

    if not secret:
        if settings.environment == "production":
            raise RuntimeError(
                "A JWT secret is required for "
                "durable on-demand stream tokens."
            )

        secret = (
            "hypersync-development-only-"
            "on-demand-stream-secret"
        )

    digest = hmac.digest(
        secret.encode(
            "utf-8",
        ),
        (
            "on-demand-stream:"
            + str(
                provision_id,
            )
        ).encode(
            "utf-8",
        ),
        "sha256",
    )

    return (
        base64.urlsafe_b64encode(
            digest,
        )
        .decode(
            "ascii",
        )
        .rstrip(
            "=",
        )
    )


def _source_from_payload(
    payload: dict[str, Any] | None,
) -> YouTubeSource | None:
    if not payload:
        return None

    try:
        source = YouTubeSource(
            **payload,
        )
    except (
        TypeError,
        ValueError,
    ):
        return None

    if not is_allowed_direct_media_url(
        source.direct_url,
    ):
        return None

    return source


def _session_from_durable(
    payload: dict[str, Any],
) -> ProvisionSession | None:
    candidate = (
        CatalogTrackCandidate
        .from_dict(
            dict(
                payload.get(
                    "candidate_payload",
                )
                or {}
            )
        )
    )

    provision_id = payload.get(
        "id",
    )

    if (
        not candidate.key
        or not isinstance(
            provision_id,
            UUID,
        )
    ):
        return None

    state = str(
        payload.get(
            "state",
            "queued",
        )
    )

    track_id = payload.get(
        "track_id",
    )

    # A persisted "ingesting" flag may outlive the worker
    # that owned it. Reconstructed sessions are allowed to
    # retry; the catalog identity advisory lock still makes
    # final publication idempotent across replicas.
    ingest_started = (
        bool(
            payload.get(
                "ingest_started",
                False,
            )
        )
        if track_id is not None
        else False
    )

    now = _now()

    return ProvisionSession(
        id=provision_id,
        candidate=candidate,
        state=state,
        created_at=now,
        updated_at=now,
        stream_token=(
            _stream_token_for_id(
                provision_id,
            )
        ),
        source=_source_from_payload(
            payload.get(
                "source_payload",
            )
        ),
        track_id=(
            track_id
            if isinstance(
                track_id,
                UUID,
            )
            else None
        ),
        error=(
            str(
                payload.get(
                    "error",
                )
            )
            if payload.get(
                "error",
            )
            is not None
            else None
        ),
        ingest_started=ingest_started,
    )


async def _persist_session(
    session: ProvisionSession,
) -> None:
    source_payload = None

    if session.source is not None:
        source_payload = asdict(
            session.source,
        )

        # Persist only the headers the stream proxy is
        # already willing to forward. Never persist cookies
        # or arbitrary yt-dlp request headers.
        source_payload[
            "http_headers"
        ] = source_headers(
            session.source,
        )

    await save_durable_provision(
        provision_id=session.id,
        candidate=session.candidate,
        state=session.state,
        source_payload=(
            source_payload
        ),
        track_id=session.track_id,
        error=session.error,
        ingest_started=(
            session.ingest_started
        ),
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

    # PostgreSQL is the shared/restart-safe layer; the
    # in-memory map remains the low-latency fallback.
    await persist_durable_candidates(
        candidates,
    )


async def candidate_for_key(
    key: str,
) -> CatalogTrackCandidate | None:
    clean = key.strip()

    if not clean:
        return None

    async with _lock:
        candidate = _candidates.get(
            clean,
        )

    if candidate is not None:
        return candidate

    candidate = await load_durable_candidate(
        clean,
    )

    if candidate is None:
        return None

    async with _lock:
        _candidates[
            clean
        ] = candidate

    return candidate


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

            await _persist_session(
                session,
            )

            return

        async with _youtube_source_semaphore:
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

        await _persist_session(
            session,
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

        await _persist_session(
            session,
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



async def _flush_pending_listener_history(
    session: ProvisionSession,
) -> None:
    track_id = session.track_id

    if track_id is None:
        return

    durable_recorded = (
        await commit_pending_listeners_to_history(
            session.id,
            track_id,
        )
    )

    # None means the durable transaction failed. Leave both
    # durable and local pending state untouched so a later
    # provision read/status poll can safely retry.
    if durable_recorded is None:
        return

    for user_id in durable_recorded:
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

    async with _lock:
        local_only = (
            set(
                session.pending_listener_user_ids
            )
            - durable_recorded
        )

        session.pending_listener_user_ids.difference_update(
            durable_recorded,
        )

    for user_id in local_only:
        try:
            await _record_listening_event(
                track_id,
                user_id,
            )
        except Exception:
            # The local fallback remains pending and can be
            # retried while this process is alive. Durable
            # listeners use the transaction above.
            continue

        async with _lock:
            session.pending_listener_user_ids.discard(
                user_id,
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

    lock_connection = None
    job_accounted = False

    try:
        # Local asyncio locks only coordinate one process.
        # A durable provision can be reconstructed by another
        # API replica after a deploy or concurrent request, so
        # claim the expensive download/transcode work across
        # the whole deployment.
        while True:
            (
                acquired,
                lock_connection,
            ) = (
                await _try_acquire_distributed_ingest_lock(
                    session.id,
                )
            )

            if acquired:
                break

            # The owning replica may already have completed.
            # Mirror its durable terminal state instead of
            # launching duplicate source acquisition work.
            if await _apply_terminal_durable_provision(
                session,
            ):
                return

            await asyncio.sleep(
                0.35,
            )

        # The lock may have become available immediately after
        # the previous owner finished. Re-check durable state
        # after acquiring it before doing any expensive work.
        if await _apply_terminal_durable_provision(
            session,
        ):
            return

        queue_job()
        job_started(
            job_name,
        )
        job_accounted = True

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

        await _persist_session(
            session,
        )

        async with _youtube_download_semaphore:
            audio_task = asyncio.create_task(
                _download_source_with_recovery(
                    session,
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
            # Drop large payload references before allowing the next ingest.
            del audio, artwork_data

        async with _lock:
            session.track_id = (
                result.track_id
            )

            session.error = None

            session.updated_at = (
                _now()
            )

        await _flush_pending_listener_history(
            session,
        )

        async with _lock:
            session.state = "ready"

            session.updated_at = (
                _now()
            )

        await _persist_session(
            session,
        )

        job_completed(

                "Catalog ingest complete: "
                f"{result.artist} - "
                f"{result.title}."

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

        await _persist_session(
            session,
        )

        if job_accounted:
            job_failed(

                    "Catalog ingest failed: "
                    f"{session.candidate.artist} - "
                    f"{session.candidate.title}: "
                    f"{str(exc)[:300]}"

            )

    finally:
        await _release_distributed_ingest_lock(
            session.id,
            lock_connection,
        )

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


async def refresh_source(
    session: ProvisionSession,
) -> YouTubeSource | None:
    """
    Re-resolve a temporary media source after it expires or is rejected.

    The refresh is shared through the session's source task so concurrent
    playback requests cannot stampede the upstream resolver.
    """
    async with _lock:
        if session.track_id is not None:
            return None

        task = session.source_task

        if task is None:
            session.source = None
            session.error = None
            session.state = "resolving"
            session.updated_at = _now()
            task = asyncio.create_task(
                _resolve_source(session),
            )
            session.source_task = task

    try:
        await task
    finally:
        async with _lock:
            if session.source_task is task:
                session.source_task = None

    return session.source


async def _download_source_with_recovery(
    session: ProvisionSession,
    source: YouTubeSource,
) -> DownloadedAudio:
    try:
        return await download_youtube_audio(
            source,
        )
    except Exception as first_error:
        # YouTube media URLs are short-lived. Resolve a fresh source once
        # before marking the durable ingest as failed. Do not hold the
        # download slot while making metadata/source requests.
        refreshed = await refresh_source(
            session,
        )

        if refreshed is None:
            if session.track_id is not None:
                raise RuntimeError(
                    "The recording became available in the catalog.",
                ) from first_error

            raise

        try:
            return await download_youtube_audio(
                refreshed,
            )
        except Exception as second_error:
            raise RuntimeError(
                "Temporary YouTube audio source failed after refresh.",
            ) from second_error


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

            local_existing = existing
        else:
            local_existing = None

    if local_existing is not None:
        await touch_durable_provision(
            local_existing.id,
        )
        return local_existing

    durable = (
        await get_or_create_durable_provision(
            candidate,
        )
    )

    session = (
        _session_from_durable(
            durable,
        )
        if durable
        is not None
        else None
    )

    if session is None:
        provision_id = uuid4()
        now = _now()

        session = ProvisionSession(
            id=provision_id,
            candidate=candidate,
            state="queued",
            created_at=now,
            updated_at=now,
            stream_token=(
                _stream_token_for_id(
                    provision_id,
                )
            ),
        )

        await _persist_session(
            session,
        )

    async with _lock:
        # Another coroutine on this process may have filled
        # the local cache while the durable lookup awaited.
        existing = _sessions_by_key.get(
            candidate.key,
        )

        if (
            existing is not None
            and existing.state
            != "failed"
        ):
            return existing

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

    # Treat the setting as a total budget, not just a concurrency limit.
    # Keep speculative source resolution to at most two tracks per request.
    limit = max(
        0,
        min(
            int(
                settings
                .on_demand_prewarm_limit
            ),
            2,
            len(
                candidates,
            ),
        ),
    )

    for candidate in candidates[
        :limit
    ]:
        task = asyncio.create_task(
            prewarm_candidate(
                candidate,
            )
        )

        _background_warm_tasks.add(
            task,
        )

        task.add_done_callback(
            _background_warm_tasks.discard,
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
                2,
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

    # The caller may send a whole playlist (up to 500 keys), but only
    # create durable provision sessions and resolve YouTube sources for
    # the small prewarm budget. The rest stay metadata-only until requested.
    prewarm_limit = max(
        0,
        min(
            int(
                settings
                .on_demand_prewarm_limit
            ),
            2,
        ),
    )
    clean_keys = list(
        dict.fromkeys(
            key.strip()
            for key in candidate_keys
            if key
            and key.strip()
        )
    )[:prewarm_limit]

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

        _background_warm_tasks.add(
            task,
        )

        task.add_done_callback(
            _background_warm_tasks.discard,
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

    missing: list[
        CatalogTrackCandidate
    ] = []

    candidate_identities = {
        candidate.key:
            track_identity_keys(
                title=candidate.title,
                artist=candidate.artist,
            )
        for candidate in candidates
    }

    async with session_factory() as session:
        title_keys = {
            identity[2]
            for identity
            in candidate_identities.values()
            if identity[2]
        }

        artist_keys = {
            identity[0]
            for identity
            in candidate_identities.values()
            if identity[0]
        }

        primary_artist_keys = {
            identity[1]
            for identity
            in candidate_identities.values()
            if identity[1]
        }

        indexed_artist_titles: set[
            tuple[
                str,
                str,
            ]
        ] = set()

        indexed_primary_titles: set[
            tuple[
                str,
                str,
            ]
        ] = set()

        if title_keys:
            indexed_result = (
                await session.execute(
                    select(
                        TrackIdentity.artist_key,
                        TrackIdentity.primary_artist_key,
                        TrackIdentity.title_key,
                    ).where(
                        TrackIdentity.title_key.in_(
                            title_keys,
                        ),
                        or_(
                            TrackIdentity.artist_key.in_(
                                artist_keys,
                            ),
                            TrackIdentity.primary_artist_key.in_(
                                primary_artist_keys,
                            ),
                        ),
                    )
                )
            )

            for (
                existing_artist_key,
                existing_primary_key,
                existing_title_key,
            ) in indexed_result.all():
                indexed_artist_titles.add(
                    (
                        str(
                            existing_artist_key,
                        ),
                        str(
                            existing_title_key,
                        ),
                    )
                )

                indexed_primary_titles.add(
                    (
                        str(
                            existing_primary_key,
                        ),
                        str(
                            existing_title_key,
                        ),
                    )
                )

        # Compatibility only: startup maintenance backfills
        # TrackIdentity rows. Until every legacy row has one,
        # compare just those unindexed rows in Python instead
        # of scanning the entire catalog on every search.
        legacy_result = (
            await session.execute(
                select(
                    Track.artist,
                    Track.title,
                )
                .outerjoin(
                    TrackIdentity,
                    TrackIdentity.track_id
                    == Track.id,
                )
                .where(
                    TrackIdentity.track_id.is_(
                        None,
                    )
                )
            )
        )

        legacy_artist_titles: set[
            tuple[
                str,
                str,
            ]
        ] = set()

        legacy_primary_titles: set[
            tuple[
                str,
                str,
            ]
        ] = set()

        for artist, title in legacy_result.all():
            (
                existing_artist_key,
                existing_primary_key,
                existing_title_key,
            ) = track_identity_keys(
                title=title,
                artist=artist,
            )

            legacy_artist_titles.add(
                (
                    existing_artist_key,
                    existing_title_key,
                )
            )

            legacy_primary_titles.add(
                (
                    existing_primary_key,
                    existing_title_key,
                )
            )

        for candidate in candidates:
            (
                artist_key,
                primary_artist_key,
                title_key,
            ) = candidate_identities[
                candidate.key
            ]

            if (
                (
                    artist_key,
                    title_key,
                )
                not in indexed_artist_titles
                and (
                    primary_artist_key,
                    title_key,
                )
                not in indexed_primary_titles
                and (
                    artist_key,
                    title_key,
                )
                not in legacy_artist_titles
                and (
                    primary_artist_key,
                    title_key,
                )
                not in legacy_primary_titles
            ):
                missing.append(
                    candidate,
                )

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

    try:
        await _ensure_source(
            session,
        )
    except Exception:
        # A resolver failure can be transient (including upstream 403/5xx).
        # Refresh once before exposing a preparation failure to the client.
        await refresh_source(
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

    if session is not None:
        # Process memory is a cache, not authority. Another
        # backend replica may have completed or failed this
        # provision since the local session was created.
        await _apply_terminal_durable_provision(
            session,
        )

        await touch_durable_provision(
            provision_id,
        )

        if session.track_id is not None:
            await _flush_pending_listener_history(
                session,
            )

        return session

    durable = await load_durable_provision(
        provision_id,
    )

    if durable is None:
        return None

    session = _session_from_durable(
        durable,
    )

    if session is None:
        return None

    async with _lock:
        existing = _sessions_by_id.get(
            provision_id,
        )

        if existing is not None:
            return existing

        _sessions_by_id[
            session.id
        ] = session

        _sessions_by_key[
            session.candidate.key
        ] = session

        _candidates[
            session.candidate.key
        ] = session.candidate

    if session.track_id is not None:
        await _flush_pending_listener_history(
            session,
        )

    if (
        session.track_id is None
        and session.state == "ingesting"
    ):
        # A previous process had already committed to
        # ingestion. Re-resolve the source because persisted
        # direct media URLs may have expired across a deploy.
        session.source = None
        session.state = "queued"
        session.error = None
        session.ingest_started = False

        await _persist_session(
            session,
        )

        await _ensure_ingest(
            session,
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
        await persist_pending_listener(
            provision_id,
            user_id,
        )

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


async def resume_on_demand_ingests_on_startup(
    *,
    limit: int = 50,
) -> int:
    """Reconstruct interrupted durable ingests after a deploy.

    This intentionally resumes only provisions that had
    already entered ingestion. Search prewarms and source-only
    preparations remain lazy.
    """

    provision_ids = (
        await list_resumable_provision_ids(
            limit=limit,
        )
    )

    if not provision_ids:
        return 0

    resumed = 0
    semaphore = asyncio.Semaphore(
        4,
    )

    async def resume_one(
        provision_id: UUID,
    ) -> None:
        nonlocal resumed

        async with semaphore:
            session = (
                await get_provision_session(
                    provision_id,
                )
            )

            if (
                session is not None
                and session.track_id is None
                and session.state
                not in {
                    "failed",
                    "ready",
                }
            ):
                resumed += 1

    await asyncio.gather(
        *[
            resume_one(
                provision_id,
            )
            for provision_id
            in provision_ids
        ],
        return_exceptions=False,
    )

    return resumed


async def active_provisions() -> list[
    dict[str, Any]
]:
    async with _lock:
        await _cleanup_expired_locked()

        local_sessions = list(
            _sessions_by_id.values()
        )

    snapshots_by_id: dict[
        str,
        dict[str, Any],
    ] = {}

    durable_rows = (
        await list_durable_recent_provisions(
            limit=50,
        )
    )

    for durable in durable_rows:
        provision_id = durable.get(
            "id",
        )

        key = str(
            provision_id,
        )

        if (
            not key
            or key in snapshots_by_id
        ):
            continue

        session = _session_from_durable(
            durable,
        )

        if session is None:
            continue

        snapshots_by_id[
            key
        ] = _session_snapshot(
            session,
        )

    for session in local_sessions:
        key = str(
            session.id,
        )

        durable_snapshot = (
            snapshots_by_id.get(
                key,
            )
        )

        # A durable terminal result may have been written by
        # another replica. Never regress it back to a stale
        # local resolving/stream-ready/ingesting snapshot.
        if (
            durable_snapshot is not None
            and durable_snapshot.get(
                "state",
            )
            in {
                "ready",
                "failed",
            }
            and session.state
            not in {
                "ready",
                "failed",
            }
        ):
            continue

        snapshots_by_id[
            key
        ] = _session_snapshot(
            session,
        )

    return list(
        snapshots_by_id.values(),
    )[:50]


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
