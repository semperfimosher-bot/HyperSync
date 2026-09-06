from __future__ import annotations

import re
from collections import OrderedDict
from datetime import (
    UTC,
    datetime,
    timedelta,
)
from time import perf_counter
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query
from pydantic import BaseModel
from sqlalchemy import (
    func,
    literal,
    or_,
    select,
)
from sqlalchemy.ext.asyncio import (
    AsyncSession,
)
from sqlalchemy.orm import (
    selectinload,
)

from ...models.account import (
    ListeningEvent,
    User,
    UserAppState,
    UserFollow,
    UserProfile,
)
from ...models.media import Track
from ...services.search import (
    SEARCH_SORT_MODES,
    MatchResult,
    ParsedSearch,
    SearchSortMode,
    extract_featured_artists,
    normalize_sort_mode,
    normalize_text,
    parse_search_query,
    score_album,
    score_artist,
    score_person,
    score_track,
    sort_track_rows,
)
from ..dependencies import (
    CurrentUser,
    DatabaseSession,
    OptionalCurrentUser,
)
from .catalog import (
    _track_artwork_url,
    _track_audio_url,
)
from .users import avatar_url

router = APIRouter(
    prefix="/search",
    tags=["search"],
)


TRACK_CANDIDATE_LIMIT = 80
TRACK_RESULT_LIMIT = 40

PEOPLE_CANDIDATE_LIMIT = 40
PEOPLE_RESULT_LIMIT = 20

HISTORY_COMMAND_LIMIT = 100

TOP_ENTITY_LIMIT = 20

NEW_RELEASE_LIMIT = 100
NEW_RELEASE_WINDOW_DAYS = 14


class SearchPreferenceResponse(
    BaseModel,
):
    sort_mode: SearchSortMode


class SearchPreferenceUpdate(
    BaseModel,
):
    sort_mode: SearchSortMode


class SearchTrackResult(
    BaseModel,
):
    id: UUID
    title: str
    artist: str
    album: str | None

    duration_seconds: int | None

    audio_url: str | None = None
    artwork_url: str | None = None

    match_label: str
    matched_field: str

    user_play_count: int = 0
    global_play_count: int = 0

    last_played_at: datetime | None = None


class SearchArtistResult(
    BaseModel,
):
    name: str
    track_count: int

    artwork_url: str | None = None

    match_label: str


class SearchAlbumResult(
    BaseModel,
):
    title: str
    artist: str
    track_count: int

    artwork_url: str | None = None

    match_label: str


class SearchPersonResult(
    BaseModel,
):
    username: str
    display_name: str

    avatar_url: str | None = None

    followers_count: int
    member_since: datetime

    match_label: str


class SearchCounts(
    BaseModel,
):
    tracks: int
    artists: int
    collaborations: int
    albums: int
    people: int


class SearchResponse(
    BaseModel,
):
    query: str
    interpreted_query: str
    intent: str

    sort_mode: SearchSortMode

    processing_ms: int

    counts: SearchCounts

    tracks: list[SearchTrackResult]

    artists: list[SearchArtistResult]

    collaborations: list[
        SearchArtistResult
    ]

    albums: list[SearchAlbumResult]

    people: list[SearchPersonResult]


async def _saved_sort_mode(
    session: AsyncSession,
    user: User | None,
) -> SearchSortMode:
    if user is None:
        return "smart"

    state = await session.get(
        UserAppState,
        user.id,
    )

    if state is None:
        return "smart"

    return normalize_sort_mode(
        state.search_sort_mode,
    )


async def _load_history_track_ids(
    session: AsyncSession,
    user: User,
    intent: str,
) -> list[UUID]:
    if intent == "my_most_played":
        ordering = (
            func.count(
                ListeningEvent.id,
            ).desc()
        )

    else:
        ordering = (
            func.max(
                ListeningEvent.listened_at,
            ).desc()
        )

    result = await session.execute(
        select(
            ListeningEvent.track_id,
        )
        .where(
            ListeningEvent.user_id
            == user.id,
        )
        .group_by(
            ListeningEvent.track_id,
        )
        .order_by(
            ordering,
        )
        .limit(
            HISTORY_COMMAND_LIMIT,
        )
    )

    return list(
        result.scalars().all()
    )


def _is_postgresql(
    session: AsyncSession,
) -> bool:
    bind = session.get_bind()

    return (
        bind.dialect.name
        == "postgresql"
    )

