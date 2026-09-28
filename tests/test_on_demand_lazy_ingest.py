from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from sqlalchemy.ext.asyncio import (
    async_sessionmaker,
    create_async_engine,
)

from bot.youtube_source import DownloadedAudio

from backend.app.api.routes import (
    on_demand as on_demand_routes,
)
from backend.app.models.account import (
    AccountType,
)
from backend.app.models.base import Base
from backend.app.models.media import (
    Track,
    TrackIdentity,
)
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
    durable_listener_calls = []

    async def fake_persist_listener(
        provision_id,
        user_id,
    ) -> None:
        durable_listener_calls.append(
            (
                provision_id,
                user_id,
            )
        )

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
        "persist_pending_listener",
        fake_persist_listener,
    )

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

    played_user_id = uuid4()

    played = (
        await on_demand_ingestion
        .record_provision_play(
            UUID(
                prepared[
                    "provision_id"
                ]
            ),
            played_user_id,
        )
    )

    assert played is not None
    assert played["pending"] is True
    assert ingest_calls == 1
    assert durable_listener_calls == [
        (
            UUID(
                prepared[
                    "provision_id"
                ]
            ),
            played_user_id,
        )
    ]


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
async def test_queue_route_prewarms_and_starts_ingest_without_recording_play(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    candidate = _candidate()

    prepare_calls: list[
        tuple[
            str,
            bool,
        ]
    ] = []

    async def fake_rate_limit(
        *_args,
        **_kwargs,
    ) -> None:
        return None

    async def fake_prepare(
        candidate_key: str,
        *,
        start_ingest: bool = False,
    ):
        prepare_calls.append(
            (
                candidate_key,
                start_ingest,
            )
        )

        return {
            "provision_id":
                str(
                    uuid4(),
                ),
            "state":
                "ingesting",
            "stream_url":
                "/api/on-demand/test/stream?token=test-token",
            "track_id":
                None,
        }

    monkeypatch.setattr(
        on_demand_routes,
        "enforce_rate_limit",
        fake_rate_limit,
    )

    monkeypatch.setattr(
        on_demand_routes,
        "prepare_candidate",
        fake_prepare,
    )

    result = await on_demand_routes.queue_on_demand(
        on_demand_routes.PrepareOnDemandRequest(
            candidate_key=
                candidate.key,
        ),
        SimpleNamespace(),
        SimpleNamespace(
            id=
                uuid4(),
            account_type=
                AccountType.REGISTERED,
        ),
    )

    assert prepare_calls == [
        (
            candidate.key,
            True,
        )
    ]

    assert result[
        "state"
    ] == "ingesting"

    assert result[
        "stream_url"
    ]


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
    persisted_states: list[str] = []
    durable_user_id = uuid4()

    async def fake_persist_session(
        durable_session,
    ) -> None:
        persisted_states.append(
            durable_session.state,
        )

    async def fake_pop_pending(
        provision_id: UUID,
    ) -> set[UUID]:
        assert provision_id == session.id
        return {
            durable_user_id,
        }

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

    async def fake_lock(
        provision_id: UUID,
    ):
        assert provision_id == session.id
        return (
            True,
            None,
        )

    async def fake_unlock(
        provision_id: UUID,
        connection,
    ) -> None:
        assert provision_id == session.id
        assert connection is None

    async def no_terminal_durable_result(
        durable_session,
    ) -> bool:
        assert durable_session is session
        return False

    monkeypatch.setattr(
        on_demand_ingestion,
        "_try_acquire_distributed_ingest_lock",
        fake_lock,
    )

    monkeypatch.setattr(
        on_demand_ingestion,
        "_release_distributed_ingest_lock",
        fake_unlock,
    )

    monkeypatch.setattr(
        on_demand_ingestion,
        "_apply_terminal_durable_provision",
        no_terminal_durable_result,
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
        "_persist_session",
        fake_persist_session,
    )

    monkeypatch.setattr(
        on_demand_ingestion,
        "pop_durable_pending_listeners",
        fake_pop_pending,
    )

    monkeypatch.setattr(
        on_demand_ingestion,
        "_record_listening_event",
        fake_record,
    )

    await on_demand_ingestion._run_ingest(
        session,
    )

    assert session.state == "ready", session.error
    assert session.track_id == track_id
    assert session.pending_listener_user_ids == set()

    assert set(
        recorded,
    ) == {
        (
            track_id,
            user_id,
        ),
        (
            track_id,
            durable_user_id,
        ),
    }

    assert "ingesting" in persisted_states
    assert persisted_states[-1] == "ready"

    await (
        on_demand_ingestion
        .reset_transient_state()
    )


@pytest.mark.asyncio
async def test_on_demand_search_uses_indexed_identity_with_legacy_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await (
        on_demand_ingestion
        .reset_transient_state()
    )

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
                    TrackIdentity.__tablename__
                ],
            ],
        )

    factory = async_sessionmaker(
        engine,
        expire_on_commit=False,
    )

    async with factory() as session:
        indexed = Track(
            title="Broadway Girls",
            artist="Morgan Wallen & Lil Durk",
            album="Single",
            b2_object_key="audio/indexed-existing.mp3",
            mime_type="audio/mpeg",
            is_published=True,
        )

        legacy = Track(
            title="Legacy Song",
            artist="Legacy Artist",
            album="Legacy Album",
            b2_object_key="audio/legacy-existing.mp3",
            mime_type="audio/mpeg",
            is_published=True,
        )

        session.add_all(
            [
                indexed,
                legacy,
            ]
        )

        await session.flush()

        session.add(
            TrackIdentity(
                track_id=indexed.id,
                artist_key=(
                    "morgan wallen lil durk"
                ),
                primary_artist_key=(
                    "morgan wallen"
                ),
                title_key=(
                    "broadway girls"
                ),
            )
        )

        await session.commit()

    candidates = [
        CatalogTrackCandidate(
            key="metadata:indexed",
            title="Broadway Girls",
            artist="Morgan Wallen",
            album="Single",
            duration_seconds=180,
            artwork_url=None,
            genre=None,
            release_year=2026,
            explicit=False,
            track_number=1,
            disc_number=1,
            isrc=None,
            deezer_track_id="indexed",
            apple_track_id=None,
            provider="deezer",
            confidence=0.95,
        ),
        CatalogTrackCandidate(
            key="metadata:legacy",
            title="Legacy Song",
            artist="Legacy Artist",
            album="Legacy Album",
            duration_seconds=180,
            artwork_url=None,
            genre=None,
            release_year=2026,
            explicit=False,
            track_number=1,
            disc_number=1,
            isrc=None,
            deezer_track_id="legacy",
            apple_track_id=None,
            provider="deezer",
            confidence=0.95,
        ),
        CatalogTrackCandidate(
            key="metadata:new",
            title="Brand New Song",
            artist="New Artist",
            album="New Album",
            duration_seconds=180,
            artwork_url=None,
            genre=None,
            release_year=2026,
            explicit=False,
            track_number=1,
            disc_number=1,
            isrc=None,
            deezer_track_id="new",
            apple_track_id=None,
            provider="deezer",
            confidence=0.95,
        ),
    ]

    async def fake_search(
        *_args,
        **_kwargs,
    ):
        return candidates

    monkeypatch.setattr(
        on_demand_ingestion,
        "get_session_factory",
        lambda:
            factory,
    )

    monkeypatch.setattr(
        on_demand_ingestion,
        "search_catalog_metadata",
        fake_search,
    )

    missing = (
        await on_demand_ingestion
        .search_and_remember(
            "anything",
            limit=10,
            prewarm=False,
        )
    )

    assert [
        candidate.key
        for candidate
        in missing
    ] == [
        "metadata:new",
    ]

    assert (
        await on_demand_ingestion
        .candidate_for_key(
            "metadata:new",
        )
    ) is not None

    await (
        on_demand_ingestion
        .reset_transient_state()
    )

    await engine.dispose()


