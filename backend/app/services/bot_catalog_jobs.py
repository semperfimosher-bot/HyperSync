from __future__ import annotations

from datetime import (
    UTC,
    datetime,
)
from typing import Any
from uuid import UUID

from sqlalchemy import (
    select,
    text,
    update,
)

from ..database import (
    get_session_factory,
)
from ..models.bot import (
    BotCatalogScan,
    BotCatalogScanItem,
)
from .on_demand_metadata import (
    CatalogTrackCandidate,
)

ACTIVE_SCAN_STATES = (
    "queued",
    "discovering",
    "ingesting",
    "cancelling",
)

TERMINAL_SCAN_STATES = (
    "complete",
    "cancelled",
    "failed",
)


class ActiveCatalogScanError(
    RuntimeError,
):
    pass


def _now() -> datetime:
    return datetime.now(
        UTC,
    )


async def create_catalog_scan(
    *,
    auto_ingest: bool,
    track_limit_per_artist: int,
    ingest_concurrency: int,
) -> BotCatalogScan:
    session_factory = (
        get_session_factory()
    )

    async with session_factory() as session:
        bind = session.get_bind()

        if (
            bind is not None
            and bind.dialect.name
            == "postgresql"
        ):
            # Serialize "is there an active scan?" + create
            # across every API replica. This closes the race
            # where two requests arrive before either insert
            # becomes visible.
            await session.execute(
                text(
                    "SELECT pg_advisory_xact_lock("
                    "hashtext(:lock_key)"
                    ")"
                ),
                {
                    "lock_key":
                        "hypersync:catalog-scan:create",
                },
            )

        existing_result = await session.execute(
            select(
                BotCatalogScan.id,
            )
            .where(
                BotCatalogScan.state.in_(
                    ACTIVE_SCAN_STATES,
                )
            )
            .limit(
                1,
            )
        )

        if (
            existing_result.scalar_one_or_none()
            is not None
        ):
            raise ActiveCatalogScanError(
                "A catalog gap scan is already running.",
            )

        scan = BotCatalogScan(
            state="queued",
            auto_ingest=bool(
                auto_ingest,
            ),
            track_limit_per_artist=max(
                1,
                min(
                    int(
                        track_limit_per_artist,
                    ),
                    500,
                ),
            ),
            ingest_concurrency=max(
                1,
                min(
                    int(
                        ingest_concurrency,
                    ),
                    4,
                ),
            ),
        )

        session.add(
            scan,
        )

        await session.commit()
        await session.refresh(
            scan,
        )

        return scan


async def active_catalog_scan() -> BotCatalogScan | None:
    session_factory = (
        get_session_factory()
    )

    async with session_factory() as session:
        result = await session.execute(
            select(
                BotCatalogScan,
            )
            .where(
                BotCatalogScan.state.in_(
                    ACTIVE_SCAN_STATES,
                ),
            )
            .order_by(
                BotCatalogScan.created_at.desc(),
            )
            .limit(
                1,
            )
        )

        return (
            result.scalar_one_or_none()
        )


async def latest_catalog_scan() -> BotCatalogScan | None:
    session_factory = (
        get_session_factory()
    )

    async with session_factory() as session:
        result = await session.execute(
            select(
                BotCatalogScan,
            )
            .order_by(
                BotCatalogScan.created_at.desc(),
            )
            .limit(
                1,
            )
        )

        return (
            result.scalar_one_or_none()
        )


async def catalog_scan_is_active() -> bool:
    return (
        await active_catalog_scan()
        is not None
    )


async def set_scan_discovery_start(
    scan_id: UUID,
    *,
    artist_total: int,
    resume: bool = False,
) -> None:
    session_factory = (
        get_session_factory()
    )

    async with session_factory() as session:
        values: dict[str, Any] = {
            "state":
                "discovering",
            "artist_total":
                max(
                    0,
                    int(
                        artist_total,
                    ),
                ),
            "current_artist":
                None,
            "cancel_requested":
                False,
            "finished_at":
                None,
            "last_error":
                None,
        }

        if resume:
            values[
                "artists_scanned"
            ] = 0
            values[
                "artist_failures"
            ] = 0
        else:
            values[
                "started_at"
            ] = _now()

        await session.execute(
            update(
                BotCatalogScan,
            )
            .where(
                BotCatalogScan.id
                == scan_id,
            )
            .values(
                **values,
            )
        )

        await session.commit()


