"""Real PostgreSQL races. Run with disposable HYPERSYNC_TEST_POSTGRES_URL."""

import asyncio
import importlib.util
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError

from backend.app.api.routes import playlists as routes
from backend.app.database import get_session_factory
from backend.app.models.account import User
from backend.app.models.media import Track
from backend.app.models.playlist import Playlist, PlaylistTrack
from backend.app.services.generated_playlists import ensure_artist_playlist, ensure_smart_playlist


async def seed():
    factory = get_session_factory()
    async with factory() as session:
        uid = uuid4()
        user = User(
            id=uid,
            username=f"race-{uid.hex[:20]}",
            username_normalized=f"race-{uid.hex[:20]}",
            email=f"{uid}@example.com",
            password_hash="unused",
            account_type="registered",
        )
        tracks = [
            Track(
                id=uuid4(),
                title=f"Song {i}",
                artist=f"Artist {uid}",
                genre="Country",
                b2_object_key=f"{uid}/{i}.mp3",
                mime_type="audio/mpeg",
                is_published=True,
            )
            for i in range(3)
        ]
        session.add_all([user, *tracks])
        await session.commit()
        return user.id, [t.id for t in tracks], tracks[0].artist


@pytest.mark.asyncio
@pytest.mark.parametrize("existing", [False, True])
async def test_concurrent_likes_are_idempotent_and_positions_distinct(monkeypatch, existing):
    user_id, track_ids, _ = await seed()
    factory = get_session_factory()

    async def no_activity(**kwargs):
        return None

    monkeypatch.setattr(routes, "record_admin_activity", no_activity)
    if existing:
        async with factory() as session:
            user = await session.get(User, user_id)
            assert user is not None
            await routes.like_track(track_ids[0], user, session)

    async def like(track_id):
        async with factory() as session:
            user = await session.get(User, user_id)
            assert user is not None
            return await routes.like_track(track_id, user, session)

    results = await asyncio.wait_for(
        asyncio.gather(*[like(track_id) for track_id in track_ids for _ in range(3)]), timeout=20
    )
    assert len({r.playlist_id for r in results}) == 1
    async with factory() as session:
        memberships = (
            (
                await session.execute(
                    select(PlaylistTrack).where(PlaylistTrack.playlist_id == results[0].playlist_id)
                )
            )
            .scalars()
            .all()
        )
        assert {r.track_id for r in memberships} == set(track_ids)
        assert sorted(r.position for r in memberships) == [0, 1, 2]
        user = await session.get(User, user_id)
        assert user is not None
        removed = await routes.unlike_track(track_ids[0], user, session)
        repeated = await routes.unlike_track(track_ids[0], user, session)
        assert not removed.liked and not repeated.liked
        remaining = (await session.execute(select(PlaylistTrack).where(
            PlaylistTrack.playlist_id == results[0].playlist_id
        ))).scalars().all()
        assert {row.track_id for row in remaining} == set(track_ids[1:])
        assert sorted(row.position for row in remaining) == [0, 1]


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["artist", "smart"])
@pytest.mark.parametrize("existing", [False, True])
async def test_concurrent_generated_refresh_keeps_one_membership_per_track(kind, existing):
    user_id, track_ids, artist = await seed()
    factory = get_session_factory()

    async def refresh():
        async with factory() as session:
            if kind == "artist":
                return await ensure_artist_playlist(session, artist)
            return await ensure_smart_playlist(session, user_id, "country", force_refresh=True)

    if existing:
        playlist = await refresh()
        assert playlist is not None
        async with factory() as session:
            row = await session.get(Playlist, playlist.id)
            assert row is not None
            row.generator_version = 0
            await session.commit()
    results = await asyncio.wait_for(asyncio.gather(*[refresh() for _ in range(6)]), timeout=20)
    assert all(p is not None for p in results)
    results = [p for p in results if p is not None]
    assert len({p.id for p in results}) == 1
    async with factory() as session:
        rows = (
            (
                await session.execute(
                    select(PlaylistTrack).where(PlaylistTrack.playlist_id == results[0].id)
                )
            )
            .scalars()
            .all()
        )
        assert {r.track_id for r in rows} == set(track_ids)
        assert sorted(r.position for r in rows) == [0, 1, 2]
        session.add(PlaylistTrack(playlist_id=results[0].id, track_id=track_ids[0], position=3))
        with pytest.raises(IntegrityError):
            await session.flush()


