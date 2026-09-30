from __future__ import annotations

import logging
from datetime import (
    UTC,
    datetime,
    timedelta,
)
from typing import Any, cast
from uuid import UUID, uuid4

from sqlalchemy import (
    delete,
    or_,
    select,
    text,
    update,
)
from sqlalchemy.dialects.postgresql import (
    insert as postgresql_insert,
)
from sqlalchemy.dialects.sqlite import (
    insert as sqlite_insert,
)
from sqlalchemy.engine import CursorResult
from sqlalchemy.exc import (
    SQLAlchemyError,
)

from ..config import get_settings
from ..database import (
    get_session_factory,
)
from ..models.account import (
    ListeningEvent,
)
from ..models.on_demand import (
    OnDemandCandidate,
    OnDemandPendingListener,
    OnDemandProvision,
)
from ..time_utils import (
    as_utc_aware as _as_utc_aware,
)
from .on_demand_metadata import (
    CatalogTrackCandidate,
)

logger = logging.getLogger(
    __name__,
)

_ACTIVE_LONG_RUNNING_STATES = (
    "resolving",
    "ingesting",
)

_persistence_warning_emitted = False


def _now() -> datetime:
    return datetime.now(
        UTC,
    )


def _expires_at() -> datetime:
    ttl = max(
        int(
            get_settings()
            .on_demand_session_ttl_seconds
        ),
        60,
    )

    return _now() + timedelta(
        seconds=ttl,
    )


def _warn_once(
    operation: str,
) -> None:
    global _persistence_warning_emitted

    if _persistence_warning_emitted:
        return

    _persistence_warning_emitted = True

    logger.warning(
        (
            "Durable on-demand state is unavailable "
            "during %s; falling back to process-local "
            "state for this backend instance."
        ),
        operation,
        exc_info=True,
    )


def _provision_dict(
    row: OnDemandProvision,
) -> dict[str, Any]:
    return {
        "id":
            row.id,
        "candidate_key":
            row.candidate_key,
        "candidate_payload":
            dict(
                row.candidate_payload
                or {}
            ),
        "state":
            row.state,
        "source_payload":
            (
                dict(
                    row.source_payload,
                )
                if row.source_payload
                is not None
                else None
            ),
        "track_id":
            row.track_id,
        "error":
            row.error,
        "ingest_started":
            bool(
                row.ingest_started,
            ),
        "expires_at":
            _as_utc_aware(
                row.expires_at,
            ),
    }


async def durable_state_diagnostics() -> dict[str, Any]:
    """Verify the durable on-demand schema is queryable."""

    session_factory = (
        get_session_factory()
    )

    try:
        async with session_factory() as session:
            await session.execute(
                select(
                    OnDemandProvision.id,
                ).limit(
                    1,
                )
            )

        return {
            "healthy": True,
            "message":
                "Durable on-demand state is available.",
        }

    except SQLAlchemyError as exc:
        return {
            "healthy": False,
            "message":
                str(
                    exc,
                )[:240],
        }


async def persist_candidates(
    candidates: list[
        CatalogTrackCandidate
    ],
) -> bool:
    if not candidates:
        return True

    session_factory = (
        get_session_factory()
    )

    try:
        async with session_factory() as session:
            now = _now()
            expiry = _expires_at()

            # Provider results can overlap across requests. Collapse duplicate
            # keys in one batch and use a database upsert so concurrent batches
            # cannot race between SELECT and INSERT on the candidate PK.
            unique_candidates = {
                candidate.key: candidate
                for candidate in candidates
            }
            rows = [
                {
                    "candidate_key": candidate.key,
                    "payload": candidate.as_dict(),
                    "expires_at": expiry,
                }
                for candidate in unique_candidates.values()
            ]

            dialect_name = session.get_bind().dialect.name
            if dialect_name == "postgresql":
                dialect_insert = postgresql_insert
            elif dialect_name == "sqlite":
                dialect_insert = sqlite_insert
            else:
                _warn_once("candidate persistence with unsupported database")
                return False

            await session.execute(
                delete(
                    OnDemandCandidate,
                ).where(
                    OnDemandCandidate.expires_at
                    < now,
                )
            )

            statement = dialect_insert(
                OnDemandCandidate,
            ).values(
                rows,
            )
            await session.execute(
                statement.on_conflict_do_update(
                    index_elements=[
                        OnDemandCandidate.candidate_key,
                    ],
                    set_={
                        "payload": statement.excluded.payload,
                        "expires_at": statement.excluded.expires_at,
                        "updated_at": now,
                    },
                )
            )

            await session.commit()

        return True

    except SQLAlchemyError:
        _warn_once(
            "candidate persistence",
        )
        return False


