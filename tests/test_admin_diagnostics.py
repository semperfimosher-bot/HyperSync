from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import (
    async_sessionmaker,
    create_async_engine,
)

from backend.app.api.routes import admin as admin_route
from backend.app.models.base import Base
from backend.app.models.media import (
    Track,
    TrackArtistCredit,
    TrackIdentity,
)
from backend.app.services.media_identity import (
    sync_track_media_identity,
)


@pytest.mark.asyncio
async def test_admin_diagnostics_uses_catalog_aggregates(
    monkeypatch,
) -> None:
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

    factory = async_sessionmaker(
        engine,
        expire_on_commit=False,
    )

    async with factory() as session:
        tracks = [
            Track(
                id=uuid4(),
                title="One",
                artist="Artist A",
                album="Album A",
                b2_object_key="audio/one.mp3",
                artwork_object_key="art/one.jpg",
                mime_type="audio/mpeg",
                is_published=True,
            ),
            Track(
                id=uuid4(),
                title="Two",
                artist="Artist A",
                album=None,
                b2_object_key="audio/two.mp3",
                artwork_object_key=None,
                mime_type="audio/mpeg",
                is_published=True,
            ),
            Track(
                id=uuid4(),
                title="Three",
                artist="Artist B",
                album="Album B",
                b2_object_key="audio/three.mp3",
                artwork_object_key="art/three.jpg",
                mime_type="audio/mpeg",
                is_published=True,
            ),
            Track(
                id=uuid4(),
                title="Hidden",
                artist="Hidden Artist",
                album="Hidden Album",
                b2_object_key="audio/hidden.mp3",
                artwork_object_key="art/hidden.jpg",
                mime_type="audio/mpeg",
                is_published=False,
            ),
        ]

        session.add_all(
            tracks,
        )

        for track in tracks:
            await sync_track_media_identity(
                session,
                track,
            )

        await session.commit()

        monkeypatch.setattr(
            admin_route,
            "get_b2_bucket",
            lambda:
                type(
                    "Bucket",
                    (),
                    {
                        "name":
                            "test-bucket",
                    },
                )(),
        )

        result = await admin_route.admin_diagnostics(
            user=None,
            session=session,
        )

    assert result["database"]["healthy"] is True
    assert result["storage"]["healthy"] is True

    catalog = result["catalog"]

    assert catalog["healthy"] is True
    assert catalog["track_count"] == 3
    assert catalog["artist_count"] == 2
    assert catalog["album_count"] == 2
    assert catalog["artwork_count"] == 2
    assert catalog["duplicate_groups"] == 0
    assert catalog["identity_backfill_pending"] == 0

    await engine.dispose()
