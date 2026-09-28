from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy import (
    select,
)
from sqlalchemy.ext.asyncio import (
    async_sessionmaker,
    create_async_engine,
)

import bot.service
import bot.worker

from backend.app.api.routes.bot import (
    AdminBotScanRequest,
)

from backend.app.models.bot import (
    BotCatalogScan,
    BotCatalogScanItem,
)
from backend.app.models.base import Base
from backend.app.models.media import Track
from backend.app.services import (
    bot_catalog_jobs as bot_jobs,
)
from backend.app.services.on_demand_metadata import (
    CatalogTrackCandidate,
)


def _candidate(
    *,
    artist: str,
    title: str,
    suffix: str,
) -> CatalogTrackCandidate:
    return CatalogTrackCandidate(
        key=(
            "music:test-"
            + suffix
        ),
        title=title,
        artist=artist,
        album="Test Album",
        duration_seconds=180,
        artwork_url=None,
        genre="Pop",
        release_year=2026,
        explicit=False,
        track_number=1,
        disc_number=1,
        isrc=None,
        deezer_track_id=(
            "dz-"
            + suffix
        ),
        apple_track_id=None,
        provider="deezer",
        confidence=0.99,
    )


async def _catalog_factory(
    rows: list[
        tuple[str, str]
    ],
):
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
    )

    async with engine.begin() as connection:
        await connection.run_sync(
            Base.metadata.create_all,
            tables=[
                Base.metadata.tables[
                    Track.__tablename__
                ],
                Base.metadata.tables[
                    BotCatalogScan.__tablename__
                ],
                Base.metadata.tables[
                    BotCatalogScanItem.__tablename__
                ],
            ],
        )

    factory = async_sessionmaker(
        engine,
        expire_on_commit=False,
    )

    async with factory() as session:
        for index, (
            artist,
            title,
        ) in enumerate(
            rows,
        ):
            session.add(
                Track(
                    id=uuid4(),
                    title=title,
                    artist=artist,
                    album="Seed Album",
                    b2_object_key=(
                        "audio/test-"
                        + str(
                            index,
                        )
                        + ".mp3"
                    ),
                    mime_type="audio/mpeg",
                    is_published=True,
                )
            )

        await session.commit()

    return (
        engine,
        factory,
    )


@pytest.mark.asyncio
async def test_catalog_gap_scan_discovers_only_missing_tracks(
    monkeypatch,
) -> None:
    engine, factory = (
        await _catalog_factory(
            [
                (
                    "Artist A",
                    "Existing A",
                ),
                (
                    "Artist B",
                    "Existing B",
                ),
            ]
        )
    )

    remembered: list[str] = []

    async def fake_search(
        query: str,
        *,
        kind: str,
        limit: int,
    ):
        assert kind == "artist"
        assert limit == 500

        if query == "Artist A":
            return [
                _candidate(
                    artist="Artist A",
                    title="Existing A",
                    suffix="existing-a",
                ),
                _candidate(
                    artist="Artist A",
                    title="Missing A",
                    suffix="missing-a",
                ),
            ]

        if query == "Artist B":
            return [
                _candidate(
                    artist="Artist B",
                    title="Missing B",
                    suffix="missing-b",
                ),
            ]

        return []

    async def fake_remember(
        candidates,
    ):
        remembered.extend(
            candidate.key
            for candidate
            in candidates
        )

    async def unexpected_ingest(
        candidate_key: str,
    ):
        raise AssertionError(
            "Discovery-only scan must not ingest "
            + candidate_key
        )

    monkeypatch.setattr(
        bot.worker,
        "get_session_factory",
        lambda:
            factory,
    )
    monkeypatch.setattr(
        bot_jobs,
        "get_session_factory",
        lambda:
            factory,
    )
    monkeypatch.setattr(
        bot.worker,
        "search_catalog_metadata",
        fake_search,
    )
    monkeypatch.setattr(
        bot.worker,
        "remember_candidates",
        fake_remember,
    )
    monkeypatch.setattr(
        bot.worker,
        "ingest_candidate_and_wait",
        unexpected_ingest,
    )

    await bot.worker.run_scan(
        auto_ingest=False,
        track_limit_per_artist=500,
        ingest_concurrency=2,
    )

    scan = (
        bot.service.get_state()
        .catalog_scan
    )

    assert scan["state"] == "complete"
    assert scan["artist_total"] == 2
    assert scan["artists_scanned"] == 2
    assert scan["missing_discovered"] == 2
    assert scan["ingest_started"] == 0
    assert set(
        remembered,
    ) == {
        "music:test-missing-a",
        "music:test-missing-b",
    }

    await engine.dispose()