async def persist_discovered_candidates(
    scan_id: UUID,
    candidates: list[
        CatalogTrackCandidate
    ],
) -> int:
    if not candidates:
        return 0

    session_factory = (
        get_session_factory()
    )

    async with session_factory() as session:
        keys = [
            candidate.key
            for candidate
            in candidates
        ]

        existing_result = (
            await session.execute(
                select(
                    BotCatalogScanItem
                    .candidate_key,
                ).where(
                    BotCatalogScanItem.scan_id
                    == scan_id,
                    BotCatalogScanItem
                    .candidate_key
                    .in_(
                        keys,
                    ),
                )
            )
        )

        existing = set(
            existing_result.scalars().all()
        )

        added = 0

        for candidate in candidates:
            if (
                candidate.key
                in existing
            ):
                continue

            session.add(
                BotCatalogScanItem(
                    scan_id=scan_id,
                    candidate_key=(
                        candidate.key
                    ),
                    payload=(
                        candidate.as_dict()
                    ),
                    state="discovered",
                )
            )

            existing.add(
                candidate.key,
            )
            added += 1

        if added:
            await session.execute(
                update(
                    BotCatalogScan,
                )
                .where(
                    BotCatalogScan.id
                    == scan_id,
                )
                .values(
                    missing_discovered=(
                        BotCatalogScan
                        .missing_discovered
                        + added
                    ),
                )
            )

        await session.commit()

        return added


async def set_scan_discovery_progress(
    scan_id: UUID,
    *,
    artist: str,
    artists_scanned: int,
    error: str | None = None,
) -> None:
    session_factory = (
        get_session_factory()
    )

    async with session_factory() as session:
        values: dict[str, Any] = {
            "current_artist":
                artist[:255],
            "artists_scanned":
                max(
                    0,
                    int(
                        artists_scanned,
                    ),
                ),
        }

        if error:
            values[
                "artist_failures"
            ] = (
                BotCatalogScan
                .artist_failures
                + 1
            )
            values[
                "last_error"
            ] = str(
                error,
            )[:400]

        await session.execute(
            update(
                BotCatalogScan,
            )
            .where(
                BotCatalogScan.id
                == scan_id,
            )
            .values(
                **values,
            )
        )

        await session.commit()


async def set_scan_phase(
    scan_id: UUID,
    phase: str,
) -> None:
    session_factory = (
        get_session_factory()
    )

    async with session_factory() as session:
        await session.execute(
            update(
                BotCatalogScan,
            )
            .where(
                BotCatalogScan.id
                == scan_id,
            )
            .values(
                state=phase,
                current_artist=None,
            )
        )

        await session.commit()


async def request_scan_cancel(
    scan_id: UUID | None = None,
) -> bool:
    session_factory = (
        get_session_factory()
    )

    async with session_factory() as session:
        target_id = scan_id

        if target_id is None:
            result = await session.execute(
                select(
                    BotCatalogScan.id,
                )
                .where(
                    BotCatalogScan.state.in_(
                        ACTIVE_SCAN_STATES,
                    )
                )
                .order_by(
                    BotCatalogScan.created_at.desc(),
                )
                .limit(
                    1,
                )
            )

            target_id = (
                result.scalar_one_or_none()
            )

        if target_id is None:
            return False

        result = await session.execute(
            update(
                BotCatalogScan,
            )
            .where(
                BotCatalogScan.id
                == target_id,
                BotCatalogScan.state.in_(
                    ACTIVE_SCAN_STATES,
                ),
            )
            .values(
                cancel_requested=True,
                state="cancelling",
            )
        )

        await session.commit()

        return bool(
            result.rowcount,
        )


async def scan_cancel_requested(
    scan_id: UUID,
) -> bool:
    session_factory = (
        get_session_factory()
    )

    async with session_factory() as session:
        result = await session.execute(
            select(
                BotCatalogScan.cancel_requested,
            ).where(
                BotCatalogScan.id
                == scan_id,
            )
        )

        value = (
            result.scalar_one_or_none()
        )

        return bool(
            value,
        )


async def pending_scan_items(
    scan_id: UUID,
) -> list[
    tuple[
        UUID,
        CatalogTrackCandidate,
    ]
]:
    session_factory = (
        get_session_factory()
    )

    async with session_factory() as session:
        result = await session.execute(
            select(
                BotCatalogScanItem,
            )
            .where(
                BotCatalogScanItem.scan_id
                == scan_id,
                BotCatalogScanItem.state
                == "discovered",
            )
            .order_by(
                BotCatalogScanItem.created_at.asc(),
                BotCatalogScanItem.id.asc(),
            )
        )

        rows = list(
            result.scalars().all()
        )

        pending: list[
            tuple[
                UUID,
                CatalogTrackCandidate,
            ]
        ] = []

        for item in rows:
            pending.append(
                (
                    item.id,
                    CatalogTrackCandidate.from_dict(
                        dict(
                            item.payload,
                        )
                    ),
                )
            )

        return pending


