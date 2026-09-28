from __future__ import annotations

import asyncio
from typing import Any
from uuid import UUID

from sqlalchemy import (
    select,
    text,
)

import bot.service
from bot.runtime import (
    spawn_background_task,
)

from backend.app.database import (
    get_engine,
    get_session_factory,
)
from backend.app.models.media import (
    Track,
)
from backend.app.services.audio_metadata import (
    normalize_track_identity,
    normalize_track_title_identity,
    primary_artist_credit,
)
from backend.app.services.bot_catalog_jobs import (
    active_catalog_scan,
    create_catalog_scan,
    fail_scan,
    finish_scan,
    mark_item_finished,
    mark_item_started,
    pending_scan_items,
    persist_discovered_candidates,
    prepare_scan_for_resume,
    scan_cancel_requested,
    scan_snapshot,
    set_scan_discovery_progress,
    set_scan_discovery_start,
    set_scan_phase,
)
from backend.app.services.on_demand_ingestion import (
    ingest_candidate_and_wait,
    remember_candidates,
)
from backend.app.services.on_demand_metadata import (
    CatalogTrackCandidate,
    search_catalog_metadata,
)


_catalog_scan_lock = asyncio.Lock()
_catalog_scan_cancel = asyncio.Event()


async def _acquire_distributed_scan_lock(
    scan_id: UUID,
):
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
                        "hypersync:catalog-scan:"
                        + str(
                            scan_id,
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


async def _release_distributed_scan_lock(
    scan_id: UUID,
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
                        "hypersync:catalog-scan:"
                        + str(
                            scan_id,
                        )
                    ),
            },
        )
    finally:
        await connection.close()


def scan_running() -> bool:
    return (
        _catalog_scan_lock.locked()
        or bot.service.catalog_scan_active()
    )


def cancel_scan() -> bool:
    if not scan_running():
        return False

    _catalog_scan_cancel.set()
    bot.service.catalog_scan_phase(
        "cancelling",
    )
    return True


async def _scan_cancelled(
    scan_id: UUID,
) -> bool:
    if _catalog_scan_cancel.is_set():
        return True

    if await scan_cancel_requested(
        scan_id,
    ):
        _catalog_scan_cancel.set()

        bot.service.catalog_scan_phase(
            "cancelling",
        )

        return True

    return False


async def _catalog_inventory() -> tuple[
    list[str],
    set[tuple[str, str]],
]:
    session_factory = (
        get_session_factory()
    )

    async with session_factory() as session:
        result = await session.execute(
            select(
                Track.artist,
                Track.title,
            )
            .where(
                Track.is_published.is_(
                    True,
                )
            )
        )

        rows = list(
            result.all()
        )

    artists_by_key: dict[
        str,
        str,
    ] = {}

    existing_identities: set[
        tuple[str, str]
    ] = set()

    for artist, title in rows:
        primary_artist = (
            primary_artist_credit(
                artist,
            )
        )

        artist_key = (
            normalize_track_identity(
                primary_artist,
            )
        )

        title_key = (
            normalize_track_title_identity(
                title,
            )
        )

        if (
            artist_key
            and title_key
        ):
            existing_identities.add(
                (
                    artist_key,
                    title_key,
                )
            )

        if (
            artist_key
            and artist_key
            not in artists_by_key
        ):
            artists_by_key[
                artist_key
            ] = primary_artist

    artists = sorted(
        artists_by_key.values(),
        key=str.casefold,
    )

    return (
        artists,
        existing_identities,
    )


def _candidate_identity(
    candidate: CatalogTrackCandidate,
) -> tuple[str, str]:
    return (
        normalize_track_identity(
            primary_artist_credit(
                candidate.artist,
            )
        ),
        normalize_track_title_identity(
            candidate.title,
        ),
    )


def _candidate_preview(
    candidate: CatalogTrackCandidate,
) -> dict[str, Any]:
    return {
        "candidate_key":
            candidate.key,
        "title":
            candidate.title,
        "artist":
            candidate.artist,
        "album":
            candidate.album,
    }


