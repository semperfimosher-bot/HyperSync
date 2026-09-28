from __future__ import annotations

from sqlalchemy.ext.asyncio import (
    async_sessionmaker,
    create_async_engine,
)

import pytest

from backend.app.models.base import Base
from backend.app.models.media import (
    Track,
    TrackArtistCredit,
    TrackIdentity,
)
from backend.app.services.media_identity import (
    find_duplicate_track,
    load_tracks_for_artist_credit,
    sync_track_media_identity,
)


async def _factory():
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
    )

    async with engine.begin() as connection:
        await connection.run_sync(
            Base.metadata.create_all,
            tables=[
                Base.metadata.tables[
                    Track.__tablename__
                ],
                Base.metadata.tables[
                    TrackIdentity.__tablename__
                ],
                Base.metadata.tables[
                    TrackArtistCredit.__tablename__
                ],
            ],
        )

    return (
        engine,
        async_sessionmaker(
            engine,
            expire_on_commit=False,
        ),
    )


@pytest.mark.asyncio
async def test_legacy_duplicate_lookup_backfills_identity_sidecar() -> None:
    engine, factory = await _factory()

    async with factory() as session:
        track = Track(
            title="Existing Song",
            artist="Example Artist",
            album="Album",
            b2_object_key=(
                "audio/existing-song.mp3"
            ),
            mime_type="audio/mpeg",
            is_published=True,
        )

        session.add(
            track,
        )

        await session.commit()

        duplicate = await find_duplicate_track(
            session,
            title="Existing Song",
            artist="Example Artist",
        )

        assert duplicate is not None
        assert duplicate.id == track.id

        identity = await session.get(
            TrackIdentity,
            track.id,
        )

        assert identity is not None
        assert identity.artist_key == "example artist"
        assert identity.title_key == "existing song"

        await session.commit()

        duplicate_again = await find_duplicate_track(
            session,
            title="Existing Song",
            artist="Example Artist",
        )

        assert duplicate_again is not None
        assert duplicate_again.id == track.id

    await engine.dispose()


@pytest.mark.asyncio
async def test_artist_credit_index_supports_all_and_primary_only_membership() -> None:
    engine, factory = await _factory()

    async with factory() as session:
        collaboration = Track(
            title="Collaboration",
            artist="Morgan Wallen & Lil Durk",
            album="Collaboration Album",
            b2_object_key=(
                "audio/collaboration.mp3"
            ),
            mime_type="audio/mpeg",
            is_published=True,
        )

        session.add(
            collaboration,
        )

        await sync_track_media_identity(
            session,
            collaboration,
        )

        await session.commit()

        morgan = await load_tracks_for_artist_credit(
            session,
            "Morgan Wallen",
            primary_only=True,
        )

        lil_durk_all = await load_tracks_for_artist_credit(
            session,
            "Lil Durk",
            primary_only=False,
        )

        lil_durk_primary = await load_tracks_for_artist_credit(
            session,
            "Lil Durk",
            primary_only=True,
        )

        assert [
            track.id
            for track in morgan
        ] == [
            collaboration.id,
        ]

        assert [
            track.id
            for track in lil_durk_all
        ] == [
            collaboration.id,
        ]

        assert lil_durk_primary == []

        credits = (
            await session.execute(
                TrackArtistCredit.__table__
                .select()
                .where(
                    TrackArtistCredit.track_id
                    == collaboration.id,
                )
                .order_by(
                    TrackArtistCredit.position.asc(),
                )
            )
        ).all()

        assert [
            row.artist_name
            for row in credits
        ] == [
            "Morgan Wallen",
            "Lil Durk",
        ]

    await engine.dispose()


@pytest.mark.asyncio
async def test_identity_sync_updates_sidecars_without_touching_track_payload() -> None:
    engine, factory = await _factory()

    async with factory() as session:
        track = Track(
            title="Same Song",
            artist="Artist One & Artist Two",
            album="Keep Me",
            b2_object_key="audio/keep-me.mp3",
            mime_type="audio/mpeg",
            is_published=True,
        )

        session.add(
            track,
        )

        await sync_track_media_identity(
            session,
            track,
        )

        await session.commit()

        original_object_key = (
            track.b2_object_key
        )
        original_album = track.album

        track.artist = "Artist One feat. Artist Three"

        await sync_track_media_identity(
            session,
            track,
        )

        await session.commit()

        assert track.b2_object_key == original_object_key
        assert track.album == original_album

        credits = await load_tracks_for_artist_credit(
            session,
            "Artist Three",
        )

        old_credit = await load_tracks_for_artist_credit(
            session,
            "Artist Two",
        )

        assert [
            item.id
            for item in credits
        ] == [
            track.id,
        ]

        assert old_credit == []

    await engine.dispose()


@pytest.mark.asyncio
async def test_duplicate_gate_matches_primary_artist_across_credit_formats() -> None:
    engine, factory = await _factory()

    async with factory() as session:
        existing = Track(
            title="Broadway Girls",
            artist="Morgan Wallen & Lil Durk",
            album="Broadway Girls",
            b2_object_key=(
                "audio/broadway-girls.mp3"
            ),
            mime_type="audio/mpeg",
            is_published=True,
        )

        session.add(
            existing,
        )

        await sync_track_media_identity(
            session,
            existing,
        )

        await session.commit()

        duplicate = await find_duplicate_track(
            session,
            title="Broadway Girls",
            artist="Morgan Wallen",
        )

        assert duplicate is not None
        assert duplicate.id == existing.id

    await engine.dispose()