async def load_candidate(
    candidate_key: str,
) -> CatalogTrackCandidate | None:
    clean = candidate_key.strip()

    if not clean:
        return None

    session_factory = (
        get_session_factory()
    )

    try:
        async with session_factory() as session:
            row = await session.get(
                OnDemandCandidate,
                clean,
            )

            if row is None:
                return None

            if _as_utc_aware(
                    row.expires_at,
                ) < _now():
                await session.delete(
                    row,
                )
                await session.commit()
                return None

            row.expires_at = _expires_at()
            row.updated_at = _now()

            payload = dict(
                row.payload
                or {}
            )

            await session.commit()

        candidate = (
            CatalogTrackCandidate
            .from_dict(
                payload,
            )
        )

        return (
            candidate
            if candidate.key
            else None
        )

    except SQLAlchemyError:
        _warn_once(
            "candidate lookup",
        )
        return None


async def get_or_create_provision(
    candidate: CatalogTrackCandidate,
) -> dict[str, Any] | None:
    session_factory = (
        get_session_factory()
    )

    try:
        async with session_factory() as session:
            bind = session.get_bind()

            if (
                bind is not None
                and bind.dialect.name
                == "postgresql"
            ):
                await session.execute(
                    text(
                        "SELECT "
                        "pg_advisory_xact_lock("
                        "hashtext(:key)"
                        ")"
                    ),
                    {
                        "key":
                            (
                                "hypersync:"
                                "on-demand-provision:"
                                + candidate.key
                            ),
                    },
                )

            now = _now()

            result = await session.execute(
                select(
                    OnDemandProvision,
                )
                .where(
                    OnDemandProvision.candidate_key
                    == candidate.key,
                    OnDemandProvision.state
                    != "failed",
                    or_(
                        OnDemandProvision.expires_at
                        > now,
                        OnDemandProvision.state.in_(
                            _ACTIVE_LONG_RUNNING_STATES,
                        ),
                    ),
                )
                .order_by(
                    OnDemandProvision.updated_at
                    .desc(),
                )
                .limit(
                    1,
                )
            )

            row = (
                result.scalar_one_or_none()
            )

            if row is None:
                row = OnDemandProvision(
                    id=uuid4(),
                    candidate_key=(
                        candidate.key
                    ),
                    candidate_payload=(
                        candidate.as_dict()
                    ),
                    state="queued",
                    source_payload=None,
                    track_id=None,
                    error=None,
                    ingest_started=False,
                    expires_at=(
                        _expires_at()
                    ),
                )

                session.add(
                    row,
                )
            else:
                row.candidate_payload = (
                    candidate.as_dict()
                )
                row.expires_at = (
                    _expires_at()
                )
                row.updated_at = now

            await session.commit()

            return _provision_dict(
                row,
            )

    except SQLAlchemyError:
        _warn_once(
            "provision creation",
        )
        return None


async def load_provision(
    provision_id: UUID,
) -> dict[str, Any] | None:
    session_factory = (
        get_session_factory()
    )

    try:
        async with session_factory() as session:
            row = await session.get(
                OnDemandProvision,
                provision_id,
            )

            if row is None:
                return None

            if (
                _as_utc_aware(
                    row.expires_at,
                ) < _now()
                and row.state
                not in _ACTIVE_LONG_RUNNING_STATES
            ):
                await session.delete(
                    row,
                )
                await session.commit()
                return None

            row.expires_at = _expires_at()
            row.updated_at = _now()

            await session.commit()

            return _provision_dict(
                row,
            )

    except SQLAlchemyError:
        _warn_once(
            "provision lookup",
        )
        return None