async def _discover_missing(
    scan_id: UUID,
    artists: list[str],
    existing_identities: set[
        tuple[str, str]
    ],
    *,
    track_limit_per_artist: int,
) -> None:
    for index, artist in enumerate(
        artists,
        start=1,
    ):
        if await _scan_cancelled(
            scan_id,
        ):
            break

        try:
            candidates = (
                await search_catalog_metadata(
                    artist,
                    kind="artist",
                    limit=(
                        track_limit_per_artist
                    ),
                )
            )

            missing: list[
                CatalogTrackCandidate
            ] = []

            for candidate in candidates:
                identity = (
                    _candidate_identity(
                        candidate,
                    )
                )

                if (
                    not all(
                        identity
                    )
                    or identity
                    in existing_identities
                ):
                    continue

                existing_identities.add(
                    identity,
                )

                missing.append(
                    candidate,
                )

            if missing:
                await remember_candidates(
                    missing,
                )

                await persist_discovered_candidates(
                    scan_id,
                    missing,
                )

            await set_scan_discovery_progress(
                scan_id,
                artist=artist,
                artists_scanned=index,
            )

            bot.service.catalog_scan_discovery_progress(
                artist=artist,
                artists_scanned=index,
                missing=[
                    _candidate_preview(
                        candidate,
                    )
                    for candidate
                    in missing
                ],
            )

        except asyncio.CancelledError:
            raise

        except Exception as exc:
            message = str(
                exc,
            )

            await set_scan_discovery_progress(
                scan_id,
                artist=artist,
                artists_scanned=index,
                error=message,
            )

            bot.service.catalog_scan_discovery_progress(
                artist=artist,
                artists_scanned=index,
                missing=[],
                error=message,
            )


async def _ingest_missing(
    scan_id: UUID,
    items: list[
        tuple[
            UUID,
            CatalogTrackCandidate,
        ]
    ],
    *,
    concurrency: int,
) -> None:
    queue: asyncio.Queue[
        tuple[
            UUID,
            CatalogTrackCandidate,
        ]
    ] = asyncio.Queue()

    for item in items:
        queue.put_nowait(
            item,
        )

    async def worker() -> None:
        while True:
            if await _scan_cancelled(
                scan_id,
            ):
                return

            try:
                (
                    item_id,
                    candidate,
                ) = queue.get_nowait()
            except asyncio.QueueEmpty:
                return

            try:
                await remember_candidates(
                    [
                        candidate,
                    ],
                )

                await mark_item_started(
                    scan_id,
                    item_id,
                )

                bot.service.catalog_scan_ingest_started()

                result = (
                    await ingest_candidate_and_wait(
                        candidate.key,
                    )
                )

                ready = (
                    result.get(
                        "state",
                    )
                    == "ready"
                    and bool(
                        result.get(
                            "track_id",
                        )
                    )
                )

                error = (
                    None
                    if ready
                    else str(
                        result.get(
                            "error",
                        )
                        or (
                            "Ingest did not "
                            "reach ready state."
                        )
                    )
                )

                await mark_item_finished(
                    scan_id,
                    item_id,
                    ready=ready,
                    track_id=(
                        result.get(
                            "track_id",
                        )
                    ),
                    error=error,
                )

                bot.service.catalog_scan_ingest_finished(
                    ready=ready,
                    error=error,
                )

            except asyncio.CancelledError:
                # Leave the durable item as ingesting.
                # Startup recovery resets it to discovered
                # so a process restart can safely retry.
                raise

            except Exception as exc:
                message = str(
                    exc,
                )

                await mark_item_finished(
                    scan_id,
                    item_id,
                    ready=False,
                    error=message,
                )

                bot.service.catalog_scan_ingest_finished(
                    ready=False,
                    error=message,
                )

            finally:
                queue.task_done()

    worker_count = max(
        1,
        min(
            int(
                concurrency,
            ),
            4,
        ),
    )

    tasks = [
        asyncio.create_task(
            worker()
        )
        for _index in range(
            worker_count
        )
    ]

    await asyncio.gather(
        *tasks,
        return_exceptions=False,
    )


