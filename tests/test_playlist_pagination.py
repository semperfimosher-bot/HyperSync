"""Regression tests for bounded playlist detail reads."""

from typing import Any, cast
from uuid import uuid4

import pytest
from sqlalchemy.sql import Select

from backend.app.api.dependencies import DatabaseSession
from backend.app.api.routes.playlists import load_playlist_tracks


class FakeResult:
    def all(self) -> list[tuple[object, object]]:
        return []


class FakeSession:
    def __init__(self) -> None:
        self.statement: Any = None

    async def execute(self, statement: Any) -> FakeResult:
        self.statement = statement
        return FakeResult()


@pytest.mark.asyncio
async def test_playlist_track_page_applies_limit_offset_and_stable_order() -> None:
    fake_session = FakeSession()

    result = await load_playlist_tracks(
        cast(DatabaseSession, fake_session),
        uuid4(),
        limit=250,
        offset=500,
    )

    assert result == []
    statement = fake_session.statement
    assert isinstance(statement, Select)
    limit_clause = getattr(statement, "_limit_clause")
    offset_clause = getattr(statement, "_offset_clause")
    assert limit_clause is not None
    assert offset_clause is not None
    assert getattr(limit_clause, "value") == 250
    assert getattr(offset_clause, "value") == 500
    order_columns = [
        column.element.name
        for column in statement._order_by_clauses
    ]
    assert order_columns == ["position", "created_at", "id"]


@pytest.mark.asyncio
async def test_legacy_playlist_track_read_remains_unbounded_without_limit() -> None:
    fake_session = FakeSession()

    await load_playlist_tracks(
        cast(DatabaseSession, fake_session),
        uuid4(),
    )

    statement = fake_session.statement
    assert isinstance(statement, Select)
    assert getattr(statement, "_limit_clause") is None
    assert getattr(statement, "_offset_clause") is None
