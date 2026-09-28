from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import (
    async_sessionmaker,
    create_async_engine,
)

import bot.service
import bot.worker

from backend.app.api.routes.bot import (
    AdminBotScanRequest,
)

from backend.app.models.base import Base
from backend.app.models.media import Track
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
