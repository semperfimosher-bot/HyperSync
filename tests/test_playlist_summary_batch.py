"""Database-free regression tests for batched playlist summary reads."""

from datetime import UTC, datetime
from typing import Any, cast
from uuid import uuid4

import pytest

from backend.app.api.routes.playlists import serialize_playlist_summaries
from backend.app.models.account import User
from backend.app.models.media import Track
from backend.app.models.playlist import Playlist


class Result:
    def __init__(self, *, rows: list[Any] | None = None, values: list[Any] | None = None):
        self._rows = rows or []
        self._values = values or []

    def all(self) -> list[Any]:
        return self._rows

    def scalars(self) -> "Result":
        return self

    def __iter__(self):
        return iter(self._values)


@pytest.mark.asyncio
async def test_empty_playlist_summary_batch_does_not_query_database() -> None:
    class Session:
        calls = 0

        async def execute(self, statement):
            self.calls += 1
            raise AssertionError("empty batches must not query")

    session = Session()
    assert await serialize_playlist_summaries(cast(Any, session), [], None) == []
    assert session.calls == 0


@pytest.mark.asyncio
async def test_playlist_summary_batch_uses_fixed_reads_and_preserves_fields() -> None:
    now = datetime.now(UTC)
    owner_id = uuid4()
    viewer_id = uuid4()
    first_id, second_id = uuid4(), uuid4()
    first = Playlist(
        id=first_id,
        title="First",
        description="First description",
        visibility="private",
        owner_id=owner_id,
        created_at=now,
        updated_at=now,
    )
    second = Playlist(
        id=second_id,
        title="Generated",
        description=None,
        visibility="generated",
        owner_id=None,
        created_at=now,
        updated_at=now,
    )
    artwork_track = Track(
        id=uuid4(),
        title="Cover",
        artist="Artist",
        artwork_object_key="https://cdn.example/cover.jpg",
        is_published=True,
    )

    class Session:
        calls = 0

        async def execute(self, statement):
            self.calls += 1
            if self.calls == 1:
                return Result(rows=[(first_id, 3, 540), (second_id, 0, 0)])
            if self.calls == 2:
                return Result(rows=[(first_id, artwork_track)])
            if self.calls == 3:
                return Result(rows=[(owner_id, "owner-name")])
            if self.calls == 4:
                return Result(values=[first_id])
            raise AssertionError("summary query count grew with playlist count")

    session = Session()
    viewer = User(id=viewer_id, username="viewer")
    summaries = await serialize_playlist_summaries(
        cast(Any, session),
        [first, second],
        viewer,
    )

    assert session.calls == 4
    assert [summary.id for summary in summaries] == [first_id, second_id]
    assert summaries[0].owner_username == "owner-name"
    assert summaries[0].track_count == 3
    assert summaries[0].total_duration_seconds == 540
    assert summaries[0].artwork_urls == ["https://cdn.example/cover.jpg"]
    assert summaries[0].artwork_url == "https://cdn.example/cover.jpg"
    assert summaries[0].is_owner is False
    assert summaries[0].is_saved is True
    assert summaries[1].owner_username == "HyperSynced"
    assert summaries[1].track_count == 0
    assert summaries[1].total_duration_seconds == 0
    assert summaries[1].artwork_urls == []
    assert summaries[1].is_saved is False