@pytest.mark.asyncio
async def test_speculative_prewarm_tasks_are_tracked_and_drained(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await (
        on_demand_ingestion
        .reset_transient_state()
    )

    candidate = _candidate()
    started = False
    cancelled = False

    async def fake_prewarm(
        _candidate,
    ) -> None:
        nonlocal started
        nonlocal cancelled

        started = True

        try:
            await __import__(
                "asyncio",
            ).sleep(
                60,
            )
        except __import__(
            "asyncio",
        ).CancelledError:
            cancelled = True
            raise

    monkeypatch.setattr(
        on_demand_ingestion,
        "prewarm_candidate",
        fake_prewarm,
    )

    monkeypatch.setattr(
        on_demand_ingestion,
        "get_settings",
        lambda:
            SimpleNamespace(
                on_demand_prewarm_limit=1,
            ),
    )

    await on_demand_ingestion.prewarm_candidates(
        [
            candidate,
        ]
    )

    await __import__(
        "asyncio",
    ).sleep(
        0,
    )

    assert started is True
    assert len(
        on_demand_ingestion
        ._background_warm_tasks
    ) == 1

    await (
        on_demand_ingestion
        .reset_transient_state()
    )

    assert cancelled is True
    assert (
        on_demand_ingestion
        ._background_warm_tasks
        == set()
    )


@pytest.mark.asyncio
async def test_replica_follower_reuses_durable_ingest_result(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    candidate = _candidate()
    track_id = uuid4()

    session = (
        on_demand_ingestion
        .ProvisionSession(
            id=uuid4(),
            candidate=candidate,
            state="ingesting",
            created_at=0.0,
            updated_at=0.0,
            stream_token="test-token",
        )
    )

    lock_attempts = 0
    download_calls = 0
    publish_calls = 0

    async def fake_lock(
        provision_id: UUID,
    ):
        nonlocal lock_attempts
        assert provision_id == session.id
        lock_attempts += 1

        return (
            False,
            None,
        )

    async def fake_load(
        provision_id: UUID,
    ):
        assert provision_id == session.id

        return {
            "id":
                provision_id,
            "state":
                "ready",
            "track_id":
                track_id,
            "error":
                None,
        }

    async def unexpected_download(
        _source,
    ):
        nonlocal download_calls
        download_calls += 1
        raise AssertionError(
            "Follower replica must not download audio.",
        )

    async def unexpected_publish(
        **_kwargs,
    ):
        nonlocal publish_calls
        publish_calls += 1
        raise AssertionError(
            "Follower replica must not publish audio.",
        )

    monkeypatch.setattr(
        on_demand_ingestion,
        "_try_acquire_distributed_ingest_lock",
        fake_lock,
    )
    monkeypatch.setattr(
        on_demand_ingestion,
        "load_durable_provision",
        fake_load,
    )
    monkeypatch.setattr(
        on_demand_ingestion,
        "download_youtube_audio",
        unexpected_download,
    )
    monkeypatch.setattr(
        on_demand_ingestion,
        "publish_authorized_audio",
        unexpected_publish,
    )

    await on_demand_ingestion._run_ingest(
        session,
    )

    assert lock_attempts == 1
    assert download_calls == 0
    assert publish_calls == 0
    assert session.state == "ready"
    assert session.track_id == track_id
    assert session.error is None


@pytest.mark.asyncio
async def test_startup_recovery_resumes_only_interrupted_ingests(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    first_id = uuid4()
    second_id = uuid4()

    listed_limits: list[int] = []
    loaded_ids: list[UUID] = []

    async def fake_list_resumable(
        *,
        limit: int = 50,
    ) -> list[UUID]:
        listed_limits.append(
            limit,
        )
        return [
            first_id,
            second_id,
        ]

    async def fake_get_provision(
        provision_id: UUID,
    ):
        loaded_ids.append(
            provision_id,
        )

        if provision_id == first_id:
            return SimpleNamespace(
                track_id=None,
                state="ingesting",
            )

        return SimpleNamespace(
            track_id=uuid4(),
            state="ready",
        )

    monkeypatch.setattr(
        on_demand_ingestion,
        "list_resumable_provision_ids",
        fake_list_resumable,
    )

    monkeypatch.setattr(
        on_demand_ingestion,
        "get_provision_session",
        fake_get_provision,
    )

    resumed = (
        await on_demand_ingestion
        .resume_on_demand_ingests_on_startup(
            limit=25,
        )
    )

    assert listed_limits == [
        25,
    ]

    assert set(
        loaded_ids,
    ) == {
        first_id,
        second_id,
    }

    assert resumed == 1