@pytest.mark.asyncio
async def test_catalog_gap_scan_auto_ingests_through_existing_pipeline(
    monkeypatch,
) -> None:
    engine, factory = (
        await _catalog_factory(
            [
                (
                    "Artist A",
                    "Existing A",
                ),
            ]
        )
    )

    candidate = _candidate(
        artist="Artist A",
        title="Missing A",
        suffix="missing-a",
    )

    async def fake_search(
        query: str,
        *,
        kind: str,
        limit: int,
    ):
        del kind
        del limit
        assert query == "Artist A"
        return [
            candidate,
        ]

    async def fake_remember(
        candidates,
    ):
        assert [
            item.key
            for item
            in candidates
        ] == [
            candidate.key,
        ]

    async def fake_ingest(
        candidate_key: str,
    ):
        assert (
            candidate_key
            == candidate.key
        )

        return {
            "state":
                "ready",
            "track_id":
                str(
                    uuid4(),
                ),
            "error":
                None,
        }

    monkeypatch.setattr(
        bot.worker,
        "get_session_factory",
        lambda:
            factory,
    )
    monkeypatch.setattr(
        bot_jobs,
        "get_session_factory",
        lambda:
            factory,
    )
    monkeypatch.setattr(
        bot.worker,
        "search_catalog_metadata",
        fake_search,
    )
    monkeypatch.setattr(
        bot.worker,
        "remember_candidates",
        fake_remember,
    )
    monkeypatch.setattr(
        bot.worker,
        "ingest_candidate_and_wait",
        fake_ingest,
    )

    await bot.worker.run_scan(
        auto_ingest=True,
        track_limit_per_artist=500,
        ingest_concurrency=2,
    )

    scan = (
        bot.service.get_state()
        .catalog_scan
    )

    assert scan["state"] == "complete"
    assert scan["missing_discovered"] == 1
    assert scan["ingest_started"] == 1
    assert scan["ingest_ready"] == 1
    assert scan["ingest_failed"] == 0

    await engine.dispose()


@pytest.mark.asyncio
async def test_catalog_gap_scan_uses_primary_artist_for_collaborations(
    monkeypatch,
) -> None:
    engine, factory = (
        await _catalog_factory(
            [
                (
                    "Morgan Wallen & Lil Durk",
                    "Broadway Girls",
                ),
            ]
        )
    )

    queries: list[str] = []
    remembered: list[str] = []

    async def fake_search(
        query: str,
        *,
        kind: str,
        limit: int,
    ):
        queries.append(
            query,
        )

        assert kind == "artist"
        assert limit == 500

        return [
            _candidate(
                artist="Morgan Wallen",
                title="Broadway Girls",
                suffix="existing-collab",
            ),
            _candidate(
                artist="Morgan Wallen",
                title="Actually Missing",
                suffix="missing-primary",
            ),
        ]

    async def fake_remember(
        candidates,
    ):
        remembered.extend(
            candidate.key
            for candidate
            in candidates
        )

    monkeypatch.setattr(
        bot.worker,
        "get_session_factory",
        lambda:
            factory,
    )
    monkeypatch.setattr(
        bot_jobs,
        "get_session_factory",
        lambda:
            factory,
    )
    monkeypatch.setattr(
        bot.worker,
        "search_catalog_metadata",
        fake_search,
    )
    monkeypatch.setattr(
        bot.worker,
        "remember_candidates",
        fake_remember,
    )

    await bot.worker.run_scan(
        auto_ingest=False,
        track_limit_per_artist=500,
        ingest_concurrency=2,
    )

    scan = (
        bot.service.get_state()
        .catalog_scan
    )

    assert queries == [
        "Morgan Wallen",
    ]
    assert scan["artist_total"] == 1
    assert scan["missing_discovered"] == 1
    assert remembered == [
        "music:test-missing-primary",
    ]

    await engine.dispose()


def test_bot_runtime_is_always_online() -> None:
    stopped = bot.service.stop_bot()

    assert stopped.running is True
    assert stopped.status == "online"

    started = bot.service.start_bot()

    assert started.running is True
    assert started.status == "online"


def test_bulk_scan_no_longer_requires_confirmation_field() -> None:
    request = AdminBotScanRequest(
        auto_ingest=True,
    )

    assert request.auto_ingest is True
    assert not hasattr(
        request,
        "confirm_authorized_media",
    )