def _new_release_cutoff(
    now: datetime | None = None,
) -> datetime:
    reference = (
        now
        if now is not None
        else datetime.now(
            UTC,
        )
    )

    if (
        reference.tzinfo
        is None
    ):
        reference = (
            reference.replace(
                tzinfo=UTC,
            )
        )

    return (
        reference
        - timedelta(
            days=(
                NEW_RELEASE_WINDOW_DAYS
            ),
        )
    )

async def _load_track_candidates(
    session: AsyncSession,
    parsed: ParsedSearch,
    user: User | None,
) -> list[Track]:
    if parsed.intent == "people":
        return []

    if (
        parsed.intent
        == "new_releases"
        and not parsed.term
    ):
        cutoff = (
            _new_release_cutoff()
        )

        result = await session.execute(
            select(
                Track,
            )
            .where(
                Track.is_published.is_(
                    True,
                ),
                Track.created_at
                >= cutoff,
            )
            .order_by(
                Track.created_at.desc(),
                Track.title.asc(),
            )
            .limit(
                NEW_RELEASE_LIMIT,
            )
        )

        return list(
            result.scalars().all()
        )

    if (
        parsed.intent
        in {
            "my_most_played",
            "recent",
        }
        and not parsed.term
    ):
        if user is None:
            return []

        track_ids = (
            await _load_history_track_ids(
                session,
                user,
                parsed.intent,
            )
        )

        if not track_ids:
            return []

        result = await session.execute(
            select(
                Track,
            ).where(
                Track.id.in_(
                    track_ids,
                ),
                Track.is_published.is_(
                    True,
                ),
            )
        )

        by_id = {
            track.id: track
            for track
            in result.scalars().all()
        }

        return [
            by_id[track_id]
            for track_id in track_ids
            if track_id in by_id
        ]

    term = parsed.term.strip()

    if not term:
        return []

    prefix_pattern = (
        f"{term}%"
    )

    contains_pattern = (
        f"%{term}%"
    )

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

    fields = (
        (
            Track.artist,
        )
        if parsed.field_hint
        == "artist"
        else (
            Track.title,
            Track.artist,
            Track.album,
        )
    )

    if (
        _is_postgresql(
            session,
        )
        and len(term) >= 3
    ):
        query_literal = literal(
            term,
        )

        candidate_conditions = []
        similarity_scores = []

        for field in fields:
            candidate_conditions.extend(
                [
                    field.ilike(
                        contains_pattern,
                    ),
                    field.op("%")(
                        query_literal,
                    ),
                ]
            )

            similarity_scores.append(
                func.coalesce(
                    func.similarity(
                        field,
                        query_literal,
                    ),
                    0.0,
                )
            )

        if (
            len(
                similarity_scores,
            )
            == 1
        ):
            best_similarity = (
                similarity_scores[0]
            )

        else:
            best_similarity = (
                func.greatest(
                    *similarity_scores,
                )
            )

        result = await session.execute(
            stmt.where(
                or_(
                    *candidate_conditions,
                )
            )
            .order_by(
                best_similarity.desc(),
                Track.artist.asc(),
                Track.title.asc(),
            )
            .limit(
                TRACK_CANDIDATE_LIMIT,
            )
        )

        return list(
            result.scalars().all()
        )

    direct_pattern = (
        prefix_pattern
        if len(term) == 1
        else contains_pattern
    )

    direct_conditions = [
        field.ilike(
            direct_pattern,
        )
        for field in fields
    ]

    result = await session.execute(
        stmt.where(
            or_(
                *direct_conditions,
            )
        )
        .order_by(
            Track.artist.asc(),
            Track.title.asc(),
        )
        .limit(
            TRACK_CANDIDATE_LIMIT,
        )
    )

    direct = list(
        result.scalars().all()
    )

    if direct:
        return direct

    if (
        len(term) < 3
        or _is_postgresql(
            session,
        )
    ):
        return []

    fuzzy_result = (
        await session.execute(
            select(
                Track,
            )
            .where(
                Track.is_published.is_(
                    True,
                )
            )
            .order_by(
                Track.created_at.desc(),
            )
            .limit(
                TRACK_CANDIDATE_LIMIT,
            )
        )
    )

    return list(
        fuzzy_result.scalars().all()
    )


