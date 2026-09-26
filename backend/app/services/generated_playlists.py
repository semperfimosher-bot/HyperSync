from __future__ import annotations

import hashlib
from datetime import (
    UTC,
    datetime,
)
from uuid import UUID

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

GENERATOR_VERSION = 3

MIN_GENERATED_TRACKS = 2

# Artist-generated playlists should include the full published
# HyperSync catalog for that artist, bounded only to keep a
# single playlist from growing without limit.
MAX_GENERATED_TRACKS = 700

MAX_SMART_GENERATED_TRACKS = 120

SMART_FILLER_WORDS = {
    "a",
    "an",
    "for",
    "me",
    "mix",
    "music",
    "my",
    "playlist",
    "please",
    "some",
    "songs",
    "the",
    "vibe",
    "vibes",
}

GENRE_FAMILIES: dict[
    str,
    tuple[str, ...],
] = {
    "country": (
        "country",
        "americana",
        "bluegrass",
        "western",
    ),
    "hip-hop": (
        "hip hop",
        "hip-hop",
        "rap",
        "trap",
    ),
    "r&b": (
        "r&b",
        "rnb",
        "soul",
        "neo soul",
    ),
    "electronic": (
        "electronic",
        "edm",
        "dance",
        "house",
        "techno",
        "trance",
        "dubstep",
        "downtempo",
        "ambient",
        "lofi",
        "lo-fi",
    ),
    "rock": (
        "rock",
        "alternative",
        "indie",
        "classic rock",
    ),
    "metal": (
        "metal",
        "metalcore",
        "deathcore",
    ),
    "punk": (
        "punk",
        "pop punk",
        "hardcore",
    ),
    "pop": (
        "pop",
        "dance pop",
        "synthpop",
        "dream pop",
        "funk",
        "disco",
    ),
    "latin": (
        "latin",
        "reggaeton",
        "bachata",
        "salsa",
    ),
    "folk": (
        "folk",
        "acoustic",
        "singer-songwriter",
    ),
    "jazz": (
        "jazz",
        "bebop",
    ),
    "classical": (
        "classical",
        "orchestral",
        "instrumental",
    ),
    "gospel": (
        "gospel",
        "christian",
        "worship",
    ),
}

VIBE_FAMILIES: dict[
    str,
    tuple[str, ...],
] = {
    "chill": (
        "r&b",
        "jazz",
        "electronic",
        "folk",
    ),
    "relax": (
        "r&b",
        "jazz",
        "electronic",
        "folk",
        "classical",
    ),
    "relaxed": (
        "r&b",
        "jazz",
        "electronic",
        "folk",
        "classical",
    ),
    "mellow": (
        "r&b",
        "jazz",
        "folk",
    ),
    "calm": (
        "jazz",
        "electronic",
        "folk",
        "classical",
    ),
    "evening": (
        "r&b",
        "jazz",
        "electronic",
        "folk",
    ),
    "night": (
        "r&b",
        "jazz",
        "electronic",
    ),
    "late": (
        "r&b",
        "jazz",
        "electronic",
    ),
    "study": (
        "electronic",
        "jazz",
        "classical",
        "folk",
    ),
    "focus": (
        "electronic",
        "jazz",
        "classical",
        "folk",
    ),
    "sleep": (
        "electronic",
        "classical",
        "folk",
    ),
    "workout": (
        "hip-hop",
        "electronic",
        "rock",
        "metal",
        "pop",
    ),
    "gym": (
        "hip-hop",
        "electronic",
        "rock",
        "metal",
        "pop",
    ),
    "hype": (
        "hip-hop",
        "electronic",
        "rock",
        "pop",
    ),
    "party": (
        "hip-hop",
        "electronic",
        "pop",
        "latin",
    ),
    "driving": (
        "hip-hop",
        "country",
        "rock",
        "pop",
        "electronic",
    ),
    "road": (
        "country",
        "rock",
        "folk",
        "pop",
    ),
    "sad": (
        "r&b",
        "folk",
        "rock",
    ),
    "happy": (
        "pop",
        "electronic",
        "latin",
        "country",
    ),
}


def _normalized_query(
    query: str,
) -> str:
    return normalize_text(
        " ".join(
            str(
                query
                or ""
            ).split()
        )
    )


