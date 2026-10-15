from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker

from backend.app.models.base import Base
from backend.app.models.on_demand import OnDemandCandidate
from backend.app.services import on_demand_state
from backend.app.services.on_demand_metadata import CatalogTrackCandidate
from scripts.verification.postgres_database import create_postgres_test_engine


def candidate(*, title: str) -> CatalogTrackCandidate:
    return CatalogTrackCandidate(
        key="music:shared-candidate",
        title=title,
        artist="Test Artist",
        album=None,
        duration_seconds=180,
        artwork_url=None,
        genre=None,
        release_year=None,
        explicit=None,
        track_number=None,
        disc_number=None,
        isrc=None,
        deezer_track_id=None,
        apple_track_id=None,
        provider="test",
        confidence=1.0,
    )


@pytest.mark.asyncio
async def test_candidate_persistence_is_idempotent_and_deduplicates_batches(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    engine = create_postgres_test_engine()
    try:
        async with engine.begin() as connection:
            await connection.run_sync(
                Base.metadata.create_all,
                tables=[
                    Base.metadata.tables[OnDemandCandidate.__tablename__],
                ],
            )

        factory = async_sessionmaker(engine, expire_on_commit=False)
        monkeypatch.setattr(
            on_demand_state,
            "get_session_factory",
            lambda: factory,
        )

        assert await on_demand_state.persist_candidates(
            [candidate(title="Older"), candidate(title="Newest")]
        )
        assert await on_demand_state.persist_candidates(
            [candidate(title="Updated")]
        )

        saved = await on_demand_state.load_candidate("music:shared-candidate")
        assert saved is not None
        assert saved.title == "Updated"
    finally:
        await engine.dispose()