async def run_scan(
    *,
    auto_ingest: bool = False,
    track_limit_per_artist: int = 500,
    ingest_concurrency: int = 2,
    scan_id: UUID | None = None,
    resume: bool = False,
) -> None:
    async with _catalog_scan_lock:
        _catalog_scan_cancel.clear()

        if scan_id is None:
            scan = await create_catalog_scan(
                auto_ingest=auto_ingest,
                track_limit_per_artist=(
                    track_limit_per_artist
                ),
                ingest_concurrency=(
                    ingest_concurrency
                ),
            )

            scan_id = scan.id

        (
            distributed_acquired,
            distributed_connection,
        ) = await _acquire_distributed_scan_lock(
            scan_id,
        )

        if not distributed_acquired:
            return

        if resume:
            await prepare_scan_for_resume(
                scan_id,
            )

        bot.service.job_started(
            "catalog-gap-scan",
        )

        phase = "discovering"

        try:
            (
                artists,
                existing_identities,
            ) = await _catalog_inventory()

            bot.service.catalog_scan_begin(
                auto_ingest=auto_ingest,
                artist_total=len(
                    artists,
                ),
            )

            await set_scan_discovery_start(
                scan_id,
                artist_total=len(
                    artists,
                ),
                resume=resume,
            )

            if not artists:
                await finish_scan(
                    scan_id,
                )

                bot.service.catalog_scan_finish()

                bot.service.job_completed(
                    (
                        "Catalog gap scan completed: "
                        "no artists are currently "
                        "in the catalog."
                    )
                )
                return

            await _discover_missing(
                scan_id,
                artists,
                existing_identities,
                track_limit_per_artist=max(
                    1,
                    min(
                        int(
                            track_limit_per_artist,
                        ),
                        500,
                    ),
                ),
            )

            if await _scan_cancelled(
                scan_id,
            ):
                await finish_scan(
                    scan_id,
                    cancelled=True,
                )

                bot.service.catalog_scan_finish(
                    cancelled=True,
                )

                bot.service.job_completed(
                    (
                        "Catalog gap scan cancelled "
                        "during discovery."
                    )
                )
                return

            if auto_ingest:
                pending = (
                    await pending_scan_items(
                        scan_id,
                    )
                )

                if pending:
                    phase = "ingesting"

                    await set_scan_phase(
                        scan_id,
                        phase,
                    )

                    bot.service.catalog_scan_phase(
                        phase,
                    )

                    await _ingest_missing(
                        scan_id,
                        pending,
                        concurrency=(
                            ingest_concurrency
                        ),
                    )

            cancelled = (
                await _scan_cancelled(
                    scan_id,
                )
            )

            await finish_scan(
                scan_id,
                cancelled=cancelled,
            )

            bot.service.catalog_scan_finish(
                cancelled=cancelled,
            )

            state = (
                await scan_snapshot(
                    scan_id,
                )
                or {}
            )

            if cancelled:
                message = (
                    "Catalog gap scan cancelled."
                )
            elif auto_ingest:
                message = (
                    "Catalog gap scan completed: "
                    f"{state.get('missing_discovered', 0)} "
                    "missing tracks found, "
                    f"{state.get('ingest_ready', 0)} "
                    "published, "
                    f"{state.get('ingest_failed', 0)} "
                    "failed."
                )
            else:
                message = (
                    "Catalog gap scan completed: "
                    f"{state.get('missing_discovered', 0)} "
                    "missing tracks discovered."
                )

            bot.service.job_completed(
                message,
            )

        except asyncio.CancelledError:
            # Process/container shutdown is not the same as
            # the user pressing Cancel. Keep the durable scan
            # active so startup recovery can resume it.
            if _catalog_scan_cancel.is_set():
                await finish_scan(
                    scan_id,
                    cancelled=True,
                )

            bot.service.catalog_scan_phase(
                phase,
            )

            raise

        except Exception as exc:
            message = str(
                exc,
            )

            await fail_scan(
                scan_id,
                message,
            )

            bot.service.catalog_scan_fail(
                message,
            )

            bot.service.job_failed(
                (
                    "Catalog gap scan failed: "
                    f"{message[:300]}"
                )
            )

        finally:
            await _release_distributed_scan_lock(
                scan_id,
                distributed_connection,
            )


async def resume_catalog_scan_on_startup() -> asyncio.Task | None:
    scan = await active_catalog_scan()

    if scan is None:
        return None

    if (
        scan.state == "cancelling"
        or scan.cancel_requested
    ):
        await finish_scan(
            scan.id,
            cancelled=True,
        )

        return None

    return spawn_background_task(
        run_scan(
            auto_ingest=(
                scan.auto_ingest
            ),
            track_limit_per_artist=(
                scan.track_limit_per_artist
            ),
            ingest_concurrency=(
                scan.ingest_concurrency
            ),
            scan_id=scan.id,
            resume=True,
        ),
        name=(
            "catalog-scan-resume:"
            + str(
                scan.id,
            )
        ),
    )


async def run_process() -> None:
    bot.service.job_started(
        "process-queue",
    )

    try:
        # Retain the legacy processing hook.
        # Active on-demand and catalog-gap
        # ingestion already use the production
        # publish pipeline directly.
        await asyncio.sleep(
            1,
        )

        bot.service.job_completed(
            "Processing queue completed.",
        )

    except Exception as exc:
        bot.service.job_failed(
            f"Processing failed: {exc}",
        )
