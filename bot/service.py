from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from threading import Lock
from uuid import uuid4


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
        return BotState(
            running=_state.running,
            status=_state.status,
            current_job=_state.current_job,
            queued_jobs=_state.queued_jobs,
            completed_jobs=_state.completed_jobs,
            failed_jobs=_state.failed_jobs,
            events=list(_state.events),
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
        _state.current_job = None
        _state.completed_jobs += 1

    _event("success", message)


def job_failed(
    message: str,
) -> None:
    with _lock:
        _state.current_job = None
        _state.failed_jobs += 1

    _event("error", message)


def queue_job() -> None:
    with _lock:
        _state.queued_jobs += 1
