from __future__ import annotations

import asyncio
from typing import Any

from sqlalchemy import select

import bot.service

from backend.app.database import (
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
    artists: list[str],
    existing_identities: set[
        tuple[str, str]
    ],
    *,
    track_limit_per_artist: int,
) -> list[
    CatalogTrackCandidate
]:
    discovered: list[
        CatalogTrackCandidate
    ] = []

    for index, artist in enumerate(
        artists,
        start=1,
    ):
        if _catalog_scan_cancel.is_set():
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

                discovered.extend(
                    missing,
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
            bot.service.catalog_scan_discovery_progress(
                artist=artist,
                artists_scanned=index,
                missing=[],
                error=str(
                    exc,
                ),
            )

    return discovered


async def _ingest_missing(
    candidates: list[
        CatalogTrackCandidate
    ],
    *,
    concurrency: int,
) -> None:
    queue: asyncio.Queue[
        CatalogTrackCandidate
    ] = asyncio.Queue()

    for candidate in candidates:
        queue.put_nowait(
            candidate,
        )

    async def worker() -> None:
        while (
            not _catalog_scan_cancel
            .is_set()
        ):
            try:
                candidate = (
                    queue.get_nowait()
                )
            except asyncio.QueueEmpty:
                return

            bot.service.catalog_scan_ingest_started()

            try:
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

                bot.service.catalog_scan_ingest_finished(
                    ready=ready,
                    error=(
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
                    ),
                )

            except asyncio.CancelledError:
                raise

            except Exception as exc:
                bot.service.catalog_scan_ingest_finished(
                    ready=False,
                    error=str(
                        exc,
                    ),
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
) -> None:
    async with _catalog_scan_lock:
        _catalog_scan_cancel.clear()

        bot.service.job_started(
            "catalog-gap-scan",
        )

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

            if not artists:
                bot.service.catalog_scan_finish()

                bot.service.job_completed(
                    (
                        "Catalog gap scan completed: "
                        "no artists are currently "
                        "in the catalog."
                    )
                )
                return

            discovered = (
                await _discover_missing(
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
            )

            if _catalog_scan_cancel.is_set():
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

            if (
                auto_ingest
                and discovered
            ):
                bot.service.catalog_scan_phase(
                    "ingesting",
                )

                await _ingest_missing(
                    discovered,
                    concurrency=(
                        ingest_concurrency
                    ),
                )

            cancelled = (
                _catalog_scan_cancel
                .is_set()
            )

            bot.service.catalog_scan_finish(
                cancelled=cancelled,
            )

            state = (
                bot.service.get_state()
                .catalog_scan
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
            bot.service.catalog_scan_finish(
                cancelled=True,
            )

            bot.service.job_completed(
                "Catalog gap scan cancelled.",
            )

            raise

        except Exception as exc:
            bot.service.catalog_scan_fail(
                str(
                    exc,
                )
            )

            bot.service.job_failed(
                (
                    "Catalog gap scan failed: "
                    f"{str(exc)[:300]}"
                )
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
