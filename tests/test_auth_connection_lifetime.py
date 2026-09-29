import asyncio
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.app import database
from backend.app.api.dependencies import CurrentUser, DatabaseSession
from backend.app.api.routes import on_demand
from backend.app.config import get_settings
from backend.app.models import AccountType, Base, User, UserProfile, UserSession
from backend.app.security import rate_limit
from backend.app.security.tokens import create_access_token


@pytest.fixture
async def constrained_database(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> AsyncIterator[tuple[FastAPI, list[str]]]:
    await database.close_database()
    monkeypatch.setenv("JWT_SECRET", "pool-test-secret-that-is-longer-than-thirty-two-characters")
    get_settings.cache_clear()
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'pool.db'}",
        pool_size=1,
        max_overflow=0,
        pool_timeout=1,
    )
    factory = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    monkeypatch.setattr(database, "get_session_factory", lambda: factory)
    monkeypatch.setattr(rate_limit, "get_session_factory", lambda: factory)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    tokens = []
    async with factory() as session:
        for index in range(20):
            user = User(
                id=uuid4(),
                account_type=AccountType.REGISTERED,
                email=f"pool-{index}@example.com",
                username=f"pool-{index}",
                username_normalized=f"pool-{index}",
                password_hash="unused",
            )
            auth_session = UserSession(
                id=uuid4(),
                user_id=user.id,
                refresh_token_hash=uuid4().hex,
                expires_at=datetime.now(UTC) + timedelta(hours=1),
            )
            session.add_all(
                [
                    user,
                    auth_session,
                    UserProfile(user_id=user.id, display_name="Pool", bio="original"),
                ]
            )
            token, _ = create_access_token(user_id=user.id, session_id=auth_session.id, role="user")
            tokens.append(token)
        await session.commit()
    app = FastAPI()
    app.include_router(on_demand.router, prefix="/api")

    @app.post("/update-user")
    async def update_user(user: CurrentUser, session: DatabaseSession):
        user.username = "updated"
        assert user.profile is not None
        user.profile.bio = "updated profile"
        await session.commit()
        return {"username": user.username, "bio": user.profile.bio if user.profile else None}

    @app.get("/read-user")
    async def read_user(user: CurrentUser):
        return {"username": user.username, "bio": user.profile.bio if user.profile else None}

    try:
        yield app, tokens
    finally:
        await engine.dispose()
        get_settings.cache_clear()


@pytest.mark.asyncio
async def test_search_authentication_releases_connection_before_rate_limit(
    constrained_database, monkeypatch: pytest.MonkeyPatch
) -> None:
    app, tokens = constrained_database

    async def search(*args, **kwargs):
        return []

    monkeypatch.setattr(on_demand, "search_and_remember", search)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get(
            "/api/on-demand/search?q=artist",
            headers={"Authorization": f"Bearer {tokens[0]}"},
        )
        assert response.status_code == 200, response.text


@pytest.mark.asyncio
async def test_slow_external_searches_do_not_starve_authenticated_requests(
    constrained_database, monkeypatch: pytest.MonkeyPatch
) -> None:
    app, tokens = constrained_database
    all_searches_started = asyncio.Event()
    release_searches = asyncio.Event()
    count = 0

    async def search(*args, **kwargs):
        nonlocal count
        count += 1
        if count == len(tokens):
            all_searches_started.set()
        await release_searches.wait()
        return []

    monkeypatch.setattr(on_demand, "search_and_remember", search)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        requests = [
            asyncio.create_task(
                client.get(
                    "/api/on-demand/search?q=artist", headers={"Authorization": f"Bearer {token}"}
                )
            )
            for token in tokens
        ]
        try:
            await asyncio.wait_for(all_searches_started.wait(), timeout=5)
            response = await client.get(
                "/read-user", headers={"Authorization": f"Bearer {tokens[0]}"}
            )
            assert response.status_code == 200, response.text
        finally:
            release_searches.set()
            results = await asyncio.gather(*requests, return_exceptions=True)
        assert all(
            not isinstance(result, BaseException) and result.status_code == 200
            for result in results
        )


@pytest.mark.asyncio
async def test_authenticated_user_updates_still_persist(constrained_database) -> None:
    app, tokens = constrained_database
    headers = {"Authorization": f"Bearer {tokens[0]}"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/update-user", headers=headers)
        assert response.status_code == 200, response.text
        response = await client.get("/read-user", headers=headers)
        assert response.json()["username"] == "updated"
        assert response.json()["bio"] == "updated profile"
