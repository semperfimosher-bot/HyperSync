from datetime import UTC, datetime, timedelta
from typing import Any, cast
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from backend.app.models import Base, Track
from scripts.verification.postgres_database import create_postgres_test_engine


def test_maintenance_jobs_have_durable_ownership_and_retry_state():
    table = Base.metadata.tables.get("maintenance_jobs")
    assert table is not None, "upload maintenance must be persisted, not only BackgroundTasks"
    assert {
        "track_id",
        "kind",
        "attempts",
        "available_at",
        "locked_until",
        "lock_token",
        "completed_at",
        "generation",
    } <= set(table.columns.keys())


@pytest.mark.asyncio
async def test_jobs_rollback_with_track_and_expired_claim_recovers():
    from backend.app.models.maintenance import MaintenanceJob
    from backend.app.services.maintenance_jobs import (
        claim_next_job,
        enqueue_track_maintenance,
        finish_job,
    )

    engine = create_postgres_test_engine()
    factory = async_sessionmaker(engine, expire_on_commit=False)
    track = Track(
        id=uuid4(), title="Durable", artist="Artist", b2_object_key=f"audio/{uuid4()}.mp3"
    )
    async with factory() as session:
        session.add(track)
        await session.flush()
        await enqueue_track_maintenance(session, track.id)
        await session.rollback()
    async with factory() as session:
        assert await session.get(Track, track.id) is None
        assert not (await session.execute(select(MaintenanceJob))).scalars().all()
        session.add(track)
        await session.flush()
        await enqueue_track_maintenance(session, track.id)
        await enqueue_track_maintenance(session, track.id)
        await session.commit()
        assert len((await session.execute(select(MaintenanceJob))).scalars().all()) == 2
    now = datetime.now(UTC)
    first = await claim_next_job(factory, now=now)
    assert first is not None
    second = await claim_next_job(factory, now=now)
    assert second is not None and second.id != first.id
    assert await claim_next_job(factory, now=now) is None
    recovered = await claim_next_job(factory, now=now + timedelta(seconds=601))
    assert recovered is not None and recovered.id == first.id
    assert recovered.lock_token != first.lock_token
    # An expired worker cannot acknowledge a claim now owned by another worker.
    assert await finish_job(factory, first) is False
    assert await finish_job(factory, recovered) is True
    await engine.dispose()


@pytest.mark.asyncio
async def test_failure_persists_backoff_and_exhausted_job_for_inspection():
    from backend.app.models.maintenance import MaintenanceJob
    from backend.app.services.maintenance_jobs import (
        claim_next_job,
        enqueue_track_maintenance,
        finish_job,
    )

    engine = create_postgres_test_engine()
    factory = async_sessionmaker(engine, expire_on_commit=False)
    track = Track(id=uuid4(), title="Retry", artist="Artist", b2_object_key=f"audio/{uuid4()}.mp3")
    async with factory() as session:
        session.add(track)
        await session.flush()
        await enqueue_track_maintenance(session, track.id, kinds=("metadata",))
        await session.commit()
    now = datetime.now(UTC)
    claim = await claim_next_job(factory, now=now)
    assert claim is not None
    assert await finish_job(factory, claim, error="provider unavailable", now=now)
    assert await claim_next_job(factory, now=now) is None
    async with factory() as session:
        job = await session.get(MaintenanceJob, claim.id)
        assert job is not None and job.last_error == "provider unavailable"
        assert job.available_at > now and job.completed_at is None
    retry = await claim_next_job(factory, now=now + timedelta(seconds=901))
    assert retry is not None and retry.attempts == 2
    from backend.app.services.maintenance_jobs import (
        MAX_ATTEMPTS,
        maintenance_status,
        retry_failed_job,
    )

    async with factory() as session:
        job = await session.get(MaintenanceJob, claim.id)
        assert job is not None
        job.attempts = MAX_ATTEMPTS
        job.locked_until = None
        await session.commit()
        assert (await maintenance_status(session))["failed"] == 1
        assert await retry_failed_job(session, claim.id)
        assert (await maintenance_status(session))["pending"] == 1
    assert await claim_next_job(factory, now=now + timedelta(seconds=902)) is not None
    await engine.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize("cause_timeout", [False, True])
async def test_worker_timeout_and_provider_failure_leave_retryable_work(monkeypatch, cause_timeout):
    from backend.app.services import maintenance_jobs as jobs

    claim = jobs.ClaimedJob(uuid4(), uuid4(), "metadata", uuid4(), 1)
    outcomes = []

    async def acquire(_factory):
        return claim

    async def failed(_claim):
        if cause_timeout:
            import asyncio

            await asyncio.Event().wait()
        raise RuntimeError("https://provider.test/?secret=must-not-persist")

    async def finish(_factory, actual, **kwargs):
        outcomes.append((actual, kwargs))
        return True

    monkeypatch.setattr(jobs, "JOB_TIMEOUT_SECONDS", 0.01)
    monkeypatch.setattr(jobs, "claim_next_job", acquire)
    monkeypatch.setattr(jobs, "execute_job", failed)
    monkeypatch.setattr(jobs, "finish_job", finish)
    assert await jobs.process_next_job(cast(Any, object()))
    assert outcomes == [(claim, {"error": "TimeoutError" if cause_timeout else "RuntimeError"})]


@pytest.mark.asyncio
async def test_worker_cancellation_keeps_lease_for_restart_recovery(monkeypatch):
    import asyncio

    from backend.app.services import maintenance_jobs as jobs

    claim = jobs.ClaimedJob(uuid4(), uuid4(), "playlists", uuid4(), 1)
    acknowledged = []

    async def acquire(_factory):
        return claim

    async def cancelled(_claim):
        raise asyncio.CancelledError()

    async def finish(*_args, **_kwargs):
        acknowledged.append(True)

    monkeypatch.setattr(jobs, "claim_next_job", acquire)
    monkeypatch.setattr(jobs, "execute_job", cancelled)
    monkeypatch.setattr(jobs, "finish_job", finish)
    with pytest.raises(asyncio.CancelledError):
        await jobs.process_next_job(cast(Any, object()))
    assert not acknowledged


@pytest.mark.asyncio
async def test_new_playlist_generation_survives_old_worker_completion():
    from backend.app.models.maintenance import MaintenanceJob
    from backend.app.services.maintenance_jobs import (
        claim_next_job,
        enqueue_track_maintenance,
        finish_job,
    )

    engine = create_postgres_test_engine()
    factory = async_sessionmaker(engine, expire_on_commit=False)
    track = Track(
        id=uuid4(), title="Generation", artist="Artist", b2_object_key=f"audio/{uuid4()}.mp3"
    )
    async with factory() as session:
        session.add(track)
        await session.flush()
        await enqueue_track_maintenance(session, track.id, kinds=("playlists",))
        await session.commit()
    first = await claim_next_job(factory)
    assert first is not None
    async with factory() as session:
        await enqueue_track_maintenance(
            session, track.id, kinds=("playlists",), refresh_existing=True
        )
        await session.commit()
    assert await finish_job(factory, first)
    second = await claim_next_job(factory)
    assert second is not None and second.id == first.id
    assert second.generation > first.generation
    assert await finish_job(factory, second)
    # Re-request after completion also reopens the one idempotent job row.
    async with factory() as session:
        await enqueue_track_maintenance(
            session, track.id, kinds=("playlists",), refresh_existing=True
        )
        await session.commit()
        assert len((await session.execute(select(MaintenanceJob))).scalars().all()) == 1
    third = await claim_next_job(factory)
    assert third is not None and third.generation > second.generation
    await engine.dispose()
