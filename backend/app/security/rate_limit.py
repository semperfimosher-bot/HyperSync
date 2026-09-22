from __future__ import annotations

from collections import defaultdict, deque
from threading import Lock
from time import monotonic

from fastapi import HTTPException, Request, status


_EVENTS: dict[str, deque[float]] = defaultdict(deque)
_LOCK = Lock()


def _client_key(request: Request) -> str:
    if request.client is None or not request.client.host:
        return "unknown"
    return request.client.host


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

        if not events:
            _EVENTS.pop(key, None)
