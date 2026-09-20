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

AFFINITY_POOL_LIMIT = 250

POPULAR_POOL_LIMIT = 250

NEW_POOL_LIMIT = 100


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

    artist_names: dict[
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


    if user_id is not None:
        history_result = (
            await session.execute(
                select(
                    ListeningEvent.track_id,
                    ListeningEvent.listened_at,
                    Track.artist,
                    Track.album,
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
                artist,
                album,
            ) = row

            recency_weight = (
                1.0 /
                (
                    1.0 +
                    rank *
                    0.06
                )
            )

            artist_key = (
                _text_key(
                    artist,
                )
            )

            if artist_key:
                artist_affinity[
                    artist_key
                ] += (
                    3.0 *
                    recency_weight
                )

                artist_names[
                    artist_key
                ] = artist

            album_key = (
                _text_key(
                    album,
                )
            )

            if album_key:
                album_affinity[
                    album_key
                ] += (
                    1.6 *
                    recency_weight
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
        if key in artist_names
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


    # Songs from artists the user
    # actually listens to.
    if preferred_artists:
        affinity_result = (
            await session.execute(
                candidate_statement()
                .where(
                    Track.artist.in_(
                        preferred_artists,
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
            affinity_result.scalars()
            .all()
        ):
            candidate_by_id[
                track.id
            ] = track


    # Globally popular fallback.
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
        popular_result.scalars()
        .all()
    ):
        candidate_by_id[
            track.id
        ] = track


    # Keep newer catalog material
    # eligible too.
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
        new_result.scalars()
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
            int(count)
        for (
            track_id,
            count,
        )
        in count_result.all()
    }


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


        score = 0.0


        # Main personalized signals.
        score += (
            artist_affinity.get(
                artist_key,
                0.0,
            )
            * 4.0
        )

        score += (
            album_affinity.get(
                album_key,
                0.0,
            )
            * 2.0
        )


        # Continue the vibe of the
        # currently playing song.
        if (
            current_artist
            and artist_key
            == current_artist
        ):
            score += 4.0

        if (
            current_album
            and album_key
            == current_album
        ):
            score += 2.0


        # Popularity helps when personal
        # history is sparse.
        score += (
            log1p(
                play_counts.get(
                    track.id,
                    0,
                )
            )
            * 0.75
        )


        # Small discovery/new-release
        # bonus.
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
                    now -
                    created_at
                ).days,
                0,
            )

            score += max(
                0.0,
                1.5 -
                (
                    age_days /
                    180.0
                ),
            )


        # Do not immediately replay
        # something the user just heard.
        rank = recent_rank.get(
            track.id,
        )

        if rank is not None:
            if rank < 8:
                score -= 100.0

            elif rank < 30:
                score -= 12.0

            elif rank < 60:
                score -= 3.0


        # Slight penalty for tracks
        # already played many times.
        score -= min(
            history_counts.get(
                track.id,
                0,
            ),
            10,
        ) * 0.25


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


    # Diversity pass:
    # never more than two tracks by
    # the same artist consecutively.
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


    # If the catalog is small, relax
    # the diversity restriction instead
    # of returning an empty queue.
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