async def mark_item_started(
    scan_id: UUID,
    item_id: UUID,
) -> bool:
    """Atomically claim one discovered item for ingestion.

    Returning False means another worker already claimed or
    completed the item. Callers must not ingest in that case.
    Restart recovery explicitly resets abandoned "ingesting"
    rows back to "discovered" before workers are launched.
    """

    session_factory = (
        get_session_factory()
    )

    async with session_factory() as session:
        result = await session.execute(
            update(
                BotCatalogScanItem,
            )
            .where(
                BotCatalogScanItem.id
                == item_id,
                BotCatalogScanItem.scan_id
                == scan_id,
                BotCatalogScanItem.state
                == "discovered",
            )
            .values(
                state="ingesting",
                attempts=(
                    BotCatalogScanItem
                    .attempts
                    + 1
                ),
                error=None,
            )
        )

        claimed = bool(
            result.rowcount,
        )

        if claimed:
            await session.execute(
                update(
                    BotCatalogScan,
                )
                .where(
                    BotCatalogScan.id
                    == scan_id,
                )
                .values(
                    ingest_started=(
                        BotCatalogScan
                        .ingest_started
                        + 1
                    ),
                )
            )

        await session.commit()

        return claimed


async def record_item_failure(
    scan_id: UUID,
    item_id: UUID,
    *,
    error: str,
    max_attempts: int,
) -> tuple[str, int]:
    """Persist a failed attempt and decide whether it is retryable.

    Returns ("retry", attempts) while the durable item still
    has attempts remaining, ("failed", attempts) once the
    bounded retry budget is exhausted, or ("ignored", 0) if
    the item is no longer owned by the caller.
    """

    session_factory = (
        get_session_factory()
    )

    async with session_factory() as session:
        result = await session.execute(
            select(
                BotCatalogScanItem.attempts,
            ).where(
                BotCatalogScanItem.id
                == item_id,
                BotCatalogScanItem.scan_id
                == scan_id,
                BotCatalogScanItem.state
                == "ingesting",
            )
        )

        attempts = (
            result.scalar_one_or_none()
        )

        if attempts is None:
            return (
                "ignored",
                0,
            )

        attempt_count = max(
            0,
            int(
                attempts,
            ),
        )

        retry = (
            attempt_count
            < max(
                1,
                int(
                    max_attempts,
                ),
            )
        )

        item_result = await session.execute(
            update(
                BotCatalogScanItem,
            )
            .where(
                BotCatalogScanItem.id
                == item_id,
                BotCatalogScanItem.scan_id
                == scan_id,
                BotCatalogScanItem.state
                == "ingesting",
            )
            .values(
                state=(
                    "discovered"
                    if retry
                    else "failed"
                ),
                error=str(
                    error
                    or "Ingest failed.",
                )[:500],
            )
        )

        if not item_result.rowcount:
            await session.rollback()
            return (
                "ignored",
                attempt_count,
            )

        if not retry:
            await session.execute(
                update(
                    BotCatalogScan,
                )
                .where(
                    BotCatalogScan.id
                    == scan_id,
                )
                .values(
                    ingest_failed=(
                        BotCatalogScan
                        .ingest_failed
                        + 1
                    ),
                    last_error=str(
                        error
                        or "Ingest failed.",
                    )[:400],
                )
            )

        await session.commit()

        return (
            (
                "retry"
                if retry
                else "failed"
            ),
            attempt_count,
        )


async def mark_item_finished(
    scan_id: UUID,
    item_id: UUID,
    *,
    ready: bool,
    track_id: UUID | str | None = None,
    error: str | None = None,
) -> None:
    parsed_track_id: UUID | None = None

    if track_id:
        try:
            parsed_track_id = UUID(
                str(
                    track_id,
                )
            )
        except (
            TypeError,
            ValueError,
        ):
            parsed_track_id = None

    session_factory = (
        get_session_factory()
    )

    async with session_factory() as session:
        item_state = (
            "ready"
            if ready
            else "failed"
        )

        result = await session.execute(
            update(
                BotCatalogScanItem,
            )
            .where(
                BotCatalogScanItem.id
                == item_id,
                BotCatalogScanItem.scan_id
                == scan_id,
                BotCatalogScanItem.state
                == "ingesting",
            )
            .values(
                state=item_state,
                track_id=parsed_track_id,
                error=(
                    None
                    if ready
                    else str(
                        error
                        or "Ingest failed."
                    )[:500]
                ),
            )
        )

        if result.rowcount:
            values: dict[str, Any] = {}

            if ready:
                values[
                    "ingest_ready"
                ] = (
                    BotCatalogScan
                    .ingest_ready
                    + 1
                )
            else:
                values[
                    "ingest_failed"
                ] = (
                    BotCatalogScan
                    .ingest_failed
                    + 1
                )
                values[
                    "last_error"
                ] = str(
                    error
                    or "Ingest failed."
                )[:400]

            await session.execute(
                update(
                    BotCatalogScan,
                )
                .where(
                    BotCatalogScan.id
                    == scan_id,
                )
                .values(
                    **values,
                )
            )

        await session.commit()