@pytest.mark.asyncio
async def test_membership_migration_keeps_earliest_and_repairs_positions():
    user_id, track_ids, _ = await seed()
    factory = get_session_factory()
    path = Path("migrations/versions/74c2e8f1a9b6_playlist_membership_integrity.py")
    spec = importlib.util.spec_from_file_location("membership_migration", path)
    assert spec is not None and spec.loader is not None
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    async with factory() as session:
        async with session.begin():
            await session.execute(
                text(
                    "ALTER TABLE playlist_tracks DROP CONSTRAINT uq_playlist_tracks_playlist_track"
                )
            )
            playlist = Playlist(owner_id=user_id, title="legacy", visibility="private")
            session.add(playlist)
            await session.flush()
            earliest = PlaylistTrack(
                playlist_id=playlist.id,
                track_id=track_ids[0],
                position=7,
                created_at=datetime.now(UTC) - timedelta(days=1),
            )
            session.add_all(
                [
                    earliest,
                    PlaylistTrack(playlist_id=playlist.id, track_id=track_ids[0], position=0),
                    PlaylistTrack(playlist_id=playlist.id, track_id=track_ids[1], position=5),
                ]
            )
            await session.flush()
            connection = await session.connection()

            def upgrade(sync_connection):
                with Operations.context(MigrationContext.configure(sync_connection)):
                    migration.upgrade()

            await connection.run_sync(upgrade)
            rows = (
                (
                    await session.execute(
                        select(PlaylistTrack)
                        .where(PlaylistTrack.playlist_id == playlist.id)
                        .order_by(PlaylistTrack.position)
                    )
                )
                .scalars()
                .all()
            )
            assert len(rows) == 2
            assert earliest.id in {row.id for row in rows}
            # Bulk migration SQL bypasses the ORM identity map.
            await session.refresh(earliest)
            assert sorted(
                (
                    await session.execute(
                        select(PlaylistTrack.position).where(
                            PlaylistTrack.playlist_id == playlist.id
                        )
                    )
                ).scalars()
            ) == [0, 1]
            assert (
                await session.execute(select(func.count()).select_from(Track))
            ).scalar_one() == 3


@pytest.mark.asyncio
async def test_owner_add_is_idempotent_and_reorder_remove_remain_compatible(monkeypatch):
    user_id, track_ids, _ = await seed()
    factory = get_session_factory()

    async def no_activity(**kwargs):
        return None

    monkeypatch.setattr(routes, "record_admin_activity", no_activity)
    async with factory() as session:
        playlist = Playlist(owner_id=user_id, title="Owned", visibility="private")
        session.add(playlist)
        await session.commit()
        playlist_id = playlist.id

    async def add(track_id):
        async with factory() as session:
            user = await session.get(User, user_id)
            assert user is not None
            return await routes.add_track_to_playlist(
                playlist_id, routes.PlaylistTrackAddRequest(track_id=track_id), user, session
            )

    rows = await asyncio.wait_for(
        asyncio.gather(*[add(track_id) for track_id in track_ids for _ in range(2)]), timeout=20
    )
    assert len({r.playlist_track_id for r in rows}) == 3
    ids = list(dict.fromkeys(row.playlist_track_id for row in rows))
    async with factory() as session:
        user = await session.get(User, user_id)
        assert user is not None
        result = await routes.reorder_playlist_tracks(
            playlist_id, routes.PlaylistReorderRequest(playlist_track_ids=ids[::-1]), user, session
        )
        assert [row.playlist_track_id for row in result.tracks] == ids[::-1]
        await routes.remove_track_from_playlist(playlist_id, ids[0], user, session)
        positions = (
            (
                await session.execute(
                    select(PlaylistTrack.position)
                    .where(PlaylistTrack.playlist_id == playlist_id)
                    .order_by(PlaylistTrack.position)
                )
            )
            .scalars()
            .all()
        )
        assert positions == [0, 1]


