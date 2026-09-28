from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from threading import Lock
from typing import Any
from uuid import uuid4


def _blank_catalog_scan() -> dict[str, Any]:
    return {
        "state": "idle",
        "auto_ingest": False,
        "artist_total": 0,
        "artists_scanned": 0,
        "artist_failures": 0,
        "current_artist": None,
        "missing_discovered": 0,
        "ingest_started": 0,
        "ingest_ready": 0,
        "ingest_failed": 0,
        "started_at": None,
        "finished_at": None,
        "last_error": None,
        "recent_missing": [],
    }


@dataclass
class BotEvent:
    id: str
    timestamp: datetime
    level: str
    message: str


@dataclass
class BotState:
    running: bool = False
    status: str = "offline"
    current_job: str | None = None
    queued_jobs: int = 0
    completed_jobs: int = 0
    failed_jobs: int = 0
    events: list[BotEvent] = field(default_factory=list)
    catalog_scan: dict[str, Any] = field(
        default_factory=_blank_catalog_scan
    )


_state = BotState()
_lock = Lock()


def _event(
    level: str,
    message: str,
) -> None:
    with _lock:
        _state.events.insert(
            0,
            BotEvent(
                id=str(uuid4()),
                timestamp=datetime.now(UTC),
                level=level,
                message=message,
            ),
        )

        _state.events = _state.events[:100]


def get_state() -> BotState:
    with _lock:
        scan = dict(
            _state.catalog_scan
        )
        scan["recent_missing"] = [
            dict(item)
            for item in scan.get(
                "recent_missing",
                [],
            )
            if isinstance(
                item,
                dict,
            )
        ]

        return BotState(
            running=_state.running,
            status=_state.status,
            current_job=_state.current_job,
            queued_jobs=_state.queued_jobs,
            completed_jobs=_state.completed_jobs,
            failed_jobs=_state.failed_jobs,
            events=list(_state.events),
            catalog_scan=scan,
        )


def start_bot() -> BotState:
    with _lock:
        _state.running = True
        _state.status = "online"

    _event("success", "Bot started.")
    return get_state()


def stop_bot() -> BotState:
    with _lock:
        _state.running = False
        _state.status = "offline"
        _state.current_job = None

    _event("info", "Bot stopped.")
    return get_state()


def set_job(
    job_name: str | None,
) -> None:
    with _lock:
        _state.current_job = job_name


def job_started(
    job_name: str,
) -> None:
    with _lock:
        _state.running = True
        _state.status = "running"
        _state.queued_jobs = max(
            0,
            _state.queued_jobs - 1,
        )
        _state.current_job = job_name

    _event(
        "info",
        f"Started job: {job_name}",
    )


def job_completed(
    message: str,
) -> None:
    with _lock:
        _state.running = True
        _state.status = "online"
        _state.current_job = None
        _state.completed_jobs += 1

    _event("success", message)


def job_failed(
    message: str,
) -> None:
    with _lock:
        _state.running = True
        _state.status = "online"
        _state.current_job = None
        _state.failed_jobs += 1

    _event("error", message)


def queue_job() -> None:
    with _lock:
        _state.queued_jobs += 1


def catalog_scan_active() -> bool:
    with _lock:
        return (
            _state.catalog_scan.get(
                "state",
            )
            in {
                "discovering",
                "ingesting",
                "cancelling",
            }
        )


def catalog_scan_begin(
    *,
    auto_ingest: bool,
    artist_total: int,
) -> None:
    with _lock:
        _state.catalog_scan = {
            **_blank_catalog_scan(),
            "state": "discovering",
            "auto_ingest": bool(
                auto_ingest
            ),
            "artist_total": max(
                0,
                int(
                    artist_total,
                ),
            ),
            "started_at": (
                datetime.now(
                    UTC,
                ).isoformat()
            ),
        }

    _event(
        "info",
        (
            "Catalog gap scan started for "
            f"{artist_total} artist"
            + (
                ""
                if artist_total == 1
                else "s"
            )
            + "."
        ),
    )


def catalog_scan_phase(
    phase: str,
) -> None:
    with _lock:
        _state.catalog_scan[
            "state"
        ] = phase


def catalog_scan_discovery_progress(
    *,
    artist: str,
    artists_scanned: int,
    missing: list[dict[str, Any]],
    error: str | None = None,
) -> None:
    with _lock:
        scan = _state.catalog_scan
        scan[
            "current_artist"
        ] = artist
        scan[
            "artists_scanned"
        ] = max(
            scan.get(
                "artists_scanned",
                0,
            ),
            int(
                artists_scanned,
            ),
        )

        if error:
            scan[
                "artist_failures"
            ] = int(
                scan.get(
                    "artist_failures",
                    0,
                )
                or 0
            ) + 1
            scan[
                "last_error"
            ] = error[:400]

        if missing:
            scan[
                "missing_discovered"
            ] = int(
                scan.get(
                    "missing_discovered",
                    0,
                )
                or 0
            ) + len(
                missing
            )

            recent = [
                {
                    "candidate_key":
                        str(
                            item.get(
                                "candidate_key",
                                "",
                            )
                        ),
                    "title":
                        str(
                            item.get(
                                "title",
                                "",
                            )
                        ),
                    "artist":
                        str(
                            item.get(
                                "artist",
                                "",
                            )
                        ),
                    "album":
                        (
                            str(
                                item.get(
                                    "album",
                                )
                            )
                            if item.get(
                                "album",
                            )
                            else None
                        ),
                }
                for item in missing
            ]

            scan[
                "recent_missing"
            ] = (
                recent
                + list(
                    scan.get(
                        "recent_missing",
                        [],
                    )
                )
            )[:60]


def catalog_scan_ingest_started() -> None:
    with _lock:
        scan = _state.catalog_scan
        scan[
            "ingest_started"
        ] = int(
            scan.get(
                "ingest_started",
                0,
            )
            or 0
        ) + 1


def catalog_scan_ingest_finished(
    *,
    ready: bool,
    error: str | None = None,
) -> None:
    with _lock:
        scan = _state.catalog_scan

        key = (
            "ingest_ready"
            if ready
            else "ingest_failed"
        )

        scan[
            key
        ] = int(
            scan.get(
                key,
                0,
            )
            or 0
        ) + 1

        if error:
            scan[
                "last_error"
            ] = error[:400]


def catalog_scan_finish(
    *,
    cancelled: bool = False,
) -> None:
    with _lock:
        scan = _state.catalog_scan
        scan[
            "state"
        ] = (
            "cancelled"
            if cancelled
            else "complete"
        )
        scan[
            "current_artist"
        ] = None
        scan[
            "finished_at"
        ] = datetime.now(
            UTC,
        ).isoformat()


def catalog_scan_fail(
    message: str,
) -> None:
    with _lock:
        scan = _state.catalog_scan
        scan[
            "state"
        ] = "failed"
        scan[
            "current_artist"
        ] = None
        scan[
            "last_error"
        ] = message[:400]
        scan[
            "finished_at"
        ] = datetime.now(
            UTC,
        ).isoformat()
