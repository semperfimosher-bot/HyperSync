from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import (
    async_sessionmaker,
    create_async_engine,
)

from backend.app.models.base import Base
from backend.app.models.maintenance import (
    MediaDeletionJob,
)
from backend.app.models.media import Track
from backend.app.services import media_deletion


async def _factory():
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
    )

    async with engine.begin() as connection:
        await connection.run_sync(
            Base.metadata.create_all,
            tables=[
                Base.metadata.tables[
                    Track.__tablename__
                ],
                Base.metadata.tables[
                    MediaDeletionJob.__tablename__
                ],
            ],
        )

    return (
        engine,
        async_sessionmaker(
            engine,
            expire_on_commit=False,
        ),
    )


class _GoodBucket:
    def __init__(
        self,
        keys: set[str],
    ) -> None:
        self.keys = set(
            keys,
        )
        self.deleted: list[
            tuple[str, str]
        ] = []

    def list_file_versions(
        self,
        file_name: str | None = None,
    ):
        if file_name not in self.keys:
            return []

        return [
            type(
                "Version",
                (),
                {
                    "file_name":
                        file_name,
                    "file_id":
                        f"{file_name}-v1",
                },
            )(),
        ]

    def delete_file_version(
        self,
        file_id: str,
        file_name: str,
    ):
        self.deleted.append(
            (
                file_name,
                file_id,
            )
        )
        self.keys.discard(
            file_name,
        )


class _FailingBucket:
    def list_file_versions(
        self,
        file_name: str | None = None,
    ):
        raise RuntimeError(
            "temporary B2 outage",
        )


@pytest.mark.asyncio
async def test_media_delete_outbox_cleans_storage_after_database_commit(
    monkeypatch,
) -> None:
    engine, factory = await _factory()

    monkeypatch.setattr(
        media_deletion,
        "get_session_factory",
        lambda:
            factory,
    )

    audio_key = "audio/delete-me.mp3"
    artwork_key = "artwork/delete-me.jpg"

    async with factory() as session:
        track = Track(
            id=uuid4(),
            title="Delete Me",
            artist="Example Artist",
            album="Example Album",
            b2_object_key=audio_key,
            artwork_object_key=artwork_key,
            mime_type="audio/mpeg",
            is_published=True,
        )

        session.add(
            track,
        )
        await session.commit()

        job = await media_deletion.queue_media_deletion(
            session,
            track,
        )

        job_id = job.id
        track_id = track.id

        await session.delete(
            track,
        )
        await session.commit()

    bucket = _GoodBucket(
        {
            audio_key,
            artwork_key,
        }
    )

    result = await media_deletion.process_media_deletion_job(
        job_id,
        bucket=bucket,
    )

    assert result is not None
    assert result.complete is True
    assert result.deleted_versions == 2

    async with factory() as session:
        assert (
            await session.get(
                Track,
                track_id,
            )
            is None
        )

        assert (
            await session.get(
                MediaDeletionJob,
                job_id,
            )
            is None
        )

    assert {
        file_name
        for (
            file_name,
            _file_id,
        ) in bucket.deleted
    } == {
        audio_key,
        artwork_key,
    }

    await engine.dispose()


@pytest.mark.asyncio
async def test_media_delete_outbox_survives_storage_failure_and_retries(
    monkeypatch,
) -> None:
    engine, factory = await _factory()

    monkeypatch.setattr(
        media_deletion,
        "get_session_factory",
        lambda:
            factory,
    )

    audio_key = "audio/retry-me.mp3"

    async with factory() as session:
        track = Track(
            id=uuid4(),
            title="Retry Me",
            artist="Example Artist",
            b2_object_key=audio_key,
            mime_type="audio/mpeg",
            is_published=True,
        )

        session.add(
            track,
        )
        await session.commit()

        job = await media_deletion.queue_media_deletion(
            session,
            track,
        )

        job_id = job.id
        track_id = track.id

        await session.delete(
            track,
        )
        await session.commit()

    first = await media_deletion.process_media_deletion_job(
        job_id,
        bucket=_FailingBucket(),
    )

    assert first is not None
    assert first.complete is False
    assert "temporary B2 outage" in (
        first.error
        or ""
    )

    async with factory() as session:
        assert (
            await session.get(
                Track,
                track_id,
            )
            is None
        )

        pending = await session.get(
            MediaDeletionJob,
            job_id,
        )

        assert pending is not None
        assert pending.state == "pending"
        assert pending.object_keys == [
            audio_key,
        ]

    bucket = _GoodBucket(
        {
            audio_key,
        }
    )

    retried = (
        await media_deletion.process_media_deletion_job(
            job_id,
            bucket=bucket,
        )
    )

    assert retried is not None
    assert retried.complete is True
    assert retried.deleted_versions == 1

    async with factory() as session:
        assert (
            await session.get(
                MediaDeletionJob,
                job_id,
            )
            is None
        )

    await engine.dispose()


@pytest.mark.asyncio
async def test_pending_media_delete_worker_retries_durable_jobs(
    monkeypatch,
) -> None:
    engine, factory = await _factory()

    monkeypatch.setattr(
        media_deletion,
        "get_session_factory",
        lambda:
            factory,
    )

    audio_key = "audio/background-cleanup.mp3"

    async with factory() as session:
        track = Track(
            id=uuid4(),
            title="Background Cleanup",
            artist="Example Artist",
            b2_object_key=audio_key,
            mime_type="audio/mpeg",
            is_published=True,
        )

        session.add(
            track,
        )
        await session.commit()

        job = await media_deletion.queue_media_deletion(
            session,
            track,
        )

        job_id = job.id

        await session.delete(
            track,
        )
        await session.commit()

    bucket = _GoodBucket(
        {
            audio_key,
        }
    )

    results = (
        await media_deletion.process_pending_media_deletions(
            bucket=bucket,
            limit=10,
            concurrency=2,
        )
    )

    assert len(
        results,
    ) == 1
    assert results[0].complete is True

    async with factory() as session:
        remaining = list(
            (
                await session.execute(
                    select(
                        MediaDeletionJob.id,
                    )
                )
            )
            .scalars()
            .all()
        )

        assert remaining == []

    assert (
        await media_deletion.process_media_deletion_job(
            job_id,
            bucket=bucket,
        )
        is None
    )

    await engine.dispose()
