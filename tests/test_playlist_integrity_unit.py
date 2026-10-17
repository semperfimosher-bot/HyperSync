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
