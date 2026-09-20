from __future__ import annotations

from collections import defaultdict
from datetime import (
    UTC,
    datetime,
)
from math import log1p
from uuid import UUID

from sqlalchemy import (
    func,
    or_,
    select,
)
from sqlalchemy.ext.asyncio import (
    AsyncSession,
)

from ..models.account import (
    ListeningEvent,
)
from ..models.media import Track

HISTORY_LIMIT = 250

AFFINITY_POOL_LIMIT = 300

POPULAR_POOL_LIMIT = 250

NEW_POOL_LIMIT = 120

RECENT_GENRE_WINDOW = 40


def _text_key(
    value: str | None,
) -> str:
    return (
        str(value or "")
        .strip()
        .casefold()
    )


async def recommend_autoplay_tracks(
    session: AsyncSession,
    *,
    user_id: UUID | None,
    current_track_id: UUID | None,
    exclude_track_ids: set[UUID],
    limit: int,
) -> list[Track]:
    excluded = {
        track_id
        for track_id
        in exclude_track_ids
        if track_id is not None
    }

    if current_track_id:
        excluded.add(
            current_track_id,
        )


    current_track = None

    if current_track_id:
        current_track = (
            await session.get(
                Track,
                current_track_id,
            )
        )


    current_artist = (
        _text_key(
            current_track.artist,
        )
        if current_track
        else ""
    )

    current_album = (
        _text_key(
            current_track.album,
        )
        if current_track
        else ""
    )

    current_genre = (
        _text_key(
            current_track.genre,
        )
        if current_track
        else ""
    )


    artist_affinity: dict[
        str,
        float,
    ] = defaultdict(
        float,
    )

    album_affinity: dict[
        str,
        float,
    ] = defaultdict(
        float,
    )

    genre_affinity: dict[
        str,
        float,
    ] = defaultdict(
        float,
    )

    recent_genre_momentum: dict[
        str,
        float,
    ] = defaultdict(
        float,
    )

    track_affinity: dict[
        UUID,
        float,
    ] = defaultdict(
        float,
    )


    artist_names: dict[
        str,
        str,
    ] = {}

    genre_names: dict[
        str,
        str,
    ] = {}


    recent_rank: dict[
        UUID,
        int,
    ] = {}

    history_counts: dict[
        UUID,
        int,
    ] = defaultdict(
        int,
    )


    track_skips: dict[
        UUID,
        int,
    ] = defaultdict(
        int,
    )

    track_completions: dict[
        UUID,
        int,
    ] = defaultdict(
        int,
    )


    genre_skips: dict[
        str,
        int,
    ] = defaultdict(
        int,
    )

    genre_completions: dict[
        str,
        int,
    ] = defaultdict(
        int,
    )


    if user_id is not None:
        history_result = (
            await session.execute(
                select(
                    ListeningEvent.track_id,
                    ListeningEvent.listened_at,
                    ListeningEvent.completed,
                    ListeningEvent.skipped,
                    ListeningEvent.completion_ratio,
                    Track.artist,
                    Track.album,
                    Track.genre,
                )
                .join(
                    Track,
                    Track.id
                    == ListeningEvent.track_id,
                )
                .where(
                    ListeningEvent.user_id
                    == user_id,

                    Track.is_published.is_(
                        True,
                    ),
                )
                .order_by(
                    ListeningEvent.listened_at.desc(),
                )
                .limit(
                    HISTORY_LIMIT,
                )
            )
        )


        history_rows = (
            history_result.all()
        )


        for (
            rank,
            row,
        ) in enumerate(
            history_rows,
        ):
            (
                track_id,
                _listened_at,
                completed,
                skipped,
                completion_ratio,
                artist,
                album,
                genre,
            ) = row


            recency_weight = (
                1.0
                /
                (
                    1.0
                    +
                    rank * 0.05
                )
            )


            recent_window_weight = max(
                0.0,
                1.0
                -
                (
                    rank
                    /
                    RECENT_GENRE_WINDOW
                ),
            )


            ratio = (
                float(
                    completion_ratio,
                )
                if completion_ratio
                is not None
                else None
            )


            if skipped:
                quality = -3.2

                track_skips[
                    track_id
                ] += 1


            elif completed:
                quality = 3.0

                track_completions[
                    track_id
                ] += 1


            elif ratio is None:
                # Old listening events and
                # currently active events
                # should count as weak signals,
                # not proof that the user liked
                # the song.
                quality = 0.15


            elif ratio >= 0.85:
                quality = 2.0


            elif ratio >= 0.55:
                quality = 0.8


            elif ratio < 0.20:
                quality = -0.6


            else:
                quality = 0.1


            artist_key = (
                _text_key(
                    artist,
                )
            )

            album_key = (
                _text_key(
                    album,
                )
            )

            genre_key = (
                _text_key(
                    genre,
                )
            )


            if artist_key:
                artist_affinity[
                    artist_key
                ] += (
                    quality
                    *
                    recency_weight
                    *
                    2.7
                )

                artist_names[
                    artist_key
                ] = artist


            if album_key:
                album_affinity[
                    album_key
                ] += (
                    quality
                    *
                    recency_weight
                    *
                    1.3
                )


            if genre_key:
                genre_affinity[
                    genre_key
                ] += (
                    quality
                    *
                    recency_weight
                    *
                    3.8
                )


                recent_genre_momentum[
                    genre_key
                ] += (
                    quality
                    *
                    recent_window_weight
                    *
                    4.5
                )


                genre_names[
                    genre_key
                ] = genre


                if skipped:
                    genre_skips[
                        genre_key
                    ] += 1


                if completed:
                    genre_completions[
                        genre_key
                    ] += 1


            track_affinity[
                track_id
            ] += (
                quality
                *
                recency_weight
                *
                2.0
            )


            history_counts[
                track_id
            ] += 1


            recent_rank.setdefault(
                track_id,
                rank,
            )


    preferred_artist_keys = sorted(
        artist_affinity,
        key=lambda key:
            artist_affinity[key],
        reverse=True,
    )[:8]


    preferred_artists = [
        artist_names[key]
        for key
        in preferred_artist_keys
        if (
            key in artist_names
            and artist_affinity[
                key
            ] > 0
        )
    ]


    preferred_genre_keys = sorted(
        genre_affinity,
        key=lambda key: (
            genre_affinity[key]
            +
            recent_genre_momentum.get(
                key,
                0.0,
            )
        ),
        reverse=True,
    )[:6]


    preferred_genres = [
        genre_names[key]
        for key
        in preferred_genre_keys
        if (
            key in genre_names
            and (
                genre_affinity[key]
                +
                recent_genre_momentum.get(
                    key,
                    0.0,
                )
            ) > 0
        )
    ]


    candidate_by_id: dict[
        UUID,
        Track,
    ] = {}


    def candidate_statement():
        stmt = (
            select(
                Track,
            )
            .where(
                Track.is_published.is_(
                    True,
                ),
            )
        )


        if excluded:
            stmt = stmt.where(
                Track.id.not_in(
                    excluded,
                )
            )


        return stmt


    affinity_terms = []


    artist_candidates = list(
        preferred_artists,
    )

    genre_candidates = list(
        preferred_genres,
    )


    if (
        current_track
        and current_track.artist
        and current_track.artist
        not in artist_candidates
    ):
        artist_candidates.append(
            current_track.artist,
        )


    if (
        current_track
        and current_track.genre
        and current_track.genre
        not in genre_candidates
    ):
        genre_candidates.append(
            current_track.genre,
        )


    if artist_candidates:
        affinity_terms.append(
            Track.artist.in_(
                artist_candidates,
            )
        )


    if genre_candidates:
        affinity_terms.append(
            Track.genre.in_(
                genre_candidates,
            )
        )


    if affinity_terms:
        affinity_result = (
            await session.execute(
                candidate_statement()
                .where(
                    or_(
                        *affinity_terms,
                    )
                )
                .order_by(
                    Track.created_at.desc(),
                )
                .limit(
                    AFFINITY_POOL_LIMIT,
                )
            )
        )


        for track in (
            affinity_result
            .scalars()
            .all()
        ):
            candidate_by_id[
                track.id
            ] = track


    # Global popularity is only a
    # fallback signal.
    global_counts = (
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


    popular_result = (
        await session.execute(
            candidate_statement()
            .outerjoin(
                global_counts,
                global_counts.c.track_id
                == Track.id,
            )
            .order_by(
                func.coalesce(
                    global_counts.c.play_count,
                    0,
                ).desc(),

                Track.created_at.desc(),
            )
            .limit(
                POPULAR_POOL_LIMIT,
            )
        )
    )


    for track in (
        popular_result
        .scalars()
        .all()
    ):
        candidate_by_id[
            track.id
        ] = track


    # Keep new catalog material
    # eligible for discovery.
    new_result = (
        await session.execute(
            candidate_statement()
            .order_by(
                Track.created_at.desc(),
            )
            .limit(
                NEW_POOL_LIMIT,
            )
        )
    )


    for track in (
        new_result
        .scalars()
        .all()
    ):
        candidate_by_id[
            track.id
        ] = track


    candidates = list(
        candidate_by_id.values()
    )


    if not candidates:
        return []


    candidate_ids = [
        track.id
        for track in candidates
    ]


    count_result = (
        await session.execute(
            select(
                ListeningEvent.track_id,

                func.count(
                    ListeningEvent.id,
                ),
            )
            .where(
                ListeningEvent.track_id.in_(
                    candidate_ids,
                )
            )
            .group_by(
                ListeningEvent.track_id,
            )
        )
    )


    play_counts = {
        track_id:
            int(
                count,
            )
        for (
            track_id,
            count,
        )
        in count_result.all()
    }


    now = datetime.now(
        UTC,
    )


    scored: list[
        tuple[
            float,
            Track,
        ]
    ] = []


    for track in candidates:
        artist_key = (
            _text_key(
                track.artist,
            )
        )

        album_key = (
            _text_key(
                track.album,
            )
        )

        genre_key = (
            _text_key(
                track.genre,
            )
        )


        score = 0.0


        # ==================================================
        # PERSONAL TASTE
        # ==================================================

        # Genre is deliberately the
        # strongest long-term signal.
        score += (
            genre_affinity.get(
                genre_key,
                0.0,
            )
            *
            4.8
        )


        # This makes autoplay react to
        # what the user has been listening
        # to lately.
        score += (
            recent_genre_momentum.get(
                genre_key,
                0.0,
            )
            *
            3.5
        )


        score += (
            artist_affinity.get(
                artist_key,
                0.0,
            )
            *
            3.0
        )


        score += (
            album_affinity.get(
                album_key,
                0.0,
            )
            *
            1.4
        )


        score += (
            track_affinity.get(
                track.id,
                0.0,
            )
            *
            1.5
        )


        # ==================================================
        # CURRENT VIBE
        # ==================================================

        # Current-track genre is an
        # extremely strong short-term
        # signal.
        if (
            current_genre
            and genre_key
            == current_genre
        ):
            score += 10.0


        if (
            current_artist
            and artist_key
            == current_artist
        ):
            score += 3.5


        if (
            current_album
            and album_key
            == current_album
        ):
            score += 1.5


        # ==================================================
        # SKIPS / COMPLETIONS
        # ==================================================

        skip_count = (
            track_skips.get(
                track.id,
                0,
            )
        )


        completion_count = (
            track_completions.get(
                track.id,
                0,
            )
        )


        # A repeatedly skipped song should
        # disappear quickly from autoplay.
        score -= min(
            skip_count
            *
            7.0,
            35.0,
        )


        # Songs repeatedly completed by
        # the user get a positive signal.
        score += min(
            completion_count
            *
            2.0,
            12.0,
        )


        if genre_key:
            # If the user has recently
            # skipped several songs from a
            # genre, cool that genre down.
            score -= min(
                genre_skips.get(
                    genre_key,
                    0,
                )
                *
                0.55,
                10.0,
            )


            # Conversely, lots of completed
            # tracks in a genre strengthen
            # that vibe.
            score += min(
                genre_completions.get(
                    genre_key,
                    0,
                )
                *
                0.25,
                5.0,
            )


        # ==================================================
        # GLOBAL / DISCOVERY SIGNALS
        # ==================================================

        # Popularity helps mainly when
        # personal history is sparse.
        score += (
            log1p(
                play_counts.get(
                    track.id,
                    0,
                )
            )
            *
            0.70
        )


        # Small new-release bonus.
        created_at = (
            track.created_at
        )


        if created_at:
            if (
                created_at.tzinfo
                is None
            ):
                created_at = (
                    created_at.replace(
                        tzinfo=UTC,
                    )
                )


            age_days = max(
                (
                    now
                    -
                    created_at
                ).days,
                0,
            )


            score += max(
                0.0,
                1.5
                -
                (
                    age_days
                    /
                    180.0
                ),
            )


        # ==================================================
        # REPETITION / FATIGUE
        # ==================================================

        rank = recent_rank.get(
            track.id,
        )


        # Don't immediately replay songs
        # the user just heard, even if the
        # user normally likes them.
        if rank is not None:
            if rank < 6:
                score -= 120.0

            elif rank < 20:
                score -= 18.0

            elif rank < 50:
                score -= 5.0


        # Mild fatigue penalty for songs
        # already played many times.
        score -= min(
            history_counts.get(
                track.id,
                0,
            ),
            12,
        ) * 0.20


        scored.append(
            (
                score,
                track,
            )
        )


    scored.sort(
        key=lambda item: (
            -item[0],
            item[1].artist.casefold(),
            item[1].title.casefold(),
        )
    )


    selected: list[
        Track,
    ] = []


    deferred: list[
        Track,
    ] = []


    last_artist = ""

    artist_streak = 0


    # Keep the genre/vibe cohesive, but
    # avoid filling the entire queue with
    # one artist.
    for (
        _score,
        track,
    ) in scored:
        artist_key = (
            _text_key(
                track.artist,
            )
        )


        if (
            artist_key
            == last_artist
            and artist_streak >= 2
        ):
            deferred.append(
                track,
            )

            continue


        selected.append(
            track,
        )


        if (
            artist_key
            == last_artist
        ):
            artist_streak += 1

        else:
            last_artist = (
                artist_key
            )

            artist_streak = 1


        if (
            len(selected)
            >= limit
        ):
            return selected


    # If the catalog is small, relax the
    # same-artist restriction rather than
    # letting autoplay run out of music.
    for track in deferred:
        selected.append(
            track,
        )


        if (
            len(selected)
            >= limit
        ):
            break


    return selected