async def save_provision(
    *,
    provision_id: UUID,
    candidate: CatalogTrackCandidate,
    state: str,
    source_payload: dict[str, Any] | None,
    track_id: UUID | None,
    error: str | None,
    ingest_started: bool,
) -> bool:
    """Persist provision state without allowing stale regressions.

    Multiple API replicas can resolve the same provision at
    different speeds. Terminal durable states are therefore
    monotonic: ready is strongest; failed can only be replaced
    by a real successful publish; nonterminal writers can
    never move a terminal row backward.
    """

    if (
        state == "ready"
        and track_id is None
    ):
        # "ready" is an externally visible guarantee that a
        # permanent catalog track exists. Never persist an
        # impossible terminal state.
        return False

    session_factory = (
        get_session_factory()
    )

    try:
        async with session_factory() as session:
            row = await session.get(
                OnDemandProvision,
                provision_id,
            )

            now = _now()
            expiry = _expires_at()

            if row is None:
                row = OnDemandProvision(
                    id=provision_id,
                    candidate_key=(
                        candidate.key
                    ),
                    candidate_payload=(
                        candidate.as_dict()
                    ),
                    state=(
                        "ready"
                        if track_id is not None
                        else state
                    ),
                    source_payload=(
                        source_payload
                    ),
                    track_id=track_id,
                    error=(
                        None
                        if track_id is not None
                        else error
                    ),
                    ingest_started=(
                        ingest_started
                        or track_id is not None
                    ),
                    expires_at=expiry,
                )

                session.add(
                    row,
                )

                await session.commit()

                return True

            values = {
                "candidate_key":
                    candidate.key,
                "candidate_payload":
                    candidate.as_dict(),
                "state":
                    (
                        "ready"
                        if track_id is not None
                        else state
                    ),
                "source_payload":
                    source_payload,
                "track_id":
                    track_id,
                "error":
                    (
                        None
                        if track_id is not None
                        else error
                    ),
                "ingest_started":
                    (
                        bool(
                            ingest_started
                        )
                        or track_id is not None
                    ),
                "expires_at":
                    expiry,
                "updated_at":
                    now,
            }

            statement = (
                update(
                    OnDemandProvision,
                )
                .where(
                    OnDemandProvision.id
                    == provision_id,
                )
            )

            incoming_ready = (
                track_id is not None
            )

            if incoming_ready:
                # A successful publish may recover a provision
                # that another replica previously marked failed.
                pass

            elif state == "failed":
                # Failure may finalize active work, but it may
                # never erase a successful result.
                statement = statement.where(
                    OnDemandProvision.track_id.is_(
                        None,
                    ),
                    OnDemandProvision.state
                    != "ready",
                )

            else:
                # Resolving/queued/stream-ready/ingesting are
                # transient observations. Never let a stale
                # replica overwrite either terminal state.
                statement = statement.where(
                    OnDemandProvision.track_id.is_(
                        None,
                    ),
                    OnDemandProvision.state.not_in(
                        (
                            "ready",
                            "failed",
                        )
                    ),
                )

            result = await session.execute(
                statement.values(
                    **values,
                )
            )

            await session.commit()

            return bool(
                cast(CursorResult[Any], result).rowcount,
            )

    except SQLAlchemyError:
        _warn_once(
            "provision persistence",
        )
        return False


async def touch_provision(
    provision_id: UUID,
) -> None:
    session_factory = (
        get_session_factory()
    )

    try:
        async with session_factory() as session:
            row = await session.get(
                OnDemandProvision,
                provision_id,
            )

            if row is None:
                return

            row.expires_at = _expires_at()
            row.updated_at = _now()

            await session.commit()

    except SQLAlchemyError:
        _warn_once(
            "provision touch",
        )


async def add_pending_listener(
    provision_id: UUID,
    user_id: UUID,
) -> None:
    session_factory = (
        get_session_factory()
    )

    try:
        async with session_factory() as session:
            provision = await session.get(
                OnDemandProvision,
                provision_id,
            )

            if provision is None:
                return

            existing = await session.get(
                OnDemandPendingListener,
                {
                    "provision_id":
                        provision_id,
                    "user_id":
                        user_id,
                },
            )

            if existing is None:
                session.add(
                    OnDemandPendingListener(
                        provision_id=(
                            provision_id
                        ),
                        user_id=user_id,
                    )
                )

            await session.commit()

    except SQLAlchemyError:
        _warn_once(
            "pending listener persistence",
        )


