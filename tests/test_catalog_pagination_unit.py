"""Database-free cursor validation and bounded SQL checks."""

import base64
import json
from types import SimpleNamespace
from uuid import UUID

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.dialects import postgresql

from backend.app.api.routes import catalog


class PageSession:
    def __init__(self):
        self.statements = []
        self.highwater: UUID | None = UUID(int=5)
        self.rows = [
            SimpleNamespace(
                id=UUID(int=n),
                title="same",
                artist="same",
                album=None,
                genre=None,
                release_year=None,
                duration_seconds=None,
                mime_type="audio/mpeg",
                file_size=None,
                b2_object_key="https://audio.test/song",
                artwork_object_key=None,
            )
            for n in [1, 2, 3]
        ]

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    async def scalar(self, statement):
        self.statements.append(statement)
        return self.highwater

    async def execute(self, statement):
        self.statements.append(statement)
        return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: self.rows))


@pytest.mark.asyncio
async def test_page_query_is_bounded_and_cursor_contains_last_emitted_id(monkeypatch):
    session = PageSession()
    monkeypatch.setattr(catalog, "get_session_factory", lambda: lambda: session)
    app = FastAPI()
    app.include_router(catalog.router)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/catalog/tracks", params={"page_size": 2, "q": "same"})
        assert response.status_code == 200, response.text
        page = response.json()
        assert len(page["items"]) == 2
        assert catalog._decode_catalog_cursor(page["next_cursor"], "same") == (
            UUID(int=2),
            UUID(int=5),
        )
        sql = str(
            session.statements[-1].compile(
                dialect=postgresql.dialect(),
                compile_kwargs={"literal_binds": True},
            )
        )
        assert "LIMIT 3" in sql and "ORDER BY tracks.id" in sql
        assert "OFFSET" not in sql
        session.rows = []
        continued = await client.get(
            "/catalog/tracks", params={"cursor": page["next_cursor"], "q": "same"}
        )
        assert continued.json() == {"items": [], "next_cursor": None}
        sql = str(
            session.statements[-1].compile(
                dialect=postgresql.dialect(),
                compile_kwargs={"literal_binds": True},
            )
        )
        assert "tracks.id >" in sql and "tracks.id <=" in sql and "LIMIT 251" in sql


@pytest.mark.asyncio
async def test_empty_highwater_never_queries_an_unbounded_new_snapshot(monkeypatch):
    session = PageSession()
    session.highwater = None
    monkeypatch.setattr(catalog, "get_session_factory", lambda: lambda: session)
    response = await catalog.list_tracks(catalog.Response(), q=None, page_size=2, cursor=None)
    assert response == catalog.CatalogPageResponse(items=[])
    assert len(session.statements) == 1


@pytest.mark.asyncio
async def test_bad_cursor_and_limits_fail_before_database_access(monkeypatch):
    def unexpected_database():
        raise AssertionError("Invalid cursor must be rejected before DB access")

    monkeypatch.setattr(catalog, "get_session_factory", unexpected_database)
    app = FastAPI()
    app.include_router(catalog.router)
    invalid_payloads = [[1, 2, 3, "bad"], {}, [1, "invalid", "uuid", "bad"]]
    cursors = ["bad", "!!!!", catalog._catalog_cursor(UUID(int=3), UUID(int=2), "")]
    cursors.extend(
        base64.urlsafe_b64encode(json.dumps(p).encode()).decode() for p in invalid_payloads
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        for cursor in cursors:
            response = await client.get("/catalog/tracks", params={"cursor": cursor})
            assert response.status_code == 400, response.text
        for size in [0, -1, 501]:
            response = await client.get("/catalog/tracks", params={"page_size": size})
            assert response.status_code == 422