def _genre_family(
    genre: str | None,
) -> str:
    normalized = normalize_text(
        genre,
    )

    if not normalized:
        return ""

    for (
        family,
        aliases,
    ) in GENRE_FAMILIES.items():
        if any(
            alias in normalized
            for alias in aliases
        ):
            return family

    return normalized


def _requested_genre_families(
    query: str,
) -> set[str]:
    normalized = _normalized_query(
        query,
    )

    requested: set[str] = set()

    for (
        family,
        aliases,
    ) in GENRE_FAMILIES.items():
        if any(
            alias == normalized
            or alias in normalized
            for alias in aliases
        ):
            requested.add(
                family,
            )

    for word in normalized.split():
        requested.update(
            VIBE_FAMILIES.get(
                word,
                (),
            )
        )

    return requested


def _is_direct_genre_query(
    query: str,
) -> bool:
    normalized = _normalized_query(
        query,
    )

    stripped = " ".join(
        word
        for word in normalized.split()
        if word
        not in SMART_FILLER_WORDS
    )

    if not stripped:
        return False

    for aliases in GENRE_FAMILIES.values():
        if stripped in aliases:
            return True

    return False


def is_direct_genre_query(
    query: str,
) -> bool:
    return _is_direct_genre_query(
        query,
    )


def smart_playlist_kind(
    query: str,
) -> str:
    return (
        "genre"
        if _is_direct_genre_query(
            query,
        )
        else "smart"
    )


def smart_query_has_semantic_signal(
    query: str,
) -> bool:
    normalized = _normalized_query(
        query,
    )

    if not normalized:
        return False

    if _is_direct_genre_query(
        normalized,
    ):
        return True

    return any(
        word in VIBE_FAMILIES
        for word
        in normalized.split()
    )


def smart_cache_key(
    user_id: UUID,
    query: str,
) -> str:
    normalized = _normalized_query(
        query,
    )

    digest = hashlib.sha256(
        normalized.encode(
            "utf-8",
        ),
    ).hexdigest()[:40]

    return (
        f"smart:{user_id}:{digest}"
    )


def smart_track_score(
    track: Track,
    query: str,
) -> int:
    normalized_query = (
        _normalized_query(
            query,
        )
    )

    if not normalized_query:
        return 0

    title = normalize_text(
        getattr(
            track,
            "title",
            "",
        )
    )

    artist = normalize_text(
        getattr(
            track,
            "artist",
            "",
        )
    )

    album = normalize_text(
        getattr(
            track,
            "album",
            None,
        )
    )

    genre = normalize_text(
        getattr(
            track,
            "genre",
            None,
        )
    )

    genre_family = (
        _genre_family(
            genre,
        )
    )

    requested_families = (
        _requested_genre_families(
            normalized_query,
        )
    )

    if _is_direct_genre_query(
        normalized_query,
    ):
        if (
            genre
            == normalized_query
        ):
            return 2600

        if (
            normalized_query
            and normalized_query
            in genre
        ):
            return 2350

        if (
            genre_family
            in requested_families
        ):
            return 1900

        return 0

    score = 0

    if (
        genre
        and normalized_query
        == genre
    ):
        score += 1500

    if (
        genre_family
        and genre_family
        in requested_families
    ):
        score += 800

    meaningful_words = [
        word
        for word
        in normalized_query.split()
        if word
        not in SMART_FILLER_WORDS
    ]

    for word in meaningful_words:
        if (
            word in genre
        ):
            score += 320

        if (
            word in title
        ):
            score += 150

        if (
            word in artist
        ):
            score += 110

        if (
            word in album
        ):
            score += 80

    return score


def _smart_playlist_title(
    query: str,
) -> str:
    clean = " ".join(
        str(
            query
            or ""
        ).split()
    )

    return (
        clean[:120]
        or "Smart Playlist"
    )


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