async def finish_scan(
    scan_id: UUID,
    *,
    cancelled: bool = False,
) -> None:
    session_factory = (
        get_session_factory()
    )

    async with session_factory() as session:
        await session.execute(
            update(
                BotCatalogScan,
            )
            .where(
                BotCatalogScan.id
                == scan_id,
            )
            .values(
                state=(
                    "cancelled"
                    if cancelled
                    else "complete"
                ),
                current_artist=None,
                cancel_requested=(
                    bool(
                        cancelled,
                    )
                ),
                finished_at=_now(),
            )
        )

        await session.commit()


async def fail_scan(
    scan_id: UUID,
    message: str,
) -> None:
    session_factory = (
        get_session_factory()
    )

    async with session_factory() as session:
        await session.execute(
            update(
                BotCatalogScan,
            )
            .where(
                BotCatalogScan.id
                == scan_id,
            )
            .values(
                state="failed",
                current_artist=None,
                last_error=str(
                    message,
                )[:400],
                finished_at=_now(),
            )
        )

        await session.commit()


async def prepare_scan_for_resume(
    scan_id: UUID,
) -> None:
    session_factory = (
        get_session_factory()
    )

    async with session_factory() as session:
        await session.execute(
            update(
                BotCatalogScanItem,
            )
            .where(
                BotCatalogScanItem.scan_id
                == scan_id,
                BotCatalogScanItem.state
                == "ingesting",
            )
            .values(
                state="discovered",
            )
        )

        await session.execute(
            update(
                BotCatalogScan,
            )
            .where(
                BotCatalogScan.id
                == scan_id,
            )
            .values(
                cancel_requested=False,
                finished_at=None,
            )
        )

        await session.commit()


async def scan_snapshot(
    scan_id: UUID | None = None,
) -> dict[str, Any] | None:
    session_factory = (
        get_session_factory()
    )

    async with session_factory() as session:
        if scan_id is None:
            result = await session.execute(
                select(
                    BotCatalogScan,
                )
                .order_by(
                    BotCatalogScan.created_at.desc(),
                )
                .limit(
                    1,
                )
            )
        else:
            result = await session.execute(
                select(
                    BotCatalogScan,
                ).where(
                    BotCatalogScan.id
                    == scan_id,
                )
            )

        scan = (
            result.scalar_one_or_none()
        )

        if scan is None:
            return None

        recent_result = (
            await session.execute(
                select(
                    BotCatalogScanItem,
                )
                .where(
                    BotCatalogScanItem.scan_id
                    == scan.id,
                )
                .order_by(
                    BotCatalogScanItem.created_at.desc(),
                    BotCatalogScanItem.id.desc(),
                )
                .limit(
                    60,
                )
            )
        )

        recent = list(
            recent_result.scalars().all()
        )

        return {
            "id":
                str(
                    scan.id,
                ),
            "state":
                scan.state,
            "auto_ingest":
                scan.auto_ingest,
            "artist_total":
                scan.artist_total,
            "artists_scanned":
                scan.artists_scanned,
            "artist_failures":
                scan.artist_failures,
            "current_artist":
                scan.current_artist,
            "missing_discovered":
                scan.missing_discovered,
            "ingest_started":
                scan.ingest_started,
            "ingest_ready":
                scan.ingest_ready,
            "ingest_failed":
                scan.ingest_failed,
            "started_at":
                (
                    scan.started_at.isoformat()
                    if scan.started_at
                    else None
                ),
            "finished_at":
                (
                    scan.finished_at.isoformat()
                    if scan.finished_at
                    else None
                ),
            "last_error":
                scan.last_error,
            "recent_missing": [
                {
                    "candidate_key":
                        item.candidate_key,
                    "title":
                        str(
                            item.payload.get(
                                "title",
                                "",
                            )
                        ),
                    "artist":
                        str(
                            item.payload.get(
                                "artist",
                                "",
                            )
                        ),
                    "album":
                        item.payload.get(
                            "album",
                        ),
                    "state":
                        item.state,
                    "error":
                        item.error,
                }
                for item in recent
            ],
        }