@pytest.mark.asyncio
async def test_maintenance_batch_reuses_one_stream_for_same_query_across_owners(monkeypatch):
    from backend.app.services import generated_playlists as generated

    user_id, track_ids, _ = await seed()
    factory = get_session_factory()
    async with factory() as session:
        second_id = uuid4()
        session.add(User(
            id=second_id, username=f"batch-{second_id.hex[:20]}",
            username_normalized=f"batch-{second_id.hex[:20]}", email=f"{second_id}@example.com",
            password_hash="unused", account_type="registered",
        ))
        await session.commit()
        await ensure_smart_playlist(session, user_id, "country")
        await ensure_smart_playlist(session, second_id, "country")

        calls = 0
        original = generated._prepare_smart_rankings

        async def prepare(active_session, queries):
            nonlocal calls
            calls += 1
            return await original(active_session, queries)

        monkeypatch.setattr(generated, "_prepare_smart_rankings", prepare)
        track = await session.get(Track, track_ids[0])
        assert track is not None
        refreshed = await generated.refresh_smart_playlists_for_track(session, track)
        assert refreshed == 2
        assert calls == 1


@pytest.mark.asyncio
async def test_seed_string_values_fit_declared_column_limits(monkeypatch):
    """Validate the fixture before PostgreSQL rejects an oversized seed value."""
    from sqlalchemy import String

    inserted = []

    class SeedSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        def add_all(self, rows):
            inserted.extend(rows)

        async def commit(self):
            return None

    monkeypatch.setitem(seed.__globals__, "get_session_factory", lambda: SeedSession)
    await seed()
    for row in inserted:
        for column in row.__table__.columns:
            value = getattr(row, column.name)
            if isinstance(column.type, String) and column.type.length and value is not None:
                assert len(value) <= column.type.length, f"{row.__tablename__}.{column.name}"


@pytest.mark.asyncio
async def test_worker_smart_refresh_resumes_after_committed_page_and_new_track_change(monkeypatch):
    from backend.app.services import generated_playlists as generated

    user_id, track_ids, _ = await seed()
    factory = get_session_factory()
    async with factory() as session:
        track = await session.get(Track, track_ids[0])
        assert track is not None
        for query in ("country", "country mix", "country music"):
            playlist = await ensure_smart_playlist(session, user_id, query)
            assert playlist is not None
            playlist.generated_at = track.updated_at - timedelta(days=1)
        await session.commit()
        original = generated.ensure_smart_playlist
        committed_ids = []
        interrupt = True

        async def refresh(*args, **kwargs):
            nonlocal interrupt
            playlist = await original(*args, **kwargs)
            assert playlist is not None
            committed_ids.append(playlist.id)
            if interrupt:
                interrupt = False
                raise TimeoutError("deadline after playlist commit")
            return playlist

        monkeypatch.setattr(generated, "SMART_REFRESH_TARGET_BATCH_SIZE", 1)
        monkeypatch.setattr(generated, "ensure_smart_playlist", refresh)
        with pytest.raises(TimeoutError):
            await generated.refresh_smart_playlists_for_track(session, track, only_stale=True)
        assert await generated.refresh_smart_playlists_for_track(
            session, track, only_stale=True,
        ) == 2
        assert len(committed_ids) == len(set(committed_ids)) == 3
        assert await generated.refresh_smart_playlists_for_track(
            session, track, only_stale=True,
        ) == 0
        # A later metadata edit must make every completed target eligible again.
        track.title += " changed"
        await session.commit()
        await session.refresh(track)
        assert await generated.refresh_smart_playlists_for_track(
            session, track, only_stale=True,
        ) == 3
