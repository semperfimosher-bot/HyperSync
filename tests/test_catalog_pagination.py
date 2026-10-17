"""PostgreSQL regression coverage for opt-in bounded catalog traversal."""

from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient

from backend.app.database import get_session_factory
from backend.app.main import app
from backend.app.models.media import Track


async def add_tracks(ids: list[int], marker: str) -> None:
    async with get_session_factory()() as session:
        session.add_all(
            [
                Track(
                    id=UUID(int=value),
                    title=marker,
                    artist="Same artist",
                    album=None,
                    b2_object_key=f"audio/{marker}/{value}",
                    is_published=True,
                )
                for value in ids
            ]
        )
        await session.commit()


@pytest.mark.asyncio
async def test_catalog_pages_cover_equal_metadata_and_keep_legacy_array() -> None:
    marker = uuid4().hex
    await add_tracks([1, 2, 3, 4, 5], marker)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        legacy = await client.get("/api/catalog/tracks", params={"q": marker})
        assert isinstance(legacy.json(), list)
        cursor = None
        ids = []
        sizes = []
        while True:
            params = {"q": marker, "page_size": 2}
            if cursor:
                params["cursor"] = cursor
            response = await client.get("/api/catalog/tracks", params=params)
            assert response.status_code == 200, response.text
            page = response.json()
            assert isinstance(page, dict), "opt-in pagination must return a page envelope"
            sizes.append(len(page["items"]))
            ids.extend(row["id"] for row in page["items"])
            cursor = page["next_cursor"]
            if cursor is None:
                break
        assert ids == [str(UUID(int=value)) for value in [1, 2, 3, 4, 5]]
        assert sizes == [2, 2, 1]


@pytest.mark.asyncio
async def test_cursor_survives_deletion_and_bounds_new_high_ids() -> None:
    marker = uuid4().hex
    await add_tracks([10, 20, 30, 40], marker)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        first = await client.get("/api/catalog/tracks", params={"q": marker, "page_size": 2})
        page = first.json()
        assert isinstance(page, dict), "pagination is not implemented"
        async with get_session_factory()() as session:
            row = await session.get(Track, UUID(int=10))
            await session.delete(row)
            await session.commit()
        await add_tracks([50], marker)
        second = await client.get(
            "/api/catalog/tracks",
            params={
                "q": marker,
                "page_size": 2,
                "cursor": page["next_cursor"],
            },
        )
        assert [row["id"] for row in second.json()["items"]] == [str(UUID(int=n)) for n in [30, 40]]
        assert second.json()["next_cursor"] is None
        wrong_query = await client.get(
            "/api/catalog/tracks",
            params={
                "q": "different",
                "page_size": 2,
                "cursor": page["next_cursor"],
            },
        )
        assert wrong_query.status_code == 400


@pytest.mark.asyncio
async def test_page_limits_bad_cursors_and_empty_pages() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        for size in [0, -1, 501]:
            response = await client.get("/api/catalog/tracks", params={"page_size": size})
            assert response.status_code == 422
        invalid = await client.get("/api/catalog/tracks", params={"page_size": 2, "cursor": "bad"})
        assert invalid.status_code == 400
        empty = await client.get("/api/catalog/tracks", params={"page_size": 2, "q": uuid4().hex})
        assert empty.json() == {"items": [], "next_cursor": None}
