from uuid import uuid4

import pytest
from sqlalchemy import func, select

from backend.app.database import get_session_factory
from backend.app.models.account import User
from backend.app.models.media import Track
from backend.app.models.playlist import (
    PlaylistTrack,
    SavedPlaylist,
)
from backend.app.services.generated_playlists import (
    MAX_GENERATED_TRACKS,
    ensure_artist_playlist,
    ensure_smart_playlist,
    refresh_smart_playlists_for_track,
    smart_track_score,
)


@pytest.mark.asyncio
async def test_saved_generated_playlist_refreshes_in_place_for_new_music() -> None:
    run_id = uuid4().hex[:8]
    artist = f"Generated Refresh {run_id}"

    session_factory = get_session_factory()

    async with session_factory() as session:
        user = User(
            id=uuid4(),
            username=f"refresh-{run_id}",
            username_normalized=f"refresh-{run_id}",
            email=f"refresh-{run_id}@example.com",
            password_hash="test-password-hash",
            account_type="registered",
            is_active=True,
        )

        session.add(user)

        session.add_all(
            [
                Track(
                    id=uuid4(),
                    title="First",
                    artist=artist,
                    album="Generated",
                    b2_object_key=f"audio/{run_id}-first.mp3",
                    mime_type="audio/mpeg",
                    file_size=1000,
                    duration_seconds=180,
                    is_published=True,
                ),
                Track(
                    id=uuid4(),
                    title="Second",
                    artist=artist,
                    album="Generated",
                    b2_object_key=f"audio/{run_id}-second.mp3",
                    mime_type="audio/mpeg",
                    file_size=1000,
                    duration_seconds=180,
                    is_published=True,
                ),
            ]
        )

        await session.commit()

        playlist = await ensure_artist_playlist(
            session,
            artist,
        )

        assert playlist is not None
        assert playlist.title == artist

        playlist_id = playlist.id

        session.add(
            SavedPlaylist(
                user_id=user.id,
                playlist_id=playlist_id,
            )
        )

        await session.commit()

        session.add(
            Track(
                id=uuid4(),
                title="Third",
                artist=artist,
                album="Generated",
                b2_object_key=f"audio/{run_id}-third.mp3",
                mime_type="audio/mpeg",
                file_size=1000,
                duration_seconds=180,
                is_published=True,
            )
        )

        await session.commit()

        refreshed = await ensure_artist_playlist(
            session,
            artist,
        )

        assert refreshed is not None
        assert refreshed.id == playlist_id
        assert refreshed.title == artist

        track_count = (
            await session.execute(
                select(
                    func.count(
                        PlaylistTrack.id,
                    )
                ).where(
                    PlaylistTrack.playlist_id
                    == playlist_id,
                )
            )
        ).scalar_one()

        assert track_count == 3

        saved = await session.get(
            SavedPlaylist,
            (
                user.id,
                playlist_id,
            ),
        )

        assert saved is not None


@pytest.mark.asyncio
async def test_generated_artist_playlist_includes_full_catalog_up_to_700_tracks() -> None:
    run_id = uuid4().hex[:8]
    artist = f"Generated Full Catalog {run_id}"

    session_factory = get_session_factory()

    async with session_factory() as session:
        matching_tracks = [
            Track(
                id=uuid4(),
                title=f"Catalog Song {index:03d}",
                artist=artist,
                album="Full Catalog",
                b2_object_key=(
                    f"audio/{run_id}-catalog-{index:03d}.mp3"
                ),
                mime_type="audio/mpeg",
                file_size=1000,
                duration_seconds=180,
                is_published=True,
            )
            for index in range(
                MAX_GENERATED_TRACKS + 5,
            )
        ]

        session.add_all(
            matching_tracks
        )

        session.add(
            Track(
                id=uuid4(),
                title="Unpublished",
                artist=artist,
                album="Full Catalog",
                b2_object_key=(
                    f"audio/{run_id}-unpublished.mp3"
                ),
                mime_type="audio/mpeg",
                file_size=1000,
                duration_seconds=180,
                is_published=False,
            )
        )

        session.add(
            Track(
                id=uuid4(),
                title="Other Artist",
                artist=f"Other Artist {run_id}",
                album="Full Catalog",
                b2_object_key=(
                    f"audio/{run_id}-other-artist.mp3"
                ),
                mime_type="audio/mpeg",
                file_size=1000,
                duration_seconds=180,
                is_published=True,
            )
        )

        await session.commit()

        playlist = await ensure_artist_playlist(
            session,
            artist,
        )

        assert playlist is not None

        rows = list(
            (
                await session.execute(
                    select(
                        PlaylistTrack.track_id,
                    ).where(
                        PlaylistTrack.playlist_id
                        == playlist.id,
                    )
                )
            ).scalars().all()
        )

        assert len(rows) == 700

        matching_ids = {
            track.id
            for track in matching_tracks
        }

        assert set(rows).issubset(
            matching_ids,
        )


