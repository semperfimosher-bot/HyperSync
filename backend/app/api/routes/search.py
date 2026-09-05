from __future__ import annotations

from collections import OrderedDict
from datetime import datetime
from time import perf_counter
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query
from pydantic import BaseModel
from sqlalchemy import (
    func,
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
    normalize_sort_mode,
    parse_search_query,
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


FUZZY_TRACK_CANDIDATE_LIMIT = 1200
FUZZY_PEOPLE_CANDIDATE_LIMIT = 200
HISTORY_COMMAND_LIMIT = 100


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
        ordering = func.count(ListeningEvent.id).desc()

    else:
        ordering = func.max(ListeningEvent.listened_at).desc()

    result = await session.execute(
        select(
            ListeningEvent.track_id,
        )
        .where(
            ListeningEvent.user_id == user.id,
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

    return list(result.scalars().all())


async def _load_track_candidates(
    session: AsyncSession,
    parsed: ParsedSearch,
    user: User | None,
) -> list[Track]:
    if parsed.intent == "people":
        return []

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

        track_ids = await _load_history_track_ids(
            session,
            user,
            parsed.intent,
        )

        if not track_ids:
            return []

        result = await session.execute(
            select(Track).where(
                Track.id.in_(
                    track_ids,
                ),
                Track.is_published.is_(
                    True,
                ),
            )
        )

        by_id = {track.id: track for track in result.scalars().all()}

        return [by_id[track_id] for track_id in track_ids if track_id in by_id]

    if not parsed.term:
        return []

    pattern = f"%{parsed.term}%"

    stmt = select(Track).where(
        Track.is_published.is_(True),
    )

    if parsed.field_hint == "artist":
        stmt = stmt.where(
            Track.artist.ilike(
                pattern,
            )
        )

    else:
        stmt = stmt.where(
            or_(
                Track.title.ilike(
                    pattern,
                ),
                Track.artist.ilike(
                    pattern,
                ),
                Track.album.ilike(
                    pattern,
                ),
            )
        )

    result = await session.execute(
        stmt.order_by(
            Track.artist.asc(),
            Track.title.asc(),
        )
    )

    direct = list(result.scalars().all())

    if direct:
        return direct

    # Only do the more expensive
    # fuzzy scan when no direct
    # matches exist.
    if len(parsed.term) < 3:
        return []

    fuzzy_result = await session.execute(
        select(Track)
        .where(
            Track.is_published.is_(
                True,
            )
        )
        .order_by(
            Track.created_at.desc(),
        )
        .limit(
            FUZZY_TRACK_CANDIDATE_LIMIT,
        )
    )

    return list(fuzzy_result.scalars().all())


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

    return {track_id: int(count) for track_id, count in result.all()}


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
    if user is None or not track_ids:
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
            ListeningEvent.user_id == user.id,
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
            int(play_count),
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
    candidates = await _load_track_candidates(
        session,
        parsed,
        user,
    )

    if not candidates:
        return []

    track_ids = [track.id for track in candidates]

    global_counts = await _global_play_counts(
        session,
        track_ids,
    )

    user_history = await _user_history(
        session,
        user,
        track_ids,
    )

    rows: list[dict] = []

    for track in candidates:
        match = _match_for_track(
            track,
            parsed,
        )

        if parsed.term and match.score <= 0:
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
                "title": track.title,
                "artist": track.artist,
                "match_score": (match.score),
                "match_tier": (match.tier),
                "match_label": (match.label),
                "matched_field": (match.field),
                "user_play_count": (user_play_count),
                "global_play_count": (
                    global_counts.get(
                        track.id,
                        0,
                    )
                ),
                "last_played_at": (last_played_at),
            }
        )

    return sort_track_rows(
        rows,
        sort_mode,
        parsed.intent,
    )


async def _search_people(
    session: AsyncSession,
    parsed: ParsedSearch,
) -> list[SearchPersonResult]:
    if (
        parsed.intent
        not in {
            "general",
            "people",
        }
        or not parsed.term
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

    pattern = f"%{parsed.term}%"

    stmt = (
        select(
            User,
            func.coalesce(
                follower_counts.c.followers_count,
                0,
            ),
        )
        .outerjoin(
            UserProfile,
            UserProfile.user_id == User.id,
        )
        .outerjoin(
            follower_counts,
            follower_counts.c.user_id == User.id,
        )
        .options(
            selectinload(
                User.profile,
            )
        )
        .where(
            User.is_active.is_(True),
            or_(
                User.username.ilike(
                    pattern,
                ),
                UserProfile.display_name.ilike(
                    pattern,
                ),
            ),
        )
        .order_by(
            User.username.asc(),
        )
    )

    result = await session.execute(stmt)

    rows = result.all()

    if not rows and len(parsed.term) >= 3:
        fuzzy_result = await session.execute(
            select(
                User,
                func.coalesce(
                    follower_counts.c.followers_count,
                    0,
                ),
            )
            .outerjoin(
                follower_counts,
                follower_counts.c.user_id == User.id,
            )
            .options(
                selectinload(
                    User.profile,
                )
            )
            .where(
                User.is_active.is_(
                    True,
                )
            )
            .order_by(
                User.created_at.desc(),
            )
            .limit(
                FUZZY_PEOPLE_CANDIDATE_LIMIT,
            )
        )

        rows = fuzzy_result.all()

    scored = []

    for (
        found_user,
        follower_count,
    ) in rows:
        username = found_user.username or ""

        display_name = found_user.profile.display_name if found_user.profile else username or "User"

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
                    username=username,
                    display_name=(display_name),
                    avatar_url=(
                        avatar_url(
                            found_user,
                        )
                    ),
                    followers_count=int(follower_count),
                    member_since=(found_user.created_at),
                    match_label=(match.label),
                ),
            )
        )

    scored.sort(
        key=lambda item: (
            -item[0],
            -item[1],
            item[2].username.casefold(),
        )
    )

    return [item[2] for item in scored]


