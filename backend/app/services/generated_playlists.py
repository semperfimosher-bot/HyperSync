from __future__ import annotations

import hashlib
from datetime import (
    UTC,
    datetime,
)

from sqlalchemy import (
    delete,
    func,
    select,
)
from sqlalchemy.exc import (
    IntegrityError,
)
from sqlalchemy.ext.asyncio import (
    AsyncSession,
)

from ..models.account import (
    ListeningEvent,
)
from ..models.media import Track
from ..models.playlist import (
    Playlist,
    PlaylistTrack,
)
from .search import normalize_text

GENERATOR_VERSION = 1

MIN_GENERATED_TRACKS = 0

MAX_GENERATED_TRACKS = 500


def artist_cache_key(
    artist_name: str,
) -> str:
    normalized = normalize_text(
        artist_name,
    )

    digest = hashlib.sha256(
        normalized.encode(
            "utf-8",
        ),
    ).hexdigest()

    return (
        f"artist:{digest}"
    )


async def _find_artist_playlist(
    session: AsyncSession,
    artist_name: str,
) -> Playlist | None:
    key = artist_cache_key(
        artist_name,
    )

    result = await session.execute(
        select(
            Playlist,
        )
        .where(
            Playlist.generated_key
            == key,
            Playlist.visibility
            == "generated",
            Playlist.owner_id.is_(
                None,
            ),
        )
        .limit(
            1,
        )
    )

    return (
        result.scalars()
        .first()
    )


async def get_cached_artist_playlist(
    session: AsyncSession,
    artist_name: str,
) -> Playlist | None:
    playlist = (
        await _find_artist_playlist(
            session,
            artist_name,
        )
    )

    if playlist is None:
        return None

    if (
        playlist.generator_version
        != GENERATOR_VERSION
    ):
        return None

    return playlist


async def _rank_artist_tracks(
    session: AsyncSession,
    artist_name: str,
) -> list[Track]:
    play_counts = (
        select(
            ListeningEvent.track_id.label(
                "track_id",
            ),
            func.count(
                ListeningEvent.id,
            ).label(
                "play_count",
            ),
        )
        .group_by(
            ListeningEvent.track_id,
        )
        .subquery()
    )

    result = await session.execute(
        select(
            Track,
        )
        .outerjoin(
            play_counts,
            play_counts.c.track_id
            == Track.id,
        )
        .where(
            Track.is_published.is_(
                True,
            ),

            # Exact artist, case insensitive.
            Track.artist.ilike(
                artist_name,
            ),
        )
        .order_by(
            func.coalesce(
                play_counts.c.play_count,
                0,
            ).desc(),

            Track.created_at.desc(),

            Track.title.asc(),
        )
        .limit(
            MAX_GENERATED_TRACKS,
        )
    )

    return list(
        result.scalars().all()
    )


async def ensure_artist_playlist(
    session: AsyncSession,
    artist_name: str,
) -> Playlist | None:
    artist_name = (
        artist_name.strip()
    )

    if not artist_name:
        return None

    cached = (
        await get_cached_artist_playlist(
            session,
            artist_name,
        )
    )

    # This is the important fast path.
    #
    # Existing playlist:
    # no generation,
    # no track ranking,
    # no writes.
    if cached is not None:
        return cached

    tracks = (
        await _rank_artist_tracks(
            session,
            artist_name,
        )
    )

    if (
        len(tracks)
        < MIN_GENERATED_TRACKS
    ):
        return None

    key = artist_cache_key(
        artist_name,
    )

    existing = (
        await _find_artist_playlist(
            session,
            artist_name,
        )
    )

    now = datetime.now(
        UTC,
    )

    if existing is None:
        playlist = Playlist(
            owner_id=None,

            title=artist_name,

            description=(
                "Automatically generated "
                "from thecatalog."
            ),

            visibility="generated",

            generated_key=key,

            generated_query=(
                artist_name
            ),

            generated_kind=(
                "artist"
            ),

            generator_version=(
                GENERATOR_VERSION
            ),

            generated_at=now,
        )

        session.add(
            playlist,
        )

        try:
            await session.flush()

        except IntegrityError:
            # Two people searched the same
            # artist at the same time.
            #
            # The unique generated_key means
            # only one playlist can survive.
            await session.rollback()

            return (
                await get_cached_artist_playlist(
                    session,
                    artist_name,
                )
            )

    else:
        playlist = existing

        await session.execute(
            delete(
                PlaylistTrack,
            ).where(
                PlaylistTrack.playlist_id
                == playlist.id,
            )
        )

        playlist.title = (
            f"{artist_name} Essentials"
        )

        playlist.description = (
            "Automatically generated "
            "from the HyperSync catalog."
        )

        playlist.generated_query = (
            artist_name
        )

        playlist.generated_kind = (
            "artist"
        )

        playlist.generator_version = (
            GENERATOR_VERSION
        )

        playlist.generated_at = (
            now
        )

    for (
        position,
        track,
    ) in enumerate(
        tracks,
    ):
        session.add(
            PlaylistTrack(
                playlist_id=(
                    playlist.id
                ),
                track_id=track.id,
                position=position,
            )
        )

    await session.commit()

    await session.refresh(
        playlist,
    )

    return playlist