async def _global_play_counts(
    session: AsyncSession,
    track_ids: list[UUID],
) -> dict[UUID, int]:
    if not track_ids:
        return {}

    result = await session.execute(
        select(
            ListeningEvent.track_id,
            func.count(
                ListeningEvent.id,
            ),
        )
        .where(
            ListeningEvent.track_id.in_(
                track_ids,
            )
        )
        .group_by(
            ListeningEvent.track_id,
        )
    )

    return {
        track_id: int(
            count,
        )
        for (
            track_id,
            count,
        ) in result.all()
    }


async def _user_history(
    session: AsyncSession,
    user: User | None,
    track_ids: list[UUID],
) -> dict[
    UUID,
    tuple[
        int,
        datetime | None,
    ],
]:
    if (
        user is None
        or not track_ids
    ):
        return {}

    result = await session.execute(
        select(
            ListeningEvent.track_id,
            func.count(
                ListeningEvent.id,
            ),
            func.max(
                ListeningEvent.listened_at,
            ),
        )
        .where(
            ListeningEvent.user_id
            == user.id,
            ListeningEvent.track_id.in_(
                track_ids,
            ),
        )
        .group_by(
            ListeningEvent.track_id,
        )
    )

    return {
        track_id: (
            int(
                play_count,
            ),
            last_played_at,
        )
        for (
            track_id,
            play_count,
            last_played_at,
        ) in result.all()
    }


def _match_for_track(
    track: Track,
    parsed: ParsedSearch,
) -> MatchResult:
    if (
        parsed.intent
        == "new_releases"
    ):
        return MatchResult(
            score=1,
            tier=1,
            label="NEW RELEASE",
            field="created_at",
        )

    return score_track(
        track.title,
        track.artist,
        track.album,
        parsed,
    )


async def _build_track_rows(
    session: AsyncSession,
    parsed: ParsedSearch,
    user: User | None,
    sort_mode: SearchSortMode,
) -> list[dict]:
    candidates = (
        await _load_track_candidates(
            session,
            parsed,
            user,
        )
    )

    if not candidates:
        return []

    track_ids = [
        track.id
        for track in candidates
    ]

    global_counts = (
        await _global_play_counts(
            session,
            track_ids,
        )
    )

    user_history = (
        await _user_history(
            session,
            user,
            track_ids,
        )
    )

    rows: list[dict] = []

    for track in candidates:
        match = _match_for_track(
            track,
            parsed,
        )

        if (
            parsed.term
            and match.score <= 0
        ):
            continue

        (
            user_play_count,
            last_played_at,
        ) = user_history.get(
            track.id,
            (
                0,
                None,
            ),
        )

        rows.append(
            {
                "track": track,
                "title": (
                    track.title
                ),
                "artist": (
                    track.artist
                ),
                "created_at": (
                    track.created_at
                ),
                "match_score": (
                    match.score
                ),
                "match_tier": (
                    match.tier
                ),
                "match_label": (
                    match.label
                ),
                "matched_field": (
                    match.field
                ),
                "user_play_count": (
                    user_play_count
                ),
                "global_play_count": (
                    global_counts.get(
                        track.id,
                        0,
                    )
                ),
                "last_played_at": (
                    last_played_at
                ),
            }
        )

    sorted_rows = sort_track_rows(
        rows,
        sort_mode,
        parsed.intent,
    )

    return sorted_rows[
        :TRACK_RESULT_LIMIT
    ]


