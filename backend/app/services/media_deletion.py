from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy import select

from ..database import (
    get_session_factory,
)
from ..models.maintenance import (
    MediaDeletionJob,
)
from ..models.media import Track
from .b2 import (
    delete_all_object_versions,
    get_b2_bucket,
)


@dataclass(frozen=True)
class MediaDeletionResult:
    job_id: UUID
    track_id: UUID
    complete: bool
    deleted_versions: int
    error: str | None = None


def _track_object_keys(
    track: Track,
) -> list[str]:
    seen: set[str] = set()
    keys: list[str] = []

    for raw in (
        track.b2_object_key,
        track.artwork_object_key,
    ):
        key = str(
            raw
            or ""
        ).strip()

        if (
            not key
            or key in seen
        ):
            continue

        seen.add(
            key,
        )
        keys.append(
            key,
        )

    return keys


async def queue_media_deletion(
    session,
    track: Track,
) -> MediaDeletionJob:
    job = MediaDeletionJob(
        track_id=track.id,
        object_keys=_track_object_keys(
            track,
        ),
        state="pending",
        attempts=0,
        deleted_versions=0,
    )

    session.add(
        job,
    )

    # Allocate the durable job id before the Track row is
    # removed. This is still inside the caller's transaction:
    # if the Track delete cannot commit, this outbox row rolls
    # back too and B2 is never touched.
    await session.flush()

    return job


async def process_media_deletion_job(
    job_id: UUID,
    *,
    bucket: Any | None = None,
) -> MediaDeletionResult | None:
    session_factory = (
        get_session_factory()
    )

    async with session_factory() as session:
        job = await session.get(
            MediaDeletionJob,
            job_id,
        )

        if job is None:
            return None

        track_id = job.track_id

        job.state = "running"
        job.attempts = int(
            job.attempts
            or 0
        ) + 1
        job.last_error = None

        await session.commit()

        active_bucket = bucket

        try:
            if active_bucket is None:
                active_bucket = (
                    await asyncio.to_thread(
                        get_b2_bucket,
                    )
                )

            pending_keys = list(
                job.object_keys
                or []
            )

            for object_key in pending_keys:
                deleted = (
                    await delete_all_object_versions(
                        active_bucket,
                        object_key,
                    )
                )

                # Persist progress after each object. If the
                # process dies after deleting B2 but before
                # this commit, retrying is safe because B2
                # version deletion is idempotent.
                job = await session.get(
                    MediaDeletionJob,
                    job_id,
                )

                if job is None:
                    return None

                remaining = [
                    key
                    for key
                    in (
                        job.object_keys
                        or []
                    )
                    if key != object_key
                ]

                job.object_keys = remaining
                job.deleted_versions = (
                    int(
                        job.deleted_versions
                        or 0
                    )
                    + int(
                        deleted
                        or 0
                    )
                )

                await session.commit()

            job = await session.get(
                MediaDeletionJob,
                job_id,
            )

            if job is None:
                return None

            deleted_versions = int(
                job.deleted_versions
                or 0
            )

            await session.delete(
                job,
            )
            await session.commit()

            return MediaDeletionResult(
                job_id=job_id,
                track_id=track_id,
                complete=True,
                deleted_versions=(
                    deleted_versions
                ),
            )

        except asyncio.CancelledError:
            # Leave the durable row for a later retry.
            raise

        except Exception as exc:
            await session.rollback()

            job = await session.get(
                MediaDeletionJob,
                job_id,
            )

            if job is not None:
                job.state = "pending"
                job.last_error = str(
                    exc,
                )[:500]

                await session.commit()

                deleted_versions = int(
                    job.deleted_versions
                    or 0
                )
            else:
                deleted_versions = 0

            return MediaDeletionResult(
                job_id=job_id,
                track_id=track_id,
                complete=False,
                deleted_versions=(
                    deleted_versions
                ),
                error=str(
                    exc,
                )[:500],
            )


async def process_pending_media_deletions(
    *,
    limit: int = 100,
    concurrency: int = 4,
    bucket: Any | None = None,
) -> list[MediaDeletionResult]:
    session_factory = (
        get_session_factory()
    )

    async with session_factory() as session:
        result = await session.execute(
            select(
                MediaDeletionJob.id,
            )
            .where(
                MediaDeletionJob.state.in_(
                    (
                        "pending",
                        "running",
                    )
                )
            )
            .order_by(
                MediaDeletionJob.created_at.asc(),
                MediaDeletionJob.id.asc(),
            )
            .limit(
                max(
                    1,
                    int(
                        limit,
                    ),
                )
            )
        )

        job_ids = list(
            result.scalars().all()
        )

    if not job_ids:
        return []

    semaphore = asyncio.Semaphore(
        max(
            1,
            min(
                int(
                    concurrency,
                ),
                8,
            ),
        )
    )

    async def run_one(
        job_id: UUID,
    ) -> MediaDeletionResult | None:
        async with semaphore:
            return await process_media_deletion_job(
                job_id,
                bucket=bucket,
            )

    results = await asyncio.gather(
        *(
            run_one(
                job_id,
            )
            for job_id in job_ids
        )
    )

    return [
        item
        for item in results
        if item is not None
    ]
