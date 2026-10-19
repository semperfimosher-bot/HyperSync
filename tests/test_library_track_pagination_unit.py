"""Database-free tests for bounded library-track pagination."""

from types import SimpleNamespace
from typing import Any, cast
from uuid import uuid4

import pytest

from backend.app.api.routes import playlists as routes
from backend.app.models.account import AccountType


@pytest.mark.asyncio
async def test_library_track_page_applies_limit_and_offset(monkeypatch):
    user = SimpleNamespace(
        id=uuid4(),
        account_type=AccountType.REGISTERED,
    )
    track = SimpleNamespace(
        id=uuid4(),
        title="Paged song",
        artist="Artist",
        album="Album",
        genre="Pop",
        release_year=2025,
        duration_seconds=180,
        mime_type="audio/mpeg",
        file_size=1024,
        created_at=None,
    )

    class Result:
        def scalars(self):
            return self

        def all(self):
            return [track]

    class Session:
        statement: Any | None = None

        async def execute(self, statement):
            self.statement = statement
            return Result()

    session = Session()
    monkeypatch.setattr(routes, "_track_audio_url", lambda _track: None)
    monkeypatch.setattr(routes, "_track_artwork_url", lambda _track: None)
    monkeypatch.setattr(routes, "_track_media_version", lambda _track: None)
    monkeypatch.setattr(routes, "_track_artwork_version", lambda _track: None)

    result = await routes.get_library_tracks(
        cast(Any, user),
        cast(Any, session),
        limit=25,
        offset=50,
    )

    assert len(result) == 1
    assert result[0].id == track.id
    assert session.statement is not None
    assert session.statement._limit_clause.value == 25
    assert session.statement._offset_clause.value == 50


@pytest.mark.asyncio
async def test_library_track_legacy_call_keeps_unpaged_contract(monkeypatch):
    user = SimpleNamespace(
        id=uuid4(),
        account_type=AccountType.REGISTERED,
    )

    class Result:
        def scalars(self):
            return self

        def all(self):
            return []

    class Session:
        statement = None

        async def execute(self, statement):
            self.statement = statement
            return Result()

    session = Session()
    monkeypatch.setattr(routes, "_track_audio_url", lambda _track: None)
    monkeypatch.setattr(routes, "_track_artwork_url", lambda _track: None)
    monkeypatch.setattr(routes, "_track_media_version", lambda _track: None)
    monkeypatch.setattr(routes, "_track_artwork_version", lambda _track: None)

    result = await routes.get_library_tracks(
        cast(Any, user),
        cast(Any, session),
        limit=None,
        offset=0,
    )

    assert result == []
    assert session.statement is not None
    assert session.statement._limit_clause is None
    assert session.statement._offset_clause is None