async def _search_people(
    session: AsyncSession,
    parsed: ParsedSearch,
) -> list[
    SearchPersonResult
]:
    if (
        parsed.intent
        not in {
            "general",
            "people",
        }
    ):
        return []

    follower_counts = (
        select(
            UserFollow.following_id.label(
                "user_id",
            ),
            func.count(
                UserFollow.follower_id,
            ).label(
                "followers_count",
            ),
        )
        .where(
            UserFollow.accepted_at.is_not(
                None,
            )
        )
        .group_by(
            UserFollow.following_id,
        )
        .subquery()
    )

    term = parsed.term.strip()

    prefix_pattern = (
        f"{term}%"
    )

    contains_pattern = (
        f"%{term}%"
    )

    base_stmt = (
        select(
            User,
            func.coalesce(
                follower_counts.c.followers_count,
                0,
            ),
        )
        .outerjoin(
            UserProfile,
            UserProfile.user_id
            == User.id,
        )
        .outerjoin(
            follower_counts,
            follower_counts.c.user_id
            == User.id,
        )
        .options(
            selectinload(
                User.profile,
            )
        )
        .where(
            User.is_active.is_(
                True,
            ),
            User.username.is_not(
                None,
            ),
        )
    )

    if (
        parsed.intent == "people"
        and not parsed.term
    ):
        result = await session.execute(
            base_stmt.order_by(
                func.lower(
                    User.username,
                ).asc(),
                User.username.asc(),
            )
        )

        directory: list[
            SearchPersonResult
        ] = []

        for (
            found_user,
            follower_count,
        ) in result.all():
            username = (
                found_user.username
                or ""
            )

            profile = (
                found_user.profile
            )

            display_name = (
                profile.display_name
                if (
                    profile is not None
                    and profile.display_name
                )
                else username
                or "User"
            )

            directory.append(
                SearchPersonResult(
                    username=username,
                    display_name=(
                        display_name
                    ),
                    avatar_url=(
                        avatar_url(
                            found_user,
                        )
                    ),
                    followers_count=int(
                        follower_count,
                    ),
                    member_since=(
                        found_user.created_at
                    ),
                    match_label=(
                        "DIRECTORY"
                    ),
                )
            )

        directory.sort(
            key=lambda person: (
                person.username.casefold(),
                person.username,
            )
        )

        return directory

    if not parsed.term:
        return []

    fields = (
        User.username,
        User.username_normalized,
        UserProfile.display_name,
    )

    if (
        _is_postgresql(
            session,
        )
        and len(term) >= 3
    ):
        query_literal = literal(
            term,
        )

        candidate_conditions = []
        similarity_scores = []

        for field in fields:
            candidate_conditions.extend(
                [
                    field.ilike(
                        contains_pattern,
                    ),
                    field.op("%")(
                        query_literal,
                    ),
                ]
            )

            similarity_scores.append(
                func.coalesce(
                    func.similarity(
                        field,
                        query_literal,
                    ),
                    0.0,
                )
            )

        best_similarity = (
            func.greatest(
                *similarity_scores,
            )
        )

        result = await session.execute(
            base_stmt.where(
                or_(
                    *candidate_conditions,
                )
            )
            .order_by(
                best_similarity.desc(),
                User.username.asc(),
            )
            .limit(
                PEOPLE_CANDIDATE_LIMIT,
            )
        )

        rows = result.all()

    else:
        direct_pattern = (
            prefix_pattern
            if len(term) == 1
            else contains_pattern
        )

        direct_conditions = [
            field.ilike(
                direct_pattern,
            )
            for field in fields
        ]

        result = await session.execute(
            base_stmt.where(
                or_(
                    *direct_conditions,
                )
            )
            .order_by(
                User.username.asc(),
            )
            .limit(
                PEOPLE_CANDIDATE_LIMIT,
            )
        )

        rows = result.all()

        if (
            not rows
            and len(term) >= 3
            and not _is_postgresql(
                session,
            )
        ):
            fuzzy_result = (
                await session.execute(
                    base_stmt
                    .order_by(
                        User.created_at.desc(),
                    )
                    .limit(
                        PEOPLE_CANDIDATE_LIMIT,
                    )
                )
            )

            rows = (
                fuzzy_result.all()
            )

    scored: list[
        tuple[
            int,
            int,
            SearchPersonResult,
        ]
    ] = []

    for (
        found_user,
        follower_count,
    ) in rows:
        username = (
            found_user.username
            or ""
        )

        display_name = (
            found_user.profile.display_name
            if found_user.profile
            else username
            or "User"
        )

        match = score_person(
            username,
            display_name,
            parsed,
        )

        if match.score <= 0:
            continue

        scored.append(
            (
                match.tier,
                match.score,
                SearchPersonResult(
                    username=(
                        username
                    ),
                    display_name=(
                        display_name
                    ),
                    avatar_url=(
                        avatar_url(
                            found_user,
                        )
                    ),
                    followers_count=int(
                        follower_count,
                    ),
                    member_since=(
                        found_user.created_at
                    ),
                    match_label=(
                        match.label
                    ),
                ),
            )
        )

    scored.sort(
        key=lambda item: (
            -item[0],
            -item[1],
            -item[
                2
            ].followers_count,
            item[
                2
            ].username.casefold(),
        )
    )

    return [
        item[2]
        for item in scored[
            :PEOPLE_RESULT_LIMIT
        ]
    ]