def _serialize_tracks(
    rows: list[dict],
) -> list[SearchTrackResult]:
    return [
        SearchTrackResult(
            id=row["track"].id,
            title=row["track"].title,
            artist=row["track"].artist,
            album=row["track"].album,
            duration_seconds=row["track"].duration_seconds,
            # These deliberately reuse
            # the exact media URL logic
            # already used by catalog.py.
            audio_url=(_track_audio_url(row["track"])),
            artwork_url=(_track_artwork_url(row["track"])),
            match_label=(row["match_label"]),
            matched_field=(row["matched_field"]),
            user_play_count=(row["user_play_count"]),
            global_play_count=(row["global_play_count"]),
            last_played_at=(row["last_played_at"]),
        )
        for row in rows
    ]


def _artist_results(
    tracks: list[SearchTrackResult],
) -> list[SearchArtistResult]:
    artists = OrderedDict()

    for track in tracks:
        key = track.artist.casefold()

        if key not in artists:
            artists[key] = SearchArtistResult(
                name=track.artist,
                track_count=1,
                artwork_url=(track.artwork_url),
                match_label=(track.match_label),
            )

        else:
            artists[key].track_count += 1

    return list(artists.values())


def _album_results(
    tracks: list[SearchTrackResult],
) -> list[SearchAlbumResult]:
    albums = OrderedDict()

    for track in tracks:
        if not track.album:
            continue

        key = (
            track.artist.casefold(),
            track.album.casefold(),
        )

        if key not in albums:
            albums[key] = SearchAlbumResult(
                title=track.album,
                artist=track.artist,
                track_count=1,
                artwork_url=(track.artwork_url),
                match_label=(track.match_label),
            )

        else:
            albums[key].track_count += 1

    return list(albums.values())


@router.get(
    "/preferences",
    response_model=(SearchPreferenceResponse),
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
    response_model=(SearchPreferenceResponse),
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

        session.add(state)

    state.search_sort_mode = payload.sort_mode

    await session.commit()

    return SearchPreferenceResponse(sort_mode=(payload.sort_mode))


@router.get(
    "",
    response_model=SearchResponse,
)
async def search_hypersync(
    session: DatabaseSession,
    user: OptionalCurrentUser,
    q: Annotated[str, Query(max_length=200)] = "",
    sort_mode: Annotated[SearchSortMode | None, Query(alias="sort")] = None,
) -> SearchResponse:
    started = perf_counter()

    parsed = parse_search_query(q)

    effective_sort = (
        sort_mode
        if sort_mode in SEARCH_SORT_MODES
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
            sort_mode=(effective_sort),
            processing_ms=0,
            counts=SearchCounts(
                tracks=0,
                artists=0,
                albums=0,
                people=0,
            ),
            tracks=[],
            artists=[],
            albums=[],
            people=[],
        )

    track_rows = await _build_track_rows(
        session,
        parsed,
        user,
        effective_sort,
    )

    tracks = _serialize_tracks(
        track_rows,
    )

    artists = _artist_results(
        tracks,
    )

    albums = _album_results(
        tracks,
    )

    should_search_people = (
        parsed.intent == "people"
        or (
            parsed.intent == "general"
            and not tracks
        )
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
        query=parsed.raw,
        interpreted_query=(
            parsed.term
        ),
        intent=parsed.intent,
        sort_mode=(
            effective_sort
        ),
        processing_ms=(
            processing_ms
        ),
        counts=SearchCounts(
            tracks=len(tracks),
            artists=len(artists),
            albums=len(albums),
            people=len(people),
        ),
        tracks=tracks,
        artists=artists,
        albums=albums,
        people=people,
    )
