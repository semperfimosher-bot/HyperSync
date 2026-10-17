"""Database-free contracts; PostgreSQL races live in test_playlist_integrity.py."""

from typing import Any, cast
from uuid import uuid4

import pytest
from sqlalchemy import UniqueConstraint

from backend.app.models import playlist as models
from backend.app.services import generated_playlists as generated


def test_membership_has_database_unique_constraint():
    assert any(
        isinstance(constraint, UniqueConstraint)
        and {column.name for column in constraint.columns} == {"playlist_id", "track_id"}
        for constraint in models.PlaylistTrack.metadata.tables["playlist_tracks"].constraints
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["artist", "smart"])
async def test_generated_lock_precedes_first_shared_read(monkeypatch, kind):
    events = []

    async def lock(session, key):
        events.append("lock")
        raise RuntimeError("locked before read")

    async def find(*args):
        events.append("read")
        raise RuntimeError("read before lock")

    monkeypatch.setattr(generated, "lock_playlist", lock, raising=False)
    monkeypatch.setattr(generated, "get_cached_artist_playlist", find)
    monkeypatch.setattr(generated, "_find_smart_playlist", find)
    with pytest.raises(RuntimeError, match="locked before read"):
        if kind == "artist":
            await generated.ensure_artist_playlist(cast(Any, object()), "Artist")
        else:
            await generated.ensure_smart_playlist(cast(Any, object()), uuid4(), "country")
    assert events == ["lock"]


@pytest.mark.asyncio
async def test_batch_ranking_streams_once_keeps_only_top_ids():
    from backend.app.models.media import Track

    tracks = [Track(id=uuid4(), title=f"Song {i:04d}", artist="Artist", genre="Country")
              for i in range(400)]

    class Stream:
        closed = False

        async def partitions(self, size):
            for start in range(0, len(tracks), size):
                yield [(track, i) for i, track in enumerate(tracks[start:start + size], start)]

        async def close(self):
            self.closed = True

    class Result:
        def scalars(self):
            return self

        def all(self):
            return tracks

    class Session:
        scans = 0

        async def stream(self, statement):
            self.scans += 1
            return stream

        async def execute(self, statement):
            return Result()

    stream = Stream()
    session = Session()
    batch = await generated._prepare_smart_rankings(
        cast(Any, session), ["country", " COUNTRY ", "chill"],
    )
    assert batch.snapshot_at.tzinfo is not None
    assert not hasattr(batch, "catalog")
    assert len(batch.rankings["country"]) == generated.MAX_SMART_GENERATED_TRACKS
    assert all(isinstance(track_id, type(uuid4())) for track_id in batch.rankings["country"])
    first = await generated._rank_smart_tracks(cast(Any, session), "country", batch=batch)
    second = await generated._rank_smart_tracks(cast(Any, session), " COUNTRY ", batch=batch)
    third = await generated._rank_smart_tracks(cast(Any, session), "chill", batch=batch)
    assert first == second == tracks[-120:][::-1]
    assert third == []
    assert session.scans == 1
    assert stream.closed


@pytest.mark.asyncio
async def test_smart_refresh_pages_targets_and_caps_ranking_batches(monkeypatch):
    from types import SimpleNamespace
    from uuid import UUID

    rows = [(UUID(int=i + 1), uuid4(), f"country {i}") for i in range(137)]
    processed = []
    batches = []

    class Session:
        async def execute(self, statement):
            # Enforce bounded queries before simulating each keyset page.
            assert statement._limit_clause is not None, "target query must have a page limit"
            limit = statement._limit_clause.value
            compiled = statement.compile().params
            cursor = compiled.get("id_1", UUID(int=0))
            page = [row for row in rows if row[0] > cursor][:limit]
            return SimpleNamespace(all=lambda: page)

    async def prepare(session, queries):
        batches.append(queries)
        assert len(set(queries)) <= 64
        return generated.SmartRankingBatch()

    async def ensure(session, owner_id, query, **kwargs):
        processed.append((owner_id, query))
        return object()

    monkeypatch.setattr(generated, "_prepare_smart_rankings", prepare)
    monkeypatch.setattr(generated, "ensure_smart_playlist", ensure)
    monkeypatch.setattr(generated, "smart_track_score", lambda track, query: 1)
    assert await generated.refresh_smart_playlists_for_track(
        cast(Any, Session()), cast(Any, object())
    ) == 137
    assert processed == [(owner, query) for _, owner, query in rows]
    assert [len(batch) for batch in batches] == [64, 64, 9]


