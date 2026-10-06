from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker

from backend.app.models.base import Base
from backend.app.models.media import (
    Track,
    TrackArtistCredit,
    TrackIdentity,
)
from backend.app.services.media_identity import (
    catalog_identity_diagnostics,
    catalog_primary_artist_inventory,
    find_duplicate_track,
    load_tracks_for_artist_credit,
    sync_track_media_identity,
    track_identity_lock_key,
)


async def _factory():
    engine = create_postgres_test_engine()

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
from scripts.verification.postgres_database import create_postgres_test_engine



@pytest.mark.asyncio
async def test_legacy_duplicate_lookup_is_read_only_until_identity_sync() -> None:
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

        # Lookups stay read-only. Upload paths and the
        # startup backfill own sidecar writes.
        identity = await session.get(
            TrackIdentity,
            track.id,
        )

        assert identity is None

        await sync_track_media_identity(
            session,
            track,
        )
        await session.commit()

        identity = await session.get(
            TrackIdentity,
            track.id,
        )

        assert identity is not None
        assert identity.artist_key == "example artist"
        assert identity.title_key == "existing song"

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


def test_track_lock_identity_collapses_primary_artist_credit_formats() -> None:
    collaboration = track_identity_lock_key(
        title="Broadway Girls",
        artist="Morgan Wallen & Lil Durk",
    )

    primary_only = track_identity_lock_key(
        title="Broadway Girls",
        artist="Morgan Wallen",
    )

    remix_label = track_identity_lock_key(
        title="Broadway Girls (Remix)",
        artist="Morgan Wallen feat. Lil Durk",
    )

    assert collaboration == primary_only
    assert remix_label == primary_only


@pytest.mark.asyncio
async def test_catalog_identity_diagnostics_use_exact_legacy_and_indexed_counts() -> None:
    engine, factory = await _factory()

    async with factory() as session:
        first = Track(
            title="Broadway Girls",
            artist="Morgan Wallen & Lil Durk",
            album="Single",
            b2_object_key="audio/diag-one.mp3",
            mime_type="audio/mpeg",
            is_published=True,
        )

        second = Track(
            title="Broadway Girls",
            artist="Morgan Wallen",
            album="Single",
            b2_object_key="audio/diag-two.mp3",
            mime_type="audio/mpeg",
            is_published=True,
        )

        unique = Track(
            title="Different Song",
            artist="Morgan Wallen",
            album="Album",
            b2_object_key="audio/diag-three.mp3",
            mime_type="audio/mpeg",
            is_published=True,
        )

        session.add_all(
            [
                first,
                second,
                unique,
            ]
        )

        await session.commit()

        legacy = await catalog_identity_diagnostics(
            session,
        )

        assert legacy == {
            "track_count": 3,
            "artist_count": 2,
            "album_count": 2,
            "artwork_count": 0,
            "duplicate_groups": 1,
            "identity_backfill_pending": 3,
            "artist_profile_backfill_pending": 0,
        }

        for track in (
            first,
            second,
            unique,
        ):
            await sync_track_media_identity(
                session,
                track,
            )

        await session.commit()

        indexed = await catalog_identity_diagnostics(
            session,
        )

        assert indexed == {
            "track_count": 3,
            "artist_count": 2,
            "album_count": 2,
            "artwork_count": 0,
            "duplicate_groups": 1,
            "identity_backfill_pending": 0,
            "artist_profile_backfill_pending": 0,
        }

    await engine.dispose()


@pytest.mark.asyncio
async def test_catalog_inventory_prefers_sidecars_and_falls_back_for_legacy_rows(
) -> None:
    engine, factory = await _factory()

    async with factory() as session:
        indexed = Track(
            title="Broadway Girls",
            artist="Morgan Wallen & Lil Durk",
            album="Single",
            b2_object_key="audio/inventory-indexed.mp3",
            mime_type="audio/mpeg",
            is_published=True,
        )

        legacy = Track(
            title="Religiously",
            artist="Bailey Zimmerman & Brandon Lake",
            album="Album",
            b2_object_key="audio/inventory-legacy.mp3",
            mime_type="audio/mpeg",
            is_published=True,
        )

        unpublished = Track(
            title="Hidden",
            artist="Hidden Artist",
            album="Hidden",
            b2_object_key="audio/inventory-hidden.mp3",
            mime_type="audio/mpeg",
            is_published=False,
        )

        session.add_all(
            [
                indexed,
                legacy,
                unpublished,
            ]
        )

        await sync_track_media_identity(
            session,
            indexed,
        )

        await sync_track_media_identity(
            session,
            unpublished,
        )

        await session.commit()

        artists, identities = (
            await catalog_primary_artist_inventory(
                session,
            )
        )

        assert artists == [
            "Bailey Zimmerman",
            "Morgan Wallen",
        ]

        assert identities == {
            (
                "bailey zimmerman",
                "religiously",
            ),
            (
                "morgan wallen",
                "broadway girls",
            ),
        }

    await engine.dispose()


@pytest.mark.asyncio
async def test_catalog_primary_artist_inventory_supports_tracks_only_legacy_schema() -> None:
    engine = create_postgres_test_engine()

    async with engine.begin() as connection:
        await connection.run_sync(
            Base.metadata.create_all,
            tables=[
                Base.metadata.tables[
                    Track.__tablename__
                ],
            ],
        )

    factory = async_sessionmaker(
        engine,
        expire_on_commit=False,
    )

    async with factory() as session:
        session.add_all(
            [
                Track(
                    title="Broadway Girls",
                    artist=(
                        "Morgan Wallen & Lil Durk"
                    ),
                    album="Single",
                    b2_object_key=(
                        "audio/legacy-inventory-one.mp3"
                    ),
                    mime_type="audio/mpeg",
                    is_published=True,
                ),
                Track(
                    title="Religiously",
                    artist=(
                        "Bailey Zimmerman & Brandon Lake"
                    ),
                    album="Album",
                    b2_object_key=(
                        "audio/legacy-inventory-two.mp3"
                    ),
                    mime_type="audio/mpeg",
                    is_published=True,
                ),
                Track(
                    title="Hidden",
                    artist="Hidden Artist",
                    album="Hidden",
                    b2_object_key=(
                        "audio/legacy-inventory-hidden.mp3"
                    ),
                    mime_type="audio/mpeg",
                    is_published=False,
                ),
            ]
        )

        await session.commit()

        artists, identities = (
            await catalog_primary_artist_inventory(
                session,
            )
        )

        assert artists == [
            "Bailey Zimmerman",
            "Morgan Wallen",
        ]

        assert identities == {
            (
                "bailey zimmerman",
                "religiously",
            ),
            (
                "morgan wallen",
                "broadway girls",
            ),
        }

    await engine.dispose()
