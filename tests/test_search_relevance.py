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


async def _add_registered_user(
    session,
    *,
    username: str,
    display_name: str,
) -> User:
    user = User(
        id=uuid4(),
        username=username,
        username_normalized=username.casefold(),
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
            bio="Search relevance test profile",
            is_public=True,
        )
    )

    return user


@pytest.mark.asyncio
async def test_general_search_returns_music_and_people() -> None:
    run_id = uuid4().hex[:8]

    query = f"Signal {run_id}"
    username = f"listener-{run_id}"

    session_factory = get_session_factory()

    async with session_factory() as session:
        await _add_registered_user(
            session,
            username=username,
            display_name=f"{query} Listener",
        )

        session.add(
            Track(
                id=uuid4(),
                title=query,
                artist="HyperSync Test Artist",
                album="Search Test Album",
                b2_object_key=(f"audio/search-relevance-{run_id}.mp3"),
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

    assert any(track["title"] == query for track in payload["tracks"])

    assert any(person["username"] == username for person in payload["people"])


@pytest.mark.asyncio
async def test_explicit_people_search_returns_people_only() -> None:
    run_id = uuid4().hex[:8]

    display_name = f"Person {run_id}"
    username = f"person-{run_id}"

    session_factory = get_session_factory()

    async with session_factory() as session:
        await _add_registered_user(
            session,
            username=username,
            display_name=display_name,
        )

        session.add(
            Track(
                id=uuid4(),
                title=display_name,
                artist="People Intent Test",
                album="People Intent Album",
                b2_object_key=(f"audio/people-intent-{run_id}.mp3"),
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
                "q": f"people {display_name}",
                "sort": "smart",
            },
        )

    assert response.status_code == 200, response.text

    payload = response.json()

    assert payload["tracks"] == []

    assert any(person["username"] == username for person in payload["people"])


@pytest.mark.asyncio
async def test_music_specific_search_does_not_return_people() -> None:
    run_id = uuid4().hex[:8]

    artist_name = f"Artist {run_id}"
    username = f"artist-person-{run_id}"

    session_factory = get_session_factory()

    async with session_factory() as session:
        await _add_registered_user(
            session,
            username=username,
            display_name=artist_name,
        )

        session.add(
            Track(
                id=uuid4(),
                title=f"Song {run_id}",
                artist=artist_name,
                album="Music Intent Album",
                b2_object_key=(f"audio/music-intent-{run_id}.mp3"),
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
                "q": f"songs by {artist_name}",
                "sort": "smart",
            },
        )

    assert response.status_code == 200, response.text

    payload = response.json()

    assert any(track["artist"] == artist_name for track in payload["tracks"])

    assert payload["people"] == []