def _serialize_tracks(
    rows: list[dict],
) -> list[
    SearchTrackResult
]:
    return [
        SearchTrackResult(
            id=(
                row[
                    "track"
                ].id
            ),
            title=(
                row[
                    "track"
                ].title
            ),
            artist=(
                row[
                    "track"
                ].artist
            ),
            album=(
                row[
                    "track"
                ].album
            ),
            duration_seconds=(
                row[
                    "track"
                ].duration_seconds
            ),
            audio_url=(
                _track_audio_url(
                    row[
                        "track"
                    ]
                )
            ),
            artwork_url=(
                _track_artwork_url(
                    row[
                        "track"
                    ]
                )
            ),
            match_label=(
                row[
                    "match_label"
                ]
            ),
            matched_field=(
                row[
                    "matched_field"
                ]
            ),
            user_play_count=(
                row[
                    "user_play_count"
                ]
            ),
            global_play_count=(
                row[
                    "global_play_count"
                ]
            ),
            last_played_at=(
                row[
                    "last_played_at"
                ]
            ),
        )
        for row in rows
    ]


_FEATURE_CONTEXT_MARKER = re.compile(
    (
        r"(?:"
        r"\s*[\(\[]\s*"
        r"|"
        r"\s+"
        r")"
        r"(?:"
        r"feat(?:uring)?"
        r"|ft"
        r")"
        r"\.?"
        r"\s+"
    ),
    flags=re.IGNORECASE,
)


def _title_without_feature_credit(
    title: str,
) -> str:
    """
    Return the actual song-title
    portion before a feature credit.

    Examples:

    Deja Vu (feat. Justin Bieber)
        -> Deja Vu

    Song ft. Artist
        -> Song

    Song featuring Artist
        -> Song
    """

    value = str(
        title or "",
    ).strip()

    if not value:
        return ""

    marker = (
        _FEATURE_CONTEXT_MARKER.search(
            value,
        )
    )

    if marker is None:
        return value

    return value[
        : marker.start()
    ].rstrip(
        " \t-–—:([{",
    )


def _direct_title_match(
    track: SearchTrackResult,
    parsed: ParsedSearch,
) -> MatchResult | None:
    """
    Return the title match only when
    the query matches the real song
    title rather than feature-credit
    text.

    This prevents a query such as
    "Justin Bieber" from treating
    "Deja Vu (feat. Justin Bieber)"
    as a direct Deja Vu title search.
    """

    if (
        track.matched_field
        != "title"
    ):
        return None

    clean_title = (
        _title_without_feature_credit(
            track.title,
        )
    )

    if not clean_title:
        return None

    match = score_track(
        clean_title,
        "",
        None,
        parsed,
    )

    if (
        match.score <= 0
        or match.field != "title"
    ):
        return None

    return match


def _direct_album_match(
    track: SearchTrackResult,
    parsed: ParsedSearch,
) -> MatchResult | None:
    """
    Return a match only when the
    album itself directly matched
    the query.
    """

    if (
        track.matched_field
        != "album"
        or not track.album
    ):
        return None

    match = score_album(
        track.album,
        parsed,
    )

    if match.score <= 0:
        return None

    return match


def _is_direct_music_context(
    track: SearchTrackResult,
    parsed: ParsedSearch,
) -> bool:
    """
    A direct song-title or album
    search may expand the related
    artist, collaborators, and album.
    """

    return (
        _direct_title_match(
            track,
            parsed,
        )
        is not None
        or _direct_album_match(
            track,
            parsed,
        )
        is not None
    )


