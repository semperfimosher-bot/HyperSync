from __future__ import annotations

from collections import defaultdict, deque
from threading import Lock
from time import monotonic

from fastapi import HTTPException, Request, status


_EVENTS: dict[str, deque[float]] = defaultdict(deque)
_LOCK = Lock()

_MAX_TRACKED_KEYS = 10_000
_CLEANUP_EVERY = 256
_REQUEST_COUNT = 0


def _client_key(request: Request) -> str:
    if request.client is None or not request.client.host:
        return "unknown"
    return request.client.host


def _cleanup_stale_events(
    now: float,
    window_seconds: int,
) -> None:
    global _REQUEST_COUNT

    _REQUEST_COUNT += 1

    if (
        _REQUEST_COUNT % _CLEANUP_EVERY != 0
        and len(_EVENTS) < _MAX_TRACKED_KEYS
    ):
        return

    cutoff = now - window_seconds

    for key in list(_EVENTS):
        events = _EVENTS.get(key)

        if not events:
            _EVENTS.pop(key, None)
            continue

        while events and events[0] <= cutoff:
            events.popleft()

        if not events:
            _EVENTS.pop(key, None)

    while len(_EVENTS) >= _MAX_TRACKED_KEYS:
        oldest_key = next(iter(_EVENTS), None)

        if oldest_key is None:
            break

        _EVENTS.pop(oldest_key, None)


def enforce_rate_limit(
    request: Request,
    *,
    bucket: str,
    limit: int,
    window_seconds: int,
    discriminator: str | None = None,
) -> None:
    """Small in-process rate limiter for abuse-sensitive endpoints.

    Production edge/CDN limits are still recommended. This guard gives each
    backend worker a safe baseline even when the edge is misconfigured.
    """

    if limit <= 0 or window_seconds <= 0:
        return

    suffix = (discriminator or "").strip().casefold()
    key = f"{bucket}:{_client_key(request)}:{suffix}"
    now = monotonic()
    cutoff = now - window_seconds

    with _LOCK:
        _cleanup_stale_events(
            now,
            window_seconds,
        )

        events = _EVENTS[key]

        while events and events[0] <= cutoff:
            events.popleft()

        if len(events) >= limit:
            retry_after = max(
                1,
                int(window_seconds - (now - events[0])),
            )
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many requests. Try again shortly.",
                headers={"Retry-After": str(retry_after)},
            )

        events.append(now)
