"""Regression tests for bounded playlist detail reads."""

from uuid import uuid4

import pytest
from sqlalchemy.sql import Select

from backend.app.api.routes.playlists import load_playlist_tracks


class FakeResult:
    def all(self):
        return []


class FakeSession:
    def __init__(self):
        self.statement = None

    async def execute(self, statement):
        self.statement = statement
        return FakeResult()


@pytest.mark.asyncio
async def test_playlist_track_page_applies_limit_offset_and_stable_order() -> None:
    session = FakeSession()

    result = await load_playlist_tracks(
        session,
        uuid4(),
        limit=250,
        offset=500,
    )

    assert result == []
    assert isinstance(session.statement, Select)
    assert session.statement._limit_clause.value == 250
    assert session.statement._offset_clause.value == 500
    order_columns = [column.name for column in session.statement._order_by_clauses]
    assert order_columns == ["position", "created_at", "id"]


@pytest.mark.asyncio
async def test_legacy_playlist_track_read_remains_unbounded_without_limit() -> None:
    session = FakeSession()

    await load_playlist_tracks(session, uuid4())

    assert session.statement._limit_clause is None
    assert session.statement._offset_clause is None