def _artist_results(
    tracks: list[
        SearchTrackResult
    ],
    parsed: ParsedSearch,
) -> list[
    SearchArtistResult
]:
    artists: OrderedDict[
        str,
        SearchArtistResult,
    ] = OrderedDict()

    for track in tracks:
        direct_context = (
            _is_direct_music_context(
                track,
                parsed,
            )
        )

        primary_match = (
            score_artist(
                track.artist,
                parsed,
            )
        )

        primary_key = (
            normalize_text(
                track.artist,
            )
        )

        if (
            primary_key
            and (
                primary_match.score
                > 0
                or direct_context
            )
        ):
            primary_label = (
                primary_match.label
                if primary_match.score
                > 0
                else "RELATED ARTIST"
            )

            if (
                primary_key
                not in artists
            ):
                artists[
                    primary_key
                ] = (
                    SearchArtistResult(
                        name=(
                            track.artist
                        ),
                        track_count=1,
                        artwork_url=(
                            track.artwork_url
                        ),
                        match_label=(
                            primary_label
                        ),
                    )
                )

            else:
                (
                    artists[
                        primary_key
                    ].track_count
                ) += 1

                if (
                    not artists[
                        primary_key
                    ].artwork_url
                    and track.artwork_url
                ):
                    artists[
                        primary_key
                    ].artwork_url = (
                        track.artwork_url
                    )

                if (
                    primary_match.score
                    > 0
                    and artists[
                        primary_key
                    ].match_label
                    == "RELATED ARTIST"
                ):
                    artists[
                        primary_key
                    ].match_label = (
                        primary_match.label
                    )

        # Featured artists stay in the
        # Artists section only when the
        # featured artist's own name
        # matches the query. Direct song
        # expansion puts them under
        # Collaborations instead.
        seen_featured: set[
            str
        ] = set()

        for featured_artist in (
            extract_featured_artists(
                track.title,
            )
        ):
            featured_key = (
                normalize_text(
                    featured_artist,
                )
            )

            if (
                not featured_key
                or featured_key
                == primary_key
                or featured_key
                in seen_featured
            ):
                continue

            seen_featured.add(
                featured_key,
            )

            featured_match = (
                score_artist(
                    featured_artist,
                    parsed,
                )
            )

            if (
                featured_match.score
                <= 0
            ):
                continue

            if (
                featured_key
                not in artists
            ):
                artists[
                    featured_key
                ] = (
                    SearchArtistResult(
                        name=(
                            featured_artist
                        ),
                        track_count=1,
                        artwork_url=(
                            track.artwork_url
                        ),
                        match_label=(
                            featured_match.label
                        ),
                    )
                )

            else:
                (
                    artists[
                        featured_key
                    ].track_count
                ) += 1

                if (
                    not artists[
                        featured_key
                    ].artwork_url
                    and track.artwork_url
                ):
                    artists[
                        featured_key
                    ].artwork_url = (
                        track.artwork_url
                    )

    return list(
        artists.values()
    )


def _collaboration_results(
    tracks: list[
        SearchTrackResult
    ],
    parsed: ParsedSearch,
) -> list[
    SearchArtistResult
]:
    if not parsed.term:
        return []

    direct_artists = {
        normalize_text(
            artist.name,
        )
        for artist in (
            _artist_results(
                tracks,
                parsed,
            )
        )
    }

    collaborations: OrderedDict[
        str,
        SearchArtistResult,
    ] = OrderedDict()

    def add_collaboration(
        name: str,
        track: SearchTrackResult,
    ) -> None:
        key = normalize_text(
            name,
        )

        if (
            not key
            or key
            in direct_artists
        ):
            return

        if (
            key
            not in collaborations
        ):
            collaborations[
                key
            ] = (
                SearchArtistResult(
                    name=name,
                    track_count=1,
                    artwork_url=(
                        track.artwork_url
                    ),
                    match_label=(
                        "COLLABORATION"
                    ),
                )
            )

        else:
            (
                collaborations[
                    key
                ].track_count
            ) += 1

            if (
                not collaborations[
                    key
                ].artwork_url
                and track.artwork_url
            ):
                collaborations[
                    key
                ].artwork_url = (
                    track.artwork_url
                )

    for track in tracks:
        featured_artists = (
            extract_featured_artists(
                track.title,
            )
        )

        if not featured_artists:
            continue

        primary_match = (
            score_artist(
                track.artist,
                parsed,
            )
        )

        matching_features = [
            featured_artist
            for featured_artist
            in featured_artists
            if score_artist(
                featured_artist,
                parsed,
            ).score
            > 0
        ]

        direct_context = (
            _is_direct_music_context(
                track,
                parsed,
            )
        )

        # Search matched the primary
        # artist, or the song/album
        # itself directly. Explicitly
        # credited featured artists
        # become collaborations.
        if (
            primary_match.score > 0
            or direct_context
        ):
            for (
                featured_artist
            ) in featured_artists:
                add_collaboration(
                    featured_artist,
                    track,
                )

        # Search matched an explicitly
        # featured artist. The primary
        # artist becomes a collaboration.
        if matching_features:
            add_collaboration(
                track.artist,
                track,
            )

    return list(
        collaborations.values()
    )