@pytest.mark.asyncio
async def test_catalog_scan_persists_pending_items_for_restart_resume(
    monkeypatch,
) -> None:
    engine, factory = (
        await _catalog_factory(
            [
                (
                    "Restart Artist",
                    "Existing Song",
                ),
            ]
        )
    )

    candidate = _candidate(
        artist="Restart Artist",
        title="Resume Me",
        suffix="resume-me",
    )

    async def fake_search(
        query: str,
        *,
        kind: str,
        limit: int,
    ):
        assert query == "Restart Artist"
        assert kind == "artist"
        assert limit == 500

        return [
            candidate,
        ]

    async def fake_remember(
        candidates,
    ):
        del candidates

    monkeypatch.setattr(
        bot.worker,
        "get_session_factory",
        lambda:
            factory,
    )
    monkeypatch.setattr(
        bot_jobs,
        "get_session_factory",
        lambda:
            factory,
    )
    monkeypatch.setattr(
        bot.worker,
        "search_catalog_metadata",
        fake_search,
    )
    monkeypatch.setattr(
        bot.worker,
        "remember_candidates",
        fake_remember,
    )

    scan = await bot_jobs.create_catalog_scan(
        auto_ingest=True,
        track_limit_per_artist=500,
        ingest_concurrency=2,
    )

    (
        artists,
        existing_identities,
    ) = await bot.worker._catalog_inventory()

    await bot_jobs.set_scan_discovery_start(
        scan.id,
        artist_total=len(
            artists,
        ),
    )

    await bot.worker._discover_missing(
        scan.id,
        artists,
        existing_identities,
        track_limit_per_artist=500,
    )

    pending = await bot_jobs.pending_scan_items(
        scan.id,
    )

    assert len(pending) == 1
    assert pending[0][1].key == candidate.key

    await bot_jobs.mark_item_started(
        scan.id,
        pending[0][0],
    )

    await bot_jobs.prepare_scan_for_resume(
        scan.id,
    )

    resumed = await bot_jobs.pending_scan_items(
        scan.id,
    )

    assert len(resumed) == 1
    assert resumed[0][1].key == candidate.key

    snapshot = await bot_jobs.scan_snapshot(
        scan.id,
    )

    assert snapshot is not None
    assert snapshot["missing_discovered"] == 1
    assert snapshot["state"] == "discovering"

    await engine.dispose()


@pytest.mark.asyncio
async def test_catalog_scan_item_claim_is_idempotent(
    monkeypatch,
) -> None:
    engine, factory = (
        await _catalog_factory(
            [
                (
                    "Claim Artist",
                    "Existing Song",
                ),
            ]
        )
    )

    monkeypatch.setattr(
        bot_jobs,
        "get_session_factory",
        lambda:
            factory,
    )

    scan = await bot_jobs.create_catalog_scan(
        auto_ingest=True,
        track_limit_per_artist=500,
        ingest_concurrency=2,
    )

    candidate = _candidate(
        artist="Claim Artist",
        title="Claim Me",
        suffix="claim-me",
    )

    added = await bot_jobs.persist_discovered_candidates(
        scan.id,
        [
            candidate,
        ],
    )

    assert added == 1

    pending = await bot_jobs.pending_scan_items(
        scan.id,
    )

    assert len(pending) == 1

    item_id = pending[0][0]

    first_claim = await bot_jobs.mark_item_started(
        scan.id,
        item_id,
    )

    second_claim = await bot_jobs.mark_item_started(
        scan.id,
        item_id,
    )

    assert first_claim is True
    assert second_claim is False

    async with factory() as session:
        item = await session.get(
            BotCatalogScanItem,
            item_id,
        )
        persisted_scan = await session.get(
            BotCatalogScan,
            scan.id,
        )

        assert item is not None
        assert item.state == "ingesting"
        assert item.attempts == 1
        assert persisted_scan is not None
        assert persisted_scan.ingest_started == 1

    await engine.dispose()


