"""PostgreSQL maintenance queue with short claims, expiring leases and bounded retries."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import func, or_, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ..database import get_session_factory
from ..models.maintenance import MaintenanceJob
from ..models.media import Track
from .artists import artist_names_for_credit
from .generated_playlists import ensure_artist_playlist, refresh_smart_playlists_for_track
from .music_metadata import enrich_track_metadata_by_id

logger = logging.getLogger(__name__)
MAX_ATTEMPTS = 8
LEASE_SECONDS = 600
JOB_TIMEOUT_SECONDS = 240
POLL_SECONDS = 2.0
Factory = async_sessionmaker[AsyncSession]


@dataclass(frozen=True)
class ClaimedJob:
    id: UUID
    track_id: UUID
    kind: str
    lock_token: UUID
    attempts: int
    generation: int = 0


async def enqueue_track_maintenance(
    session: AsyncSession,
    track_id: UUID,
    *,
    kinds: tuple[str, ...] = ("metadata", "playlists"),
    refresh_existing: bool = False,
) -> None:
    """Enqueue atomically; versions preserve new requests arriving during a lease."""
    if not kinds or any(kind not in {"metadata", "playlists"} for kind in kinds):
        raise ValueError("Unsupported maintenance job kind")
    await session.flush()
    statement = insert(MaintenanceJob).values(
        [{"id": uuid4(), "track_id": track_id, "kind": kind} for kind in set(kinds)]
    )
    if refresh_existing:
        statement = statement.on_conflict_do_update(
            constraint="uq_maintenance_jobs_kind_track",
            set_={
                "generation": MaintenanceJob.generation + 1,
                "attempts": 0,
                "completed_at": None,
                "available_at": func.now(),
                "last_error": None,
            },
        )
    else:
        statement = statement.on_conflict_do_nothing(constraint="uq_maintenance_jobs_kind_track")
    await session.execute(statement)


async def claim_next_job(factory: Factory, *, now: datetime | None = None) -> ClaimedJob | None:
    now = now or datetime.now(UTC)
    async with factory() as session:
        async with session.begin():
            job = (
                await session.execute(
                    select(MaintenanceJob)
                    .where(
                        MaintenanceJob.completed_at.is_(None),
                        MaintenanceJob.attempts < MAX_ATTEMPTS,
                        MaintenanceJob.available_at <= now,
                        or_(
                            MaintenanceJob.locked_until.is_(None),
                            MaintenanceJob.locked_until <= now,
                        ),
                    )
                    .order_by(MaintenanceJob.available_at, MaintenanceJob.kind, MaintenanceJob.id)
                    .with_for_update(skip_locked=True)
                    .limit(1)
                )
            ).scalar_one_or_none()
            if job is None:
                return None
            token = uuid4()
            job.lock_token = token
            job.locked_until = now + timedelta(seconds=LEASE_SECONDS)
            job.attempts += 1
            return ClaimedJob(job.id, job.track_id, job.kind, token, job.attempts, job.generation)


async def finish_job(
    factory: Factory, claim: ClaimedJob, *, error: str | None = None, now: datetime | None = None
) -> bool:
    now = now or datetime.now(UTC)
    values: dict[str, Any] = {"locked_until": None, "lock_token": None, "last_error": error}
    if error is None:
        values["completed_at"] = now
    else:
        values["available_at"] = now + timedelta(seconds=min(5 * 2 ** (claim.attempts - 1), 900))
    async with factory() as session:
        result = await session.execute(
            update(MaintenanceJob)
            .where(
                MaintenanceJob.id == claim.id,
                MaintenanceJob.lock_token == claim.lock_token,
                MaintenanceJob.generation == claim.generation,
                MaintenanceJob.completed_at.is_(None),
            )
            .values(**values)
        )
        if not getattr(result, "rowcount", 0):
            # Metadata changed during this lease. Fence old completion/failure,
            # release only our token, and leave the new generation runnable.
            result = await session.execute(
                update(MaintenanceJob)
                .where(
                    MaintenanceJob.id == claim.id,
                    MaintenanceJob.lock_token == claim.lock_token,
                    MaintenanceJob.generation != claim.generation,
                    MaintenanceJob.completed_at.is_(None),
                )
                .values(
                    completed_at=None,
                    locked_until=None,
                    lock_token=None,
                    attempts=0,
                    available_at=now,
                    last_error=None,
                )
            )
        await session.commit()
        return bool(getattr(result, "rowcount", 0))


async def execute_job(claim: ClaimedJob) -> None:
    if claim.kind == "metadata":
        result = await enrich_track_metadata_by_id(claim.track_id)
        if result is not None and (not result["genre"] or result["release_year"] is None):
            raise LookupError("Metadata remains incomplete; retry later")
        return
    if claim.kind != "playlists":
        raise ValueError("Unsupported maintenance job kind")
    async with get_session_factory()() as session:
        track = await session.get(Track, claim.track_id)
        if track is None or not track.is_published:
            return
        for name in artist_names_for_credit(track.artist, include_combined=False):
            await ensure_artist_playlist(session, name)
        await refresh_smart_playlists_for_track(session, track)


async def process_next_job(factory: Factory | None = None) -> bool:
    factory = factory or get_session_factory()
    claim = await claim_next_job(factory)
    if claim is None:
        return False
    try:
        async with asyncio.timeout(JOB_TIMEOUT_SECONDS):
            await execute_job(claim)
    except Exception as exc:
        # Provider failures may contain credential-bearing URLs; persist/log the
        # exception class only. Exhausted jobs remain inspectable for explicit retry.
        error = type(exc).__name__
        await finish_job(factory, claim, error=error)
        logger.warning(
            "Maintenance job %s (%s) failed attempt %d/%d: %s",
            claim.id,
            claim.kind,
            claim.attempts,
            MAX_ATTEMPTS,
            error,
        )
    else:
        await finish_job(factory, claim)
    return True


async def run_maintenance_worker() -> None:
    while True:
        try:
            processed = await process_next_job()
        except Exception:
            logger.warning("Maintenance queue unavailable; worker will retry")
            processed = False
        await asyncio.sleep(0 if processed else POLL_SECONDS)


async def maintenance_status(session: AsyncSession) -> dict[str, int]:
    """Small aggregate for administrators; completed rows retain a recovery audit trail."""
    now = datetime.now(UTC)
    open_job = MaintenanceJob.completed_at.is_(None)
    retryable = MaintenanceJob.attempts < MAX_ATTEMPTS
    leased = MaintenanceJob.locked_until > now
    row = (
        await session.execute(
            select(
                func.count().filter(MaintenanceJob.completed_at.is_not(None)),
                func.count().filter(open_job, ~retryable),
                func.count().filter(open_job, retryable, leased),
                func.count().filter(
                    open_job, retryable, or_(MaintenanceJob.locked_until.is_(None), ~leased)
                ),
            ).select_from(MaintenanceJob)
        )
    ).one()
    return dict(
        zip(
            ("completed", "failed", "leased", "pending"), (int(value) for value in row), strict=True
        )
    )


async def retry_failed_job(session: AsyncSession, job_id: UUID) -> bool:
    """Only exhausted/unowned jobs may be reset; active leases are never stolen."""
    now = datetime.now(UTC)
    result = await session.execute(
        update(MaintenanceJob)
        .where(
            MaintenanceJob.id == job_id,
            MaintenanceJob.completed_at.is_(None),
            MaintenanceJob.attempts >= MAX_ATTEMPTS,
            or_(MaintenanceJob.locked_until.is_(None), MaintenanceJob.locked_until <= now),
        )
        .values(attempts=0, available_at=now, locked_until=None, lock_token=None, last_error=None)
    )
    await session.commit()
    return bool(getattr(result, "rowcount", 0))
