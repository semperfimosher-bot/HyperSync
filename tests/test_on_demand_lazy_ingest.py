from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest

from bot.youtube_source import DownloadedAudio

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


@pytest.mark.asyncio
async def test_played_on_demand_track_enters_recent_history_after_ingest(
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

    session = (
        await on_demand_ingestion
        .get_or_create_session(
            candidate,
        )
    )

    session.source = SimpleNamespace(
        source_id="youtube-test-source",
    )

    user_id = uuid4()
    track_id = uuid4()

    session.pending_listener_user_ids.add(
        user_id,
    )

    recorded: list[
        tuple[UUID, UUID]
    ] = []

    async def fake_download(
        _source,
    ) -> DownloadedAudio:
        return DownloadedAudio(
            content=b"audio",
            filename="test.mp3",
            mime_type="audio/mpeg",
        )

    async def fake_artwork(
        _url,
    ) -> tuple[
        bytes | None,
        str | None,
    ]:
        return (
            None,
            None,
        )

    async def fake_publish(
        **_kwargs,
    ):
        return SimpleNamespace(
            track_id=track_id,
            artist=candidate.artist,
            title=candidate.title,
        )

    async def fake_record(
        recorded_track_id: UUID,
        recorded_user_id: UUID,
    ) -> None:
        recorded.append(
            (
                recorded_track_id,
                recorded_user_id,
            )
        )

    monkeypatch.setattr(
        on_demand_ingestion,
        "download_youtube_audio",
        fake_download,
    )

    monkeypatch.setattr(
        on_demand_ingestion,
        "_fetch_artwork",
        fake_artwork,
    )

    monkeypatch.setattr(
        on_demand_ingestion,
        "publish_authorized_audio",
        fake_publish,
    )

    monkeypatch.setattr(
        on_demand_ingestion,
        "_record_listening_event",
        fake_record,
    )

    await on_demand_ingestion._run_ingest(
        session,
    )

    assert session.state == "ready"
    assert session.track_id == track_id
    assert session.pending_listener_user_ids == set()

    assert recorded == [
        (
            track_id,
            user_id,
        )
    ]

    await (
        on_demand_ingestion
        .reset_transient_state()
    )