@pytest.mark.asyncio
async def test_artist_ranking_streams_closes_and_preserves_popularity_order():
    from types import SimpleNamespace

    from backend.app.models.media import Track

    tracks = [Track(id=uuid4(), title=f"Song {i:04d}", artist="Artist feat. Guest")
              for i in range(700)]
    # An unrelated legacy row must never be included, even with a larger count.
    unrelated = Track(id=uuid4(), title="Wrong", artist="Other")

    class Stream:
        closed = False

        async def partitions(self, size):
            for start in range(0, len(tracks), size):
                yield [(track, i) for i, track in enumerate(tracks[start:start + size], start)]
            yield [(unrelated, 99999)]

        async def close(self):
            self.closed = True

    stream = Stream()

    class Session:
        async def stream(self, statement):
            # Compile the real joined aggregate and correlated credit predicates.
            assert "listening_events" in str(statement.compile())
            return stream

        async def execute(self, statement):
            assert stream.closed, "only bounded winner lookup may materialize rows"
            ids = next(value for value in statement.compile().params.values()
                       if isinstance(value, list))
            assert len(ids) == generated.MAX_GENERATED_TRACKS
            winners = [t for t in tracks if t.id in ids]
            return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: winners))

    result = await generated._rank_artist_tracks(cast(Any, Session()), "Artist")
    assert result == tracks[-generated.MAX_GENERATED_TRACKS:][::-1]
    assert stream.closed


@pytest.mark.asyncio
async def test_artist_freshness_streams_count_and_latest_update():
    from datetime import UTC, datetime
    from types import SimpleNamespace

    now = datetime.now(UTC)
    playlist = SimpleNamespace(
        id=uuid4(), visibility="generated", generated_query="Artist",
        generated_kind="artist", owner_id=None, generator_version=generated.GENERATOR_VERSION,
        generated_at=now, title="Artist",
    )

    class Stream:
        closed = False

        async def partitions(self, size):
            yield [("Artist feat. Guest", now), ("Other", now)]

        async def close(self):
            self.closed = True

    stream = Stream()

    class Session:
        async def stream(self, statement):
            return stream

        async def execute(self, statement):
            assert stream.closed, "freshness must stream before reading bounded membership count"
            return SimpleNamespace(scalar_one=lambda: 1)

    assert not await generated.generated_playlist_needs_refresh(
        cast(Any, Session()), cast(Any, playlist)
    )
    assert stream.closed


@pytest.mark.asyncio
async def test_stale_only_refresh_can_resume_after_committed_progress(monkeypatch):
    from datetime import UTC, datetime
    from types import SimpleNamespace
    from uuid import UUID

    from sqlalchemy.dialects import postgresql

    remaining = [(UUID(int=i + 1), uuid4(), "country") for i in range(3)]
    refreshed = []
    interrupt = True
    track = SimpleNamespace(updated_at=datetime.now(UTC))

    class Session:
        async def execute(self, statement):
            sql = str(statement.compile(dialect=postgresql.dialect()))
            assert "playlists.generated_at <" in sql
            assert "playlists.generator_version IS DISTINCT FROM" in sql
            cursor = statement.compile().params.get("id_1", UUID(int=0))
            return SimpleNamespace(all=lambda: [row for row in remaining if row[0] > cursor][:1])

    async def ensure(session, owner_id, query, **kwargs):
        nonlocal interrupt
        refreshed.append(owner_id)
        remaining[:] = [row for row in remaining if row[1] != owner_id]
        if interrupt:
            interrupt = False
            raise TimeoutError("deadline after committed playlist")
        return object()

    async def prepare(*args):
        return generated.SmartRankingBatch()

    monkeypatch.setattr(generated, "SMART_REFRESH_TARGET_BATCH_SIZE", 1)
    monkeypatch.setattr(generated, "ensure_smart_playlist", ensure)
    monkeypatch.setattr(generated, "_prepare_smart_rankings", prepare)
    monkeypatch.setattr(generated, "smart_track_score", lambda *args: 1)
    with pytest.raises(TimeoutError):
        await generated.refresh_smart_playlists_for_track(
            cast(Any, Session()), cast(Any, track), only_stale=True,
        )
    assert await generated.refresh_smart_playlists_for_track(
        cast(Any, Session()), cast(Any, track), only_stale=True,
    ) == 2
    assert len(refreshed) == len(set(refreshed)) == 3


@pytest.mark.asyncio
@pytest.mark.parametrize("only_stale,has_timestamp", [(False, True), (True, False)])
async def test_smart_refresh_keeps_force_behavior_without_stale_cutoff(
    monkeypatch, only_stale, has_timestamp,
):
    from datetime import UTC, datetime
    from types import SimpleNamespace

    track = SimpleNamespace(updated_at=datetime.now(UTC) if has_timestamp else None)

    class Session:
        async def execute(self, statement):
            assert "playlists.generated_at <" not in str(statement.compile())
            return SimpleNamespace(all=lambda: [(uuid4(), uuid4(), "country")])

    async def prepare(*args):
        return generated.SmartRankingBatch()

    async def ensure(*args, **kwargs):
        assert kwargs["force_refresh"]
        return object()

    monkeypatch.setattr(generated, "_prepare_smart_rankings", prepare)
    monkeypatch.setattr(generated, "ensure_smart_playlist", ensure)
    monkeypatch.setattr(generated, "smart_track_score", lambda *args: 1)
    assert await generated.refresh_smart_playlists_for_track(
        cast(Any, Session()), cast(Any, track), only_stale=only_stale,
    ) == 1