async def _find_smart_playlist(
    session: AsyncSession,
    user_id: UUID,
    query: str,
) -> Playlist | None:
    key = smart_cache_key(
        user_id,
        query,
    )

    result = await session.execute(
        select(
            Playlist,
        )
        .where(
            Playlist.generated_key
            == key,
            Playlist.owner_id
            == user_id,
            Playlist.generated_kind.in_(
                (
                    "smart",
                    "genre",
                )
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


async def generated_playlist_needs_refresh(
    session: AsyncSession,
    playlist: Playlist,
) -> bool:
    if (
        playlist.visibility != "generated"
        or not playlist.generated_query
        or playlist.generated_kind
        not in {
            "artist",
            "smart",
            "genre",
        }
    ):
        return False

    if (
        playlist.generated_kind
        == "artist"
        and playlist.owner_id
        is not None
    ):
        return False

    if (
        playlist.generated_kind
        in {
            "smart",
            "genre",
        }
        and playlist.owner_id
        is None
    ):
        return False

    if (
        playlist.generator_version
        != GENERATOR_VERSION
        or playlist.generated_at
        is None
    ):
        return True

    expected_title = (
        playlist.generated_query.strip()
    )

    if (
        expected_title
        and playlist.title
        != expected_title
    ):
        return True

    if (
        playlist.generated_kind
        in {
            "smart",
            "genre",
        }
    ):
        catalog_result = (
            await session.execute(
                select(
                    func.max(
                        Track.updated_at,
                    )
                ).where(
                    Track.is_published.is_(
                        True,
                    )
                )
            )
        )

        latest_track_update = (
            catalog_result.scalar_one()
        )

        if latest_track_update is None:
            return False

        latest_utc = (
            latest_track_update.replace(
                tzinfo=UTC,
            )
            if latest_track_update.tzinfo
            is None
            else latest_track_update.astimezone(
                UTC,
            )
        )

        generated_utc = (
            playlist.generated_at.replace(
                tzinfo=UTC,
            )
            if playlist.generated_at.tzinfo
            is None
            else playlist.generated_at.astimezone(
                UTC,
            )
        )

        return (
            latest_utc
            > generated_utc
        )

    catalog_result = await session.execute(
        select(
            func.count(
                Track.id,
            ),
            func.max(
                Track.updated_at,
            ),
        ).where(
            Track.is_published.is_(
                True,
            ),
            Track.artist.ilike(
                playlist.generated_query,
            ),
        )
    )

    (
        matching_track_count,
        latest_track_update,
    ) = catalog_result.one()

    playlist_count_result = (
        await session.execute(
            select(
                func.count(
                    PlaylistTrack.id,
                )
            ).where(
                PlaylistTrack.playlist_id
                == playlist.id,
            )
        )
    )

    current_playlist_count = int(
        playlist_count_result.scalar_one()
        or 0
    )

    expected_playlist_count = min(
        int(
            matching_track_count
            or 0
        ),
        MAX_GENERATED_TRACKS,
    )

    if (
        current_playlist_count
        != expected_playlist_count
    ):
        return True

    if latest_track_update is None:
        return False

    latest_utc = (
        latest_track_update.replace(
            tzinfo=UTC,
        )
        if latest_track_update.tzinfo
        is None
        else latest_track_update.astimezone(
            UTC,
        )
    )

    generated_utc = (
        playlist.generated_at.replace(
            tzinfo=UTC,
        )
        if playlist.generated_at.tzinfo
        is None
        else playlist.generated_at.astimezone(
            UTC,
        )
    )

    return latest_utc > generated_utc


async def refresh_generated_playlist_if_stale(
    session: AsyncSession,
    playlist: Playlist,
) -> Playlist:
    if not await generated_playlist_needs_refresh(
        session,
        playlist,
    ):
        return playlist

    if (
        playlist.generated_kind
        == "artist"
    ):
        refreshed = (
            await ensure_artist_playlist(
                session,
                playlist.generated_query
                or playlist.title,
            )
        )

    elif (
        playlist.generated_kind
        in {
            "smart",
            "genre",
        }
        and playlist.owner_id
        is not None
    ):
        refreshed = (
            await ensure_smart_playlist(
                session,
                playlist.owner_id,
                playlist.generated_query
                or playlist.title,
            )
        )

    else:
        refreshed = None

    return refreshed or playlist


async def _rank_smart_tracks(
    session: AsyncSession,
    query: str,
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
            func.coalesce(
                play_counts.c.play_count,
                0,
            ),
        )
        .outerjoin(
            play_counts,
            play_counts.c.track_id
            == Track.id,
        )
        .where(
            Track.is_published.is_(
                True,
            )
        )
    )

    ranked: list[
        tuple[
            int,
            int,
            float,
            Track,
        ]
    ] = []

    for (
        track,
        play_count,
    ) in result.all():
        score = smart_track_score(
            track,
            query,
        )

        if score <= 0:
            continue

        created_at = (
            track.created_at
        )

        created_timestamp = (
            created_at.timestamp()
            if created_at
            is not None
            else 0.0
        )

        ranked.append(
            (
                score,
                int(
                    play_count
                    or 0
                ),
                created_timestamp,
                track,
            )
        )

    ranked.sort(
        key=lambda item: (
            -item[0],
            -item[1],
            -item[2],
            item[3].artist.casefold(),
            item[3].title.casefold(),
        )
    )

    return [
        item[3]
        for item
        in ranked[
            :MAX_SMART_GENERATED_TRACKS
        ]
    ]


async def ensure_smart_playlist(
    session: AsyncSession,
    user_id: UUID,
    query: str,
    *,
    force_refresh: bool = False,
) -> Playlist | None:
    query = " ".join(
        str(
            query
            or ""
        ).split()
    )

    if not query:
        return None

    existing = (
        await _find_smart_playlist(
            session,
            user_id,
            query,
        )
    )

    if (
        existing is not None
        and not force_refresh
        and not await generated_playlist_needs_refresh(
            session,
            existing,
        )
    ):
        return existing

    tracks = await _rank_smart_tracks(
        session,
        query,
    )

    now = datetime.now(
        UTC,
    )

    kind = smart_playlist_kind(
        query,
    )

    if existing is None:
        playlist = Playlist(
            owner_id=user_id,
            title=_smart_playlist_title(
                query,
            ),
            description=(
                "Live playlist generated from "
                f'"{query}". New matching uploads '
                "are added automatically."
            ),
            visibility="generated",
            generated_key=smart_cache_key(
                user_id,
                query,
            ),
            generated_query=query,
            generated_kind=kind,
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
            await session.rollback()

            return (
                await _find_smart_playlist(
                    session,
                    user_id,
                    query,
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
            _smart_playlist_title(
                query,
            )
        )

        playlist.description = (
            "Live playlist generated from "
            f'"{query}". New matching uploads '
            "are added automatically."
        )

        playlist.visibility = (
            "generated"
        )

        playlist.generated_query = (
            query
        )

        playlist.generated_kind = (
            kind
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
                track_id=(
                    track.id
                ),
                position=(
                    position
                ),
            )
        )

    await session.commit()

    await session.refresh(
        playlist,
    )

    return playlist


async def refresh_smart_playlists_for_track(
    session: AsyncSession,
    track: Track,
) -> int:
    result = await session.execute(
        select(
            Playlist.owner_id,
            Playlist.generated_query,
        ).where(
            Playlist.owner_id.is_not(
                None,
            ),
            Playlist.visibility
            == "generated",
            Playlist.generated_kind.in_(
                (
                    "smart",
                    "genre",
                )
            ),
            Playlist.generated_query.is_not(
                None,
            ),
        )
    )

    refresh_targets = [
        (
            owner_id,
            str(
                query,
            ),
        )
        for (
            owner_id,
            query,
        ) in result.all()
        if (
            owner_id
            is not None
            and query
            and smart_track_score(
                track,
                str(
                    query,
                ),
            )
            > 0
        )
    ]

    refreshed = 0

    for (
        owner_id,
        query,
    ) in refresh_targets:
        playlist = await ensure_smart_playlist(
            session,
            owner_id,
            query,
            force_refresh=True,
        )

        if playlist is not None:
            refreshed += 1

    return refreshed


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

    # Keep the generated playlist fast when
    # the matching catalog has not changed,
    # but regenerate it when newer music for
    # the same artist appears.
    if (
        cached is not None
        and not await generated_playlist_needs_refresh(
            session,
            cached,
        )
    ):
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
                "from the catalog."
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
            artist_name
        )

        playlist.description = (
            "Automatically generated "
            "from the HyperSynced catalog."
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