@pytest.mark.asyncio
async def test_catalog_scan_retries_transient_ingest_failure(
    monkeypatch,
) -> None:
    engine, factory = (
        await _catalog_factory(
            [
                (
                    "Retry Artist",
                    "Existing Song",
                ),
            ]
        )
    )

    candidate = _candidate(
        artist="Retry Artist",
        title="Eventually Works",
        suffix="eventually-works",
    )

    attempts = 0
    track_id = uuid4()

    async def fake_search(
        query: str,
        *,
        kind: str,
        limit: int,
    ):
        assert query == "Retry Artist"
        assert kind == "artist"
        assert limit == 500
        return [
            candidate,
        ]

    async def fake_remember(
        candidates,
    ):
        assert [
            item.key
            for item
            in candidates
        ] == [
            candidate.key,
        ]

    async def flaky_ingest(
        candidate_key: str,
    ):
        nonlocal attempts

        assert candidate_key == candidate.key
        attempts += 1

        if attempts < 3:
            raise RuntimeError(
                "temporary source outage"
            )

        return {
            "state":
                "ready",
            "track_id":
                str(
                    track_id,
                ),
            "error":
                None,
        }

    monkeypatch.setattr(
        bot.worker,
        "get_session_factory",
        lambda:
            factory,
    )
    monkeypatch.setattr(
        bot_jobs,
        "get_session_factory",
        lambda:
            factory,
    )
    monkeypatch.setattr(
        bot.worker,
        "search_catalog_metadata",
        fake_search,
    )
    monkeypatch.setattr(
        bot.worker,
        "remember_candidates",
        fake_remember,
    )
    monkeypatch.setattr(
        bot.worker,
        "ingest_candidate_and_wait",
        flaky_ingest,
    )
    monkeypatch.setattr(
        bot.worker,
        "_retry_delay_seconds",
        lambda _attempt:
            0,
    )

    await bot.worker.run_scan(
        auto_ingest=True,
        track_limit_per_artist=500,
        ingest_concurrency=1,
    )

    assert attempts == 3

    snapshot = await bot_jobs.scan_snapshot()

    assert snapshot is not None
    assert snapshot["state"] == "complete"
    assert snapshot["ingest_started"] == 3
    assert snapshot["ingest_ready"] == 1
    assert snapshot["ingest_failed"] == 0

    async with factory() as session:
        result = await session.execute(
            select(
                BotCatalogScanItem,
            )
        )

        item = result.scalar_one()

        assert item.state == "ready"
        assert item.attempts == 3
        assert item.track_id == track_id

    await engine.dispose()


@pytest.mark.asyncio
async def test_catalog_scan_stops_after_bounded_ingest_retries(
    monkeypatch,
) -> None:
    engine, factory = (
        await _catalog_factory(
            [
                (
                    "Fail Artist",
                    "Existing Song",
                ),
            ]
        )
    )

    candidate = _candidate(
        artist="Fail Artist",
        title="Never Works",
        suffix="never-works",
    )

    attempts = 0

    async def fake_search(
        query: str,
        *,
        kind: str,
        limit: int,
    ):
        assert query == "Fail Artist"
        assert kind == "artist"
        assert limit == 500
        return [
            candidate,
        ]

    async def fake_remember(
        candidates,
    ):
        assert [
            item.key
            for item
            in candidates
        ] == [
            candidate.key,
        ]

    async def failing_ingest(
        candidate_key: str,
    ):
        nonlocal attempts

        assert candidate_key == candidate.key
        attempts += 1

        raise RuntimeError(
            "permanent source failure"
        )

    monkeypatch.setattr(
        bot.worker,
        "get_session_factory",
        lambda:
            factory,
    )
    monkeypatch.setattr(
        bot_jobs,
        "get_session_factory",
        lambda:
            factory,
    )
    monkeypatch.setattr(
        bot.worker,
        "search_catalog_metadata",
        fake_search,
    )
    monkeypatch.setattr(
        bot.worker,
        "remember_candidates",
        fake_remember,
    )
    monkeypatch.setattr(
        bot.worker,
        "ingest_candidate_and_wait",
        failing_ingest,
    )
    monkeypatch.setattr(
        bot.worker,
        "_retry_delay_seconds",
        lambda _attempt:
            0,
    )

    await bot.worker.run_scan(
        auto_ingest=True,
        track_limit_per_artist=500,
        ingest_concurrency=1,
    )

    assert attempts == 3

    snapshot = await bot_jobs.scan_snapshot()

    assert snapshot is not None
    assert snapshot["state"] == "complete"
    assert snapshot["ingest_started"] == 3
    assert snapshot["ingest_ready"] == 0
    assert snapshot["ingest_failed"] == 1

    async with factory() as session:
        result = await session.execute(
            select(
                BotCatalogScanItem,
            )
        )

        item = result.scalar_one()

        assert item.state == "failed"
        assert item.attempts == 3
        assert "permanent source failure" in (
            item.error
            or ""
        )

    await engine.dispose()