def _album_results(
    tracks: list[
        SearchTrackResult
    ],
    parsed: ParsedSearch,
) -> list[
    SearchAlbumResult
]:
    albums: OrderedDict[
        tuple[
            str,
            str,
        ],
        SearchAlbumResult,
    ] = OrderedDict()

    for track in tracks:
        if not track.album:
            continue

        album_match = score_album(
            track.album,
            parsed,
        )

        artist_match = (
            score_artist(
                track.artist,
                parsed,
            )
        )

        direct_context = (
            _is_direct_music_context(
                track,
                parsed,
            )
        )

        if (
            album_match.score <= 0
            and artist_match.score
            <= 0
            and not direct_context
        ):
            continue

        if album_match.score > 0:
            match_label = (
                album_match.label
            )

        elif (
            artist_match.score > 0
        ):
            match_label = (
                artist_match.label
            )

        else:
            match_label = (
                "RELATED ALBUM"
            )

        key = (
            normalize_text(
                track.artist,
            ),
            normalize_text(
                track.album,
            ),
        )

        if key not in albums:
            albums[
                key
            ] = (
                SearchAlbumResult(
                    title=(
                        track.album
                    ),
                    artist=(
                        track.artist
                    ),
                    track_count=1,
                    artwork_url=(
                        track.artwork_url
                    ),
                    match_label=(
                        match_label
                    ),
                )
            )

        else:
            (
                albums[
                    key
                ].track_count
            ) += 1

            if (
                not albums[
                    key
                ].artwork_url
                and track.artwork_url
            ):
                albums[
                    key
                ].artwork_url = (
                    track.artwork_url
                )

            if (
                albums[
                    key
                ].match_label
                == "RELATED ALBUM"
                and match_label
                != "RELATED ALBUM"
            ):
                albums[
                    key
                ].match_label = (
                    match_label
                )

    return list(
        albums.values()
    )


def _build_top_artist_results(
    rows: list[
        tuple[
            str,
            int,
            int,
        ]
    ],
) -> list[
    SearchArtistResult
]:
    ranked = sorted(
        rows,
        key=lambda row: (
            -int(
                row[1],
            ),
            str(
                row[0],
            ).casefold(),
        ),
    )

    return [
        SearchArtistResult(
            name=name,
            track_count=int(
                track_count,
            ),
            artwork_url=None,
            match_label=(
                "TOP ARTIST"
            ),
        )
        for (
            name,
            _play_count,
            track_count,
        ) in ranked
    ]


async def _top_artist_results(
    session: AsyncSession,
    user: User | None,
) -> list[
    SearchArtistResult
]:
    if user is None:
        return []

    result = await session.execute(
        select(
            Track.artist,
            func.count(
                ListeningEvent.id,
            ).label(
                "play_count",
            ),
            func.count(
                func.distinct(
                    Track.id,
                ),
            ).label(
                "track_count",
            ),
        )
        .join(
            ListeningEvent,
            ListeningEvent.track_id
            == Track.id,
        )
        .where(
            ListeningEvent.user_id
            == user.id,
            Track.is_published.is_(
                True,
            ),
        )
        .group_by(
            Track.artist,
        )
        .order_by(
            func.count(
                ListeningEvent.id,
            ).desc(),
            Track.artist.asc(),
        )
        .limit(
            TOP_ENTITY_LIMIT,
        )
    )

    rows = [
        (
            str(
                artist,
            ),
            int(
                play_count,
            ),
            int(
                track_count,
            ),
        )
        for (
            artist,
            play_count,
            track_count,
        ) in result.all()
    ]

    return (
        _build_top_artist_results(
            rows,
        )
    )


def _build_top_album_results(
    rows: list[
        tuple[
            str,
            str,
            int,
            int,
        ]
    ],
) -> list[
    SearchAlbumResult
]:
    ranked = sorted(
        rows,
        key=lambda row: (
            -int(
                row[2],
            ),
            str(
                row[1],
            ).casefold(),
            str(
                row[0],
            ).casefold(),
        ),
    )

    return [
        SearchAlbumResult(
            title=title,
            artist=artist,
            track_count=int(
                track_count,
            ),
            artwork_url=None,
            match_label=(
                "TOP ALBUM"
            ),
        )
        for (
            title,
            artist,
            _play_count,
            track_count,
        ) in ranked
    ]


async def _top_album_results(
    session: AsyncSession,
    user: User | None,
) -> list[
    SearchAlbumResult
]:
    if user is None:
        return []

    result = await session.execute(
        select(
            Track.album,
            Track.artist,
            func.count(
                ListeningEvent.id,
            ).label(
                "play_count",
            ),
            func.count(
                func.distinct(
                    Track.id,
                ),
            ).label(
                "track_count",
            ),
        )
        .join(
            ListeningEvent,
            ListeningEvent.track_id
            == Track.id,
        )
        .where(
            ListeningEvent.user_id
            == user.id,
            Track.is_published.is_(
                True,
            ),
            Track.album.is_not(
                None,
            ),
            Track.album != "",
        )
        .group_by(
            Track.album,
            Track.artist,
        )
        .order_by(
            func.count(
                ListeningEvent.id,
            ).desc(),
            Track.artist.asc(),
            Track.album.asc(),
        )
        .limit(
            TOP_ENTITY_LIMIT,
        )
    )

    rows = [
        (
            str(
                album,
            ),
            str(
                artist,
            ),
            int(
                play_count,
            ),
            int(
                track_count,
            ),
        )
        for (
            album,
            artist,
            play_count,
            track_count,
        ) in result.all()
    ]

    return (
        _build_top_album_results(
            rows,
        )
    )


