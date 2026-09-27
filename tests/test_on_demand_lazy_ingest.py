from uuid import UUID, uuid4

import pytest

from backend.app.services import (
    on_demand_ingestion,
)
from backend.app.services.on_demand_metadata import (
    CatalogTrackCandidate,
)


def _candidate() -> CatalogTrackCandidate:
    return CatalogTrackCandidate(
        key="metadata:test-track",
        title="Test Track",
        artist="Test Artist",
        album="Test Album",
        duration_seconds=180,
        artwork_url=None,
        genre=None,
        release_year=2026,
        explicit=False,
        track_number=1,
        disc_number=1,
        isrc=None,
        deezer_track_id="123",
        apple_track_id=None,
        provider="deezer",
        confidence=0.95,
    )


@pytest.mark.asyncio
async def test_prepare_is_source_only_until_played(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await (
        on_demand_ingestion
        .reset_transient_state()
    )

    candidate = _candidate()

    await on_demand_ingestion.remember_candidates(
        [
            candidate,
        ]
    )

    ingest_calls = 0

    async def fake_ensure_source(
        session,
    ) -> None:
        session.state = "stream-ready"

    async def fake_ensure_ingest(
        session,
    ) -> None:
        nonlocal ingest_calls
        ingest_calls += 1
        session.ingest_started = True
        session.state = "ingesting"

    monkeypatch.setattr(
        on_demand_ingestion,
        "_ensure_source",
        fake_ensure_source,
    )

    monkeypatch.setattr(
        on_demand_ingestion,
        "_ensure_ingest",
        fake_ensure_ingest,
    )

    prepared = (
        await on_demand_ingestion
        .prepare_candidate(
            candidate.key,
        )
    )

    assert ingest_calls == 0

    played = (
        await on_demand_ingestion
        .record_provision_play(
            UUID(
                prepared[
                    "provision_id"
                ]
            ),
            uuid4(),
        )
    )

    assert played is not None
    assert played["pending"] is True
    assert ingest_calls == 1


@pytest.mark.asyncio
async def test_admin_prepare_can_still_start_ingest(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await (
        on_demand_ingestion
        .reset_transient_state()
    )

    candidate = _candidate()

    await on_demand_ingestion.remember_candidates(
        [
            candidate,
        ]
    )

    ingest_calls = 0

    async def fake_ensure_source(
        session,
    ) -> None:
        session.state = "stream-ready"

    async def fake_ensure_ingest(
        session,
    ) -> None:
        nonlocal ingest_calls
        ingest_calls += 1
        session.ingest_started = True

    monkeypatch.setattr(
        on_demand_ingestion,
        "_ensure_source",
        fake_ensure_source,
    )

    monkeypatch.setattr(
        on_demand_ingestion,
        "_ensure_ingest",
        fake_ensure_ingest,
    )

    await on_demand_ingestion.prepare_candidate(
        candidate.key,
        start_ingest=True,
    )

    assert ingest_calls == 1


@pytest.mark.asyncio
async def test_playlist_warm_registers_500_without_ingest(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await (
        on_demand_ingestion
        .reset_transient_state()
    )

    candidates = [
        CatalogTrackCandidate(
            key=f"metadata:warm-{index}",
            title=f"Warm Track {index}",
            artist="Warm Artist",
            album="Warm Album",
            duration_seconds=180,
            artwork_url=None,
            genre=None,
            release_year=2026,
            explicit=False,
            track_number=index + 1,
            disc_number=1,
            isrc=None,
            deezer_track_id=str(
                10_000 + index,
            ),
            apple_track_id=None,
            provider="deezer",
            confidence=0.95,
        )
        for index in range(500)
    ]

    await on_demand_ingestion.remember_candidates(
        candidates,
    )

    ingest_calls = 0

    async def fake_ensure_source(
        session,
    ) -> None:
        session.state = "stream-ready"

    async def fake_ensure_ingest(
        session,
    ) -> None:
        nonlocal ingest_calls
        ingest_calls += 1

    monkeypatch.setattr(
        on_demand_ingestion,
        "_ensure_source",
        fake_ensure_source,
    )

    monkeypatch.setattr(
        on_demand_ingestion,
        "_ensure_ingest",
        fake_ensure_ingest,
    )

    warmed = (
        await on_demand_ingestion
        .warm_candidate_keys(
            [
                candidate.key
                for candidate
                in candidates
            ]
        )
    )

    assert len(warmed) == 500

    assert all(
        item["track_id"] is None
        for item in warmed
    )

    assert ingest_calls == 0

    await (
        on_demand_ingestion
        .reset_transient_state()
    )
