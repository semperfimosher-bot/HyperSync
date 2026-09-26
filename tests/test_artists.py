from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import (
    async_sessionmaker,
    create_async_engine,
)

import pytest

from backend.app.api.routes import (
    artists as artist_routes,
)
from backend.app.models.account import (
    AccountType,
    ListeningEvent,
    User,
)
from backend.app.models.artist import (
    ArtistFollow,
    ArtistProfile,
)
from backend.app.models.base import Base
from backend.app.models.media import Track
from backend.app.services.artists import (
    ensure_artist_profile,
)


@pytest.mark.asyncio
async def test_artist_profile_is_unique_and_reports_stats_and_follow_state() -> None:
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
    )

    async with engine.begin() as connection:
        await connection.run_sync(
            Base.metadata.create_all,
            tables=[
                Base.metadata.tables[
                    User.__tablename__
                ],
                Base.metadata.tables[
                    Track.__tablename__
                ],
                Base.metadata.tables[
                    ListeningEvent.__tablename__
                ],
                Base.metadata.tables[
                    ArtistProfile.__tablename__
                ],
                Base.metadata.tables[
                    ArtistFollow.__tablename__
                ],
            ],
        )

    session_factory = async_sessionmaker(
        engine,
        expire_on_commit=False,
    )

    async with session_factory() as session:
        listener = User(
            account_type=(
                AccountType.REGISTERED
            ),
            email="artist-listener@example.test",
            username="artist-listener",
            username_normalized="artist-listener",
            password_hash="hash",
        )

        session.add(
            listener,
        )

        first = Track(
            title="First Song",
            artist="Example Artist",
            album="First Album",
            b2_object_key="audio/artist-first.mp3",
            mime_type="audio/mpeg",
            file_size=100,
            duration_seconds=120,
            is_published=True,
        )

        second = Track(
            title="New Single",
            artist="Example Artist",
            album=None,
            b2_object_key="audio/artist-second.mp3",
            mime_type="audio/mpeg",
            file_size=100,
            duration_seconds=140,
            is_published=True,
        )

        session.add_all(
            [
                first,
                second,
            ]
        )

        await session.flush()

        session.add_all(
            [
                ListeningEvent(
                    user_id=listener.id,
                    track_id=first.id,
                ),
                ListeningEvent(
                    user_id=listener.id,
                    track_id=first.id,
                ),
                ListeningEvent(
                    user_id=listener.id,
                    track_id=second.id,
                ),
            ]
        )

        profile_a = await ensure_artist_profile(
            session,
            "Example Artist",
        )

        profile_b = await ensure_artist_profile(
            session,
            "example artist",
        )

        assert profile_a.id == profile_b.id

        await session.commit()

        response = await artist_routes.get_artist_profile(
            "Example Artist",
            session,
            listener,
        )

        assert response.name == "Example Artist"
        assert response.track_count == 2
        assert response.album_count == 2
        assert response.total_plays == 3
        assert response.monthly_listeners == 1
        assert response.followers_count == 0
        assert response.is_following is False
        assert len(
            response.popular_tracks,
        ) == 2
        assert (
            response.popular_tracks[0].title
            == "First Song"
        )

        followed = await artist_routes.follow_artist(
            "Example Artist",
            listener,
            session,
        )

        assert followed.is_following is True
        assert followed.followers_count == 1

        unfollowed = await artist_routes.unfollow_artist(
            "Example Artist",
            listener,
            session,
        )

        assert unfollowed.is_following is False
        assert unfollowed.followers_count == 0

    await engine.dispose()


@pytest.mark.asyncio
async def test_existing_catalog_artist_is_created_lazily() -> None:
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
    )

    async with engine.begin() as connection:
        await connection.run_sync(
            Base.metadata.create_all,
            tables=[
                Base.metadata.tables[
                    User.__tablename__
                ],
                Base.metadata.tables[
                    Track.__tablename__
                ],
                Base.metadata.tables[
                    ListeningEvent.__tablename__
                ],
                Base.metadata.tables[
                    ArtistProfile.__tablename__
                ],
                Base.metadata.tables[
                    ArtistFollow.__tablename__
                ],
            ],
        )

    session_factory = async_sessionmaker(
        engine,
        expire_on_commit=False,
    )

    async with session_factory() as session:
        session.add(
            Track(
                title="Legacy Song",
                artist="Legacy Artist",
                album="Archive",
                b2_object_key="audio/legacy-artist.mp3",
                mime_type="audio/mpeg",
                is_published=True,
            )
        )

        await session.commit()

        response = await artist_routes.get_artist_profile(
            "Legacy Artist",
            session,
            None,
        )

        assert response.name == "Legacy Artist"
        assert response.track_count == 1

        profile_count = (
            await session.execute(
                select(
                    ArtistProfile,
                )
            )
        ).scalars().all()

        assert len(profile_count) == 1

    await engine.dispose()