@pytest.mark.asyncio
async def test_legacy_essentials_title_is_removed_without_catalog_change() -> None:
    run_id = uuid4().hex[:8]
    artist = f"Generated Rename {run_id}"

    session_factory = get_session_factory()

    async with session_factory() as session:
        session.add_all(
            [
                Track(
                    id=uuid4(),
                    title="First",
                    artist=artist,
                    album="Generated",
                    b2_object_key=f"audio/{run_id}-rename-first.mp3",
                    mime_type="audio/mpeg",
                    file_size=1000,
                    duration_seconds=180,
                    is_published=True,
                ),
                Track(
                    id=uuid4(),
                    title="Second",
                    artist=artist,
                    album="Generated",
                    b2_object_key=f"audio/{run_id}-rename-second.mp3",
                    mime_type="audio/mpeg",
                    file_size=1000,
                    duration_seconds=180,
                    is_published=True,
                ),
            ]
        )

        await session.commit()

        playlist = await ensure_artist_playlist(
            session,
            artist,
        )

        assert playlist is not None

        playlist_id = playlist.id
        playlist.title = (
            f"{artist} Essentials"
        )

        await session.commit()

        renamed = await ensure_artist_playlist(
            session,
            artist,
        )

        assert renamed is not None
        assert renamed.id == playlist_id
        assert renamed.title == artist



def test_country_smart_match_rejects_rap() -> None:
    country = Track(
        id=uuid4(),
        title="Country Song",
        artist="Country Artist",
        album="Country Album",
        genre="Country",
        b2_object_key="audio/country.mp3",
        mime_type="audio/mpeg",
        file_size=1000,
        duration_seconds=180,
        is_published=True,
    )

    rap = Track(
        id=uuid4(),
        title="Rap Song",
        artist="Rap Artist",
        album="Rap Album",
        genre="Hip-Hop/Rap",
        b2_object_key="audio/rap.mp3",
        mime_type="audio/mpeg",
        file_size=1000,
        duration_seconds=180,
        is_published=True,
    )

    assert (
        smart_track_score(
            country,
            "country",
        )
        > 0
    )

    assert (
        smart_track_score(
            rap,
            "country",
        )
        == 0
    )


def test_chill_evening_query_uses_calm_genre_families() -> None:
    soul = Track(
        id=uuid4(),
        title="Slow Lights",
        artist="Night Artist",
        album="After Dark",
        genre="R&B/Soul",
        b2_object_key="audio/soul.mp3",
        mime_type="audio/mpeg",
        file_size=1000,
        duration_seconds=180,
        is_published=True,
    )

    metal = Track(
        id=uuid4(),
        title="Heavy Lights",
        artist="Loud Artist",
        album="After Dark",
        genre="Metal",
        b2_object_key="audio/metal.mp3",
        mime_type="audio/mpeg",
        file_size=1000,
        duration_seconds=180,
        is_published=True,
    )

    assert (
        smart_track_score(
            soul,
            "chill evening music",
        )
        > 0
    )

    assert (
        smart_track_score(
            metal,
            "chill evening music",
        )
        == 0
    )


@pytest.mark.asyncio
async def test_smart_genre_playlist_refreshes_when_matching_music_is_added() -> None:
    run_id = uuid4().hex[:8]
    session_factory = get_session_factory()

    async with session_factory() as session:
        user = User(
            id=uuid4(),
            username=f"smart-{run_id}",
            username_normalized=f"smart-{run_id}",
            email=f"smart-{run_id}@example.com",
            password_hash="test-password-hash",
            account_type="registered",
            is_active=True,
        )

        first_country = Track(
            id=uuid4(),
            title="First Country",
            artist=f"Country Artist {run_id}",
            album="Country",
            genre="Country",
            b2_object_key=f"audio/{run_id}-country-1.mp3",
            mime_type="audio/mpeg",
            file_size=1000,
            duration_seconds=180,
            is_published=True,
        )

        rap = Track(
            id=uuid4(),
            title="Unrelated Rap",
            artist=f"Rap Artist {run_id}",
            album="Rap",
            genre="Hip-Hop/Rap",
            b2_object_key=f"audio/{run_id}-rap.mp3",
            mime_type="audio/mpeg",
            file_size=1000,
            duration_seconds=180,
            is_published=True,
        )

        session.add_all(
            [
                user,
                first_country,
                rap,
            ]
        )

        await session.commit()

        playlist = await ensure_smart_playlist(
            session,
            user.id,
            "country",
        )

        assert playlist is not None

        playlist_id = playlist.id

        first_rows = list(
            (
                await session.execute(
                    select(
                        PlaylistTrack.track_id,
                    ).where(
                        PlaylistTrack.playlist_id
                        == playlist_id,
                    )
                )
            ).scalars().all()
        )

        assert first_rows == [
            first_country.id,
        ]

        second_country = Track(
            id=uuid4(),
            title="Second Country",
            artist=f"Another Country Artist {run_id}",
            album="Country",
            genre="Americana",
            b2_object_key=f"audio/{run_id}-country-2.mp3",
            mime_type="audio/mpeg",
            file_size=1000,
            duration_seconds=180,
            is_published=True,
        )

        session.add(
            second_country,
        )

        await session.commit()

        refreshed_count = (
            await refresh_smart_playlists_for_track(
                session,
                second_country,
            )
        )

        assert refreshed_count == 1

        refreshed = await ensure_smart_playlist(
            session,
            user.id,
            "country",
        )

        assert refreshed is not None
        assert refreshed.id == playlist_id

        refreshed_rows = set(
            (
                await session.execute(
                    select(
                        PlaylistTrack.track_id,
                    ).where(
                        PlaylistTrack.playlist_id
                        == playlist_id,
                    )
                )
            ).scalars().all()
        )

        assert refreshed_rows == {
            first_country.id,
            second_country.id,
        }
