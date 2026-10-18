from uuid import uuid4

import pytest
from fastapi import Response

from backend.app.api.routes import catalog as catalog_route
from backend.app.api.routes import playlists as playlists_route


class FakeRows:
    def scalars(self):
        return self

    def all(self):

    def first(self):
        return None

    def __iter__(self):
        return iter([])



class FakeSession:
    def __init__(self):
        self.statement = None

    async def execute(self, statement, *args, **kwargs):
        self.statement = statement
        return FakeRows()


@pytest.mark.asyncio
async def test_catalog_pagination_applies_limit_and_offset(monkeypatch):
    session = FakeSession()

    class SessionContext:
        async def __aenter__(self):
            return session

        async def __aexit__(self, *args):
            return False

    monkeypatch.setattr(
        catalog_route,
        "get_session_factory",
        lambda: lambda: SessionContext(),
    )

    response = await catalog_route.list_tracks(
        Response(),
        limit=25,
        offset=50,
    )

    assert response == []
    sql = str(session.statement).lower()
    assert " limit " in sql
    assert " offset " in sql


@pytest.mark.asyncio
async def test_playlist_track_pagination_applies_limit_and_offset():
    session = FakeSession()

    await playlists_route.load_playlist_tracks(
        session,
        uuid4(),
        limit=25,
        offset=50,
    )

    sql = str(session.statement).lower()
    assert " limit " in sql
    assert " offset " in sql


@pytest.mark.asyncio
async def test_playlist_track_query_can_keep_legacy_unbounded_mode():
    session = FakeSession()

    await playlists_route.load_playlist_tracks(
        session,
        uuid4(),
    )

    sql = str(session.statement).lower()
    assert " limit " not in sql
    assert " offset " in sql
