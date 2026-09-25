from __future__ import annotations

from collections import deque
from hashlib import sha256
from threading import Lock
from time import monotonic

from fastapi import HTTPException, Request, status


_BUCKETS: dict[
    str,
    deque[float],
] = {}

_LOCK = Lock()

_MAX_BUCKETS = 10_000
_EVICT_BUCKETS = 1_000


def _client_identifier(
    request: Request,
) -> str:
    cloudflare_ip = (
        request.headers.get(
            "cf-connecting-ip",
        )
        or ""
    ).strip()

    if cloudflare_ip:
        return cloudflare_ip[:64]

    forwarded_for = (
        request.headers.get(
            "x-forwarded-for",
        )
        or ""
    )

    if forwarded_for:
        first_hop = (
            forwarded_for
            .split(
                ",",
                1,
            )[0]
            .strip()
        )

        if first_hop:
            return first_hop[:64]

    if request.client:
        return str(
            request.client.host,
        )[:64]

    return "unknown"


def _bucket_key(
    *,
    request: Request,
    scope: str,
    identity: str | None,
) -> str:
    client_key = (
        _client_identifier(
            request,
        )
    )

    identity_key = (
        identity
        .strip()
        .casefold()
        if identity
        else ""
    )

    digest = sha256(
        (
            scope
            + "\x1f"
            + client_key
            + "\x1f"
            + identity_key
        )
        .encode(
            "utf-8",
        )
    ).hexdigest()

    return (
        scope
        + ":"
        + digest
    )


def enforce_rate_limit(
    request: Request,
    *,
    scope: str,
    limit: int,
    window_seconds: int,
    identity: str | None = None,
) -> None:
    if (
        limit <= 0
        or window_seconds <= 0
    ):
        return

    now = monotonic()

    cutoff = (
        now
        - float(
            window_seconds,
        )
    )

    key = _bucket_key(
        request=request,
        scope=scope,
        identity=identity,
    )

    retry_after = 1

    with _LOCK:
        if (
            key not in _BUCKETS
            and len(_BUCKETS)
            >= _MAX_BUCKETS
        ):
            for stale_key in list(
                _BUCKETS,
            )[
                :_EVICT_BUCKETS
            ]:
                _BUCKETS.pop(
                    stale_key,
                    None,
                )

        bucket = _BUCKETS.setdefault(
            key,
            deque(),
        )

        while (
            bucket
            and bucket[0]
            <= cutoff
        ):
            bucket.popleft()

        if len(bucket) >= limit:
            retry_after = max(
                1,
                int(
                    window_seconds
                    - (
                        now
                        - bucket[0]
                    )
                )
                + 1,
            )

        else:
            bucket.append(
                now,
            )

            return

    raise HTTPException(
        status_code=(
            status.HTTP_429_TOO_MANY_REQUESTS
        ),
        detail=(
            "Too many requests. "
            "Try again shortly."
        ),
        headers={
            "Retry-After":
                str(
                    retry_after,
                ),
        },
    )


def reset_rate_limits() -> None:
    with _LOCK:
        _BUCKETS.clear()