async def commit_pending_listeners_to_history(
    provision_id: UUID,
    track_id: UUID,
) -> set[UUID] | None:
    """Atomically move durable pending listeners into history.

    The pending rows and ListeningEvent inserts share one
    transaction. A failed commit leaves the pending rows in
    place so a later status/read can retry instead of silently
    losing recently-played history.
    """

    session_factory = (
        get_session_factory()
    )

    try:
        async with session_factory() as session:
            result = await session.execute(
                select(
                    OnDemandPendingListener.user_id,
                ).where(
                    OnDemandPendingListener.provision_id
                    == provision_id,
                )
            )

            user_ids = set(
                result.scalars().all()
            )

            if not user_ids:
                return set()

            session.add_all(
                [
                    ListeningEvent(
                        user_id=user_id,
                        track_id=track_id,
                    )
                    for user_id
                    in user_ids
                ]
            )

            await session.execute(
                delete(
                    OnDemandPendingListener,
                ).where(
                    OnDemandPendingListener.provision_id
                    == provision_id,
                )
            )

            await session.commit()

            return user_ids

    except SQLAlchemyError:
        _warn_once(
            "pending listener history commit",
        )
        return None


async def pop_pending_listeners(
    provision_id: UUID,
) -> set[UUID]:
    session_factory = (
        get_session_factory()
    )

    try:
        async with session_factory() as session:
            result = await session.execute(
                select(
                    OnDemandPendingListener
                    .user_id,
                ).where(
                    OnDemandPendingListener
                    .provision_id
                    == provision_id,
                )
            )

            user_ids = set(
                result.scalars().all()
            )

            if user_ids:
                await session.execute(
                    delete(
                        OnDemandPendingListener,
                    ).where(
                        OnDemandPendingListener
                        .provision_id
                        == provision_id,
                    )
                )

                await session.commit()

            return user_ids

    except SQLAlchemyError:
        _warn_once(
            "pending listener recovery",
        )
        return set()





async def list_resumable_provision_ids(
    *,
    limit: int = 50,
) -> list[UUID]:
    """Return durable ingests abandoned by a prior process.

    Only provisions that reached the explicit ingesting state
    are eligible. Speculative source-resolution/prewarm rows
    are intentionally excluded so a deploy never turns
    background warming into an unexpected bulk ingest.
    """

    session_factory = (
        get_session_factory()
    )

    try:
        async with session_factory() as session:
            result = await session.execute(
                select(
                    OnDemandProvision.id,
                )
                .where(
                    OnDemandProvision.track_id.is_(
                        None,
                    ),
                    OnDemandProvision.state
                    == "ingesting",
                )
                .order_by(
                    OnDemandProvision.updated_at.asc(),
                    OnDemandProvision.id.asc(),
                )
                .limit(
                    max(
                        1,
                        min(
                            int(limit),
                            200,
                        ),
                    )
                )
            )

            return list(
                result.scalars().all()
            )

    except SQLAlchemyError:
        _warn_once(
            "resumable provision listing",
        )
        return []


async def list_recent_provisions(
    *,
    limit: int = 50,
) -> list[dict[str, Any]]:
    session_factory = (
        get_session_factory()
    )

    try:
        async with session_factory() as session:
            now = _now()

            result = await session.execute(
                select(
                    OnDemandProvision,
                )
                .where(
                    or_(
                        OnDemandProvision.expires_at
                        > now,
                        OnDemandProvision.state.in_(
                            _ACTIVE_LONG_RUNNING_STATES,
                        ),
                    )
                )
                .order_by(
                    OnDemandProvision.updated_at
                    .desc(),
                )
                .limit(
                    max(
                        1,
                        min(
                            int(limit),
                            200,
                        ),
                    )
                )
            )

            return [
                _provision_dict(
                    row,
                )
                for row in result
                .scalars()
                .all()
            ]

    except SQLAlchemyError:
        _warn_once(
            "recent provision listing",
        )
        return []


async def cleanup_expired_state() -> None:
    session_factory = (
        get_session_factory()
    )

    try:
        async with session_factory() as session:
            now = _now()

            await session.execute(
                delete(
                    OnDemandCandidate,
                ).where(
                    OnDemandCandidate.expires_at
                    < now,
                )
            )

            await session.execute(
                delete(
                    OnDemandProvision,
                ).where(
                    OnDemandProvision.expires_at
                    < now,
                    OnDemandProvision.state.not_in(
                        _ACTIVE_LONG_RUNNING_STATES,
                    ),
                )
            )

            await session.commit()

    except SQLAlchemyError:
        _warn_once(
            "expired-state cleanup",
        )