@router.get(
    "/preferences",
    response_model=(
        SearchPreferenceResponse
    ),
)
async def get_search_preferences(
    user: CurrentUser,
    session: DatabaseSession,
) -> SearchPreferenceResponse:
    return SearchPreferenceResponse(
        sort_mode=(
            await _saved_sort_mode(
                session,
                user,
            )
        )
    )


@router.patch(
    "/preferences",
    response_model=(
        SearchPreferenceResponse
    ),
)
async def update_search_preferences(
    payload: SearchPreferenceUpdate,
    user: CurrentUser,
    session: DatabaseSession,
) -> SearchPreferenceResponse:
    state = await session.get(
        UserAppState,
        user.id,
    )

    if state is None:
        state = UserAppState(
            user_id=user.id,
        )

        session.add(
            state,
        )

    state.search_sort_mode = (
        payload.sort_mode
    )

    await session.commit()

    return (
        SearchPreferenceResponse(
            sort_mode=(
                payload.sort_mode
            )
        )
    )


@router.get(
    "",
    response_model=(
        SearchResponse
    ),
)
async def search_hypersync(
    session: DatabaseSession,
    user: OptionalCurrentUser,
    q: Annotated[
        str,
        Query(
            max_length=200,
        ),
    ] = "",
    sort_mode: Annotated[
        SearchSortMode | None,
        Query(
            alias="sort",
        ),
    ] = None,
) -> SearchResponse:
    started = perf_counter()

    parsed = parse_search_query(
        q,
    )

    effective_sort = (
        sort_mode
        if sort_mode
        in SEARCH_SORT_MODES
        else await _saved_sort_mode(
            session,
            user,
        )
    )

    if not parsed.raw:
        return SearchResponse(
            query="",
            interpreted_query="",
            intent="general",
            sort_mode=(
                effective_sort
            ),
            processing_ms=0,
            counts=SearchCounts(
                tracks=0,
                artists=0,
                collaborations=0,
                albums=0,
                people=0,
            ),
            tracks=[],
            artists=[],
            collaborations=[],
            albums=[],
            people=[],
        )

    track_rows = (
        await _build_track_rows(
            session,
            parsed,
            user,
            effective_sort,
        )
    )

    tracks = _serialize_tracks(
        track_rows,
    )

    if (
        parsed.intent
        == "top_artists"
    ):
        artists = (
            await _top_artist_results(
                session,
                user,
            )
        )

    else:
        artists = _artist_results(
            tracks,
            parsed,
        )

    collaborations = (
        _collaboration_results(
            tracks,
            parsed,
        )
    )

    if (
        parsed.intent
        == "top_albums"
    ):
        albums = (
            await _top_album_results(
                session,
                user,
            )
        )

    else:
        albums = _album_results(
            tracks,
            parsed,
        )

    should_search_people = (
        parsed.intent
        in {
            "general",
            "people",
        }
    )

    people = (
        await _search_people(
            session,
            parsed,
        )
        if should_search_people
        else []
    )

    processing_ms = max(
        1,
        int(
            (
                perf_counter()
                - started
            )
            * 1000
        ),
    )

    return SearchResponse(
        query=(
            parsed.raw
        ),
        interpreted_query=(
            parsed.term
        ),
        intent=(
            parsed.intent
        ),
        sort_mode=(
            effective_sort
        ),
        processing_ms=(
            processing_ms
        ),
        counts=SearchCounts(
            tracks=len(
                tracks,
            ),
            artists=len(
                artists,
            ),
            collaborations=len(
                collaborations,
            ),
            albums=len(
                albums,
            ),
            people=len(
                people,
            ),
        ),
        tracks=(
            tracks
        ),
        artists=(
            artists
        ),
        collaborations=(
            collaborations
        ),
        albums=(
            albums
        ),
        people=(
            people
        ),
    )
