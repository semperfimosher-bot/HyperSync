from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient

from backend.app.database import get_session_factory
from backend.app.main import app
from backend.app.models.account import (
    User,
    UserProfile,
)
from backend.app.models.media import Track
from backend.app.security.passwords import (
    hash_password,
)


@pytest.mark.asyncio
async def test_general_music_search_hides_people_when_music_matches() -> None:
    run_id = uuid4().hex[:8]

    query = f"Signal {run_id}"
    username = f"listener-{run_id}"

    session_factory = get_session_factory()

    async with session_factory() as session:
        user = User(
            id=uuid4(),
            username=username,
            username_normalized=username,
            email=f"{username}@example.com",
            password_hash=hash_password(
                "search-test-pass",
            ),
            account_type="registered",
            is_active=True,
        )

        session.add(user)

        await session.flush()

        session.add(
            UserProfile(
                user_id=user.id,
                display_name=f"{query} Listener",
                bio="Search relevance test profile",
                is_public=True,
            )
        )

        session.add(
            Track(
                id=uuid4(),
                title=query,
                artist="HyperSync Test Artist",
                album="Search Test Album",
                b2_object_key=(
                    f"audio/search-relevance-{run_id}.mp3"
                ),
                mime_type="audio/mpeg",
                file_size=4096,
                duration_seconds=180,
                is_published=True,
            )
        )

        await session.commit()

    transport = ASGITransport(
        app=app,
    )

    async with AsyncClient(
        transport=transport,
        base_url="http://test",
    ) as client:
        response = await client.get(
            "/api/search",
            params={
                "q": query,
                "sort": "smart",
            },
        )

    assert response.status_code == 200, response.text

    payload = response.json()

    assert any(
        track["title"] == query
        for track in payload["tracks"]
    )

    assert payload["people"] == []
    assert payload["counts"]["people"] == 0


@pytest.mark.asyncio
async def test_explicit_people_search_still_returns_people() -> None:
    run_id = uuid4().hex[:8]

    display_name = f"Person {run_id}"
    username = f"person-{run_id}"

    session_factory = get_session_factory()

    async with session_factory() as session:
        user = User(
            id=uuid4(),
            username=username,
            username_normalized=username,
            email=f"{username}@example.com",
            password_hash=hash_password(
                "search-test-pass",
            ),
            account_type="registered",
            is_active=True,
        )

        session.add(user)

        await session.flush()

        session.add(
            UserProfile(
                user_id=user.id,
                display_name=display_name,
                bio="Explicit people search test",
                is_public=True,
            )
        )

        await session.commit()

    transport = ASGITransport(
        app=app,
    )

    async with AsyncClient(
        transport=transport,
        base_url="http://test",
    ) as client:
        response = await client.get(
            "/api/search",
            params={
                "q": f"people named {display_name}",
                "sort": "smart",
            },
        )

    assert response.status_code == 200, response.text

    payload = response.json()

    assert payload["tracks"] == []

    assert any(
        person["username"] == username
        for person in payload["people"]
    )
    