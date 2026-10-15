from __future__ import annotations

from datetime import UTC, datetime, timedelta
from hashlib import sha256
from math import ceil

from fastapi import HTTPException, Request, status
from sqlalchemy import delete, select, text
from sqlalchemy.dialects.postgresql import (
    insert as postgresql_insert,
)

from ..database import get_session_factory
from ..models.system import RateLimitBucket
from ..time_utils import (
    as_utc_aware as _as_utc_aware,
)


def _client_identifier(
    request: Request,
) -> str:
    """
    Use only the ASGI client address.

    Uvicorn is responsible for accepting forwarded headers from trusted
    reverse proxies. Reading CF-Connecting-IP/X-Forwarded-For here would
    let an origin client spoof the address and bypass abuse controls.
    """

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
    include_client: bool,
) -> str:
    client_key = (
        _client_identifier(
            request,
        )
        if include_client
        else ""
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
        scope[:80]
        + ":"
        + digest
    )


async def enforce_rate_limit(
    request: Request,
    *,
    scope: str,
    limit: int,
    window_seconds: int,
    identity: str | None = None,
    include_client: bool = True,
) -> None:
    """
    Apply a database-backed fixed-window rate limit.

    The database makes limits consistent across API replicas and process
    restarts. Set include_client=False for a true account/token-wide limit
    that must not be reset by changing source IPs.
    """

    if (
        limit <= 0
        or window_seconds <= 0
    ):
        return

    key = _bucket_key(
        request=request,
        scope=scope,
        identity=identity,
        include_client=include_client,
    )

    session_factory = (
        get_session_factory()
    )

    now = datetime.now(
        UTC,
    )

    async with session_factory() as session:
        insert_result = await session.execute(
            postgresql_insert(
                RateLimitBucket,
            )
            .values(
                key=key,
                window_started_at=now,
                request_count=1,
                updated_at=now,
            )
            .on_conflict_do_nothing(
                index_elements=[
                    RateLimitBucket.key,
                ],
            )
            .returning(
                RateLimitBucket.key,
            )
        )

        if (
            insert_result
            .scalar_one_or_none()
            is not None
        ):
            await session.commit()
            return

        result = await session.execute(
            select(
                RateLimitBucket,
            )
            .where(
                RateLimitBucket.key
                == key,
            )
            .with_for_update()
        )

        bucket = (
            result
            .scalar_one()
        )

        window_started_at = (
            _as_utc_aware(
                bucket
                .window_started_at,
            )
        )

        elapsed = (
            now
            - window_started_at
        ).total_seconds()

        if (
            elapsed >=
            float(
                window_seconds,
            )
        ):
            bucket.window_started_at = (
                now
            )

            bucket.request_count = (
                1
            )

            bucket.updated_at = (
                now
            )

            await session.commit()
            return

        if (
            bucket.request_count
            >= limit
        ):
            retry_after = max(
                1,
                ceil(
                    float(
                        window_seconds,
                    )
                    - elapsed,
                ),
            )

            raise HTTPException(
                status_code=(
                    status
                    .HTTP_429_TOO_MANY_REQUESTS
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

        bucket.request_count += (
            1
        )

        bucket.updated_at = (
            now
        )

        await session.commit()



async def cleanup_stale_rate_limits(
    *,
    now: datetime | None = None,
) -> None:
    """Delete expired limiter buckets outside request handling.

    Every API replica may run this maintenance task. A PostgreSQL advisory
    transaction lock ensures only one replica performs the indexed delete at
    a time, so cleanup cannot turn a deployment into a thundering herd.
    """

    reference = (
        now
        if now is not None
        else datetime.now(
            UTC,
        )
    )

    session_factory = (
        get_session_factory()
    )

    async with session_factory() as session:
        lock_result = await session.execute(
            text(
                "SELECT pg_try_advisory_xact_lock("
                "hashtext(:lock_key)"
                ")"
            ),
            {
                "lock_key":
                    "hypersync:rate-limit-cleanup",
            },
        )

        if not bool(
            lock_result.scalar_one(),
        ):
            await session.rollback()
            return

        await session.execute(
            delete(
                RateLimitBucket,
            ).where(
                RateLimitBucket.updated_at
                < (
                    reference
                    - timedelta(
                        days=2,
                    )
                ),
            )
        )

        await session.commit()


async def reset_rate_limits() -> None:
    session_factory = (
        get_session_factory()
    )

    async with session_factory() as session:
        await session.execute(
            delete(
                RateLimitBucket,
            )
        )

        await session.commit()
