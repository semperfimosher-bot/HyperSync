from __future__ import annotations

from datetime import datetime
from typing import Literal, overload
from uuid import UUID

from fastapi import (
    APIRouter,
    HTTPException,
    Query,
    status,
)
from pydantic import BaseModel, Field
from sqlalchemy import (
    func,
    or_,
    select,
)

from ...models.account import (
    AccountType,
    User,
)
from ...models.media import Track
from ...models.playlist import (
    Playlist,
    PlaylistTrack,
    SavedPlaylist,
)
from ..dependencies import (
    CurrentUser,
    DatabaseSession,
    OptionalCurrentUser,
)
from .catalog import (
    _track_artwork_url,
    _track_artwork_version,
    _track_audio_url,
    _track_media_version,
)

from ...services.admin_notifications import (
    record_admin_activity,
)
from ...services.generated_playlists import (
    ensure_smart_playlist,
    refresh_generated_playlist_if_stale,
)

router = APIRouter(
    prefix="/playlists",
    tags=["playlists"],
)


PlaylistVisibility = Literal[
    "private",
    "unlisted",
    "public",
]


class GeneratedPlaylistCreateRequest(
    BaseModel,
):
    query: str = Field(
        min_length=1,
        max_length=200,
    )


class PlaylistCreateRequest(
    BaseModel,
):
    title: str = Field(
        min_length=1,
        max_length=120,
    )

    description: str | None = Field(
        default=None,
        max_length=1000,
    )

    visibility: PlaylistVisibility = "private"


class PlaylistUpdateRequest(
    BaseModel,
):
    title: str | None = Field(
        default=None,
        min_length=1,
        max_length=120,
    )

    description: str | None = Field(
        default=None,
        max_length=1000,
    )

    visibility: PlaylistVisibility | None = None


class PlaylistTrackAddRequest(
    BaseModel,
):
    track_id: UUID


class PlaylistReorderRequest(
    BaseModel,
):
    playlist_track_ids: list[UUID]


class PlaylistTrackResponse(
    BaseModel,
):
    playlist_track_id: UUID

    id: UUID

    position: int

    title: str

    artist: str

    album: str | None
    genre: str | None = None
    release_year: int | None = None

    duration_seconds: int | None

    audio_url: str | None = None

    artwork_url: str | None = None

    mime_type: str | None = None

    file_size: int | None = None

    media_version: str | None = None
    artwork_version: str | None = None

    added_at: datetime | None = None


class LibraryTrackResponse(
    BaseModel,
):
    id: UUID

    title: str

    artist: str

    album: str | None
    genre: str | None = None
    release_year: int | None = None

    duration_seconds: int | None

    audio_url: str | None = None

    artwork_url: str | None = None

    mime_type: str | None = None

    file_size: int | None = None

    media_version: str | None = None
    artwork_version: str | None = None

    created_at: datetime | None = None


class LikedTrackStateResponse(
    BaseModel,
):
    liked: bool

    playlist_id: UUID | None = None


class PlaylistSummaryResponse(
    BaseModel,
):
    id: UUID

    title: str

    description: str | None

    visibility: str

    owner_id: UUID | None

    owner_username: str

    track_count: int

    total_duration_seconds: int

    artwork_url: str | None = None

    artwork_urls: list[str | None] = Field(
        default_factory=list,
    )

    is_owner: bool = False

    is_saved: bool = False

    is_liked_songs: bool = False

    generated_kind: str | None = None
    generated_query: str | None = None

    created_at: datetime

    updated_at: datetime


class PlaylistDetailResponse(
    PlaylistSummaryResponse,
):
    tracks: list[PlaylistTrackResponse]


def require_registered_user(
    user: User,
) -> None:
    if user.account_type != AccountType.REGISTERED:
        raise HTTPException(
            status_code=(status.HTTP_403_FORBIDDEN),
            detail=("A registered account is required for playlists."),
        )


async def get_playlist_or_404(
    session: DatabaseSession,
    playlist_id: UUID,
) -> Playlist:
    playlist = await session.get(
        Playlist,
        playlist_id,
    )

    if playlist is None:
        raise HTTPException(
            status_code=(status.HTTP_404_NOT_FOUND),
            detail="Playlist not found.",
        )

    return playlist


def can_view_playlist(
    playlist: Playlist,
    viewer: User | None,
) -> bool:
    if (
        viewer is not None
        and playlist.owner_id == viewer.id
    ):
        return True

    if (
        playlist.visibility == "generated"
        and playlist.owner_id is None
    ):
        return True

    return playlist.visibility in {
        "public",
        "unlisted",
    }


async def require_playlist_owner(
    session: DatabaseSession,
    playlist_id: UUID,
    user: User,
) -> Playlist:
    playlist = await get_playlist_or_404(
        session,
        playlist_id,
    )

    if playlist.owner_id != user.id:
        raise HTTPException(
            status_code=(status.HTTP_403_FORBIDDEN),
            detail=("Only the playlist owner can edit this playlist."),
        )

    return playlist


async def playlist_is_saved(
    session: DatabaseSession,
    user: User | None,
    playlist_id: UUID,
) -> bool:
    if user is None:
        return False

    saved = await session.get(
        SavedPlaylist,
        (
            user.id,
            playlist_id,
        ),
    )

    return saved is not None


async def playlist_owner_username(
    session: DatabaseSession,
    playlist: Playlist,
) -> str:
    if playlist.owner_id is None:
        return "HyperSynced"

    owner = await session.get(
        User,
        playlist.owner_id,
    )

    if (
        owner is None
        or not owner.username
    ):
        return "User"

    return owner.username


async def playlist_statistics(
    session: DatabaseSession,
    playlist_id: UUID,
) -> tuple[int, int]:
    result = await session.execute(
        select(
            func.count(
                PlaylistTrack.id,
            ),
            func.coalesce(
                func.sum(
                    Track.duration_seconds,
                ),
                0,
            ),
        )
        .select_from(
            PlaylistTrack,
        )
        .join(
            Track,
            Track.id == PlaylistTrack.track_id,
        )
        .where(
            PlaylistTrack.playlist_id == playlist_id,
            Track.is_published.is_(
                True,
            ),
        )
    )

    row = result.one()

    return (
        int(
            row[0] or 0,
        ),
        int(
            row[1] or 0,
        ),
    )


async def playlist_artwork_urls(
    session: DatabaseSession,
    playlist_id: UUID,
) -> list[str | None]:
    result = await session.execute(
        select(
            Track,
        )
        .join(
            PlaylistTrack,
            PlaylistTrack.track_id == Track.id,
        )
        .where(
            PlaylistTrack.playlist_id == playlist_id,
            Track.is_published.is_(
                True,
            ),
        )
        .order_by(
            PlaylistTrack.position.asc(),
            PlaylistTrack.created_at.asc(),
        )
        .limit(
            4,
        )
    )

    return [
        _track_artwork_url(
            track,
        )
        for track in result.scalars().all()
    ]


async def playlist_artwork_url(
    session: DatabaseSession,
    playlist_id: UUID,
) -> str | None:
    result = await session.execute(
        select(
            Track,
        )
        .join(
            PlaylistTrack,
            PlaylistTrack.track_id == Track.id,
        )
        .where(
            PlaylistTrack.playlist_id == playlist_id,
            Track.is_published.is_(
                True,
            ),
            Track.artwork_object_key.is_not(
                None,
            ),
        )
        .order_by(
            PlaylistTrack.position.asc(),
            PlaylistTrack.created_at.asc(),
        )
        .limit(
            1,
        )
    )

    track = result.scalars().first()

    if track is None:
        return None

    return _track_artwork_url(
        track,
    )


async def serialize_playlist_summary(
    session: DatabaseSession,
    playlist: Playlist,
    viewer: User | None,
) -> PlaylistSummaryResponse:
    (
        track_count,
        total_duration,
    ) = await playlist_statistics(
        session,
        playlist.id,
    )

    owner_username = await playlist_owner_username(
        session,
        playlist,
    )

    artwork_urls = await playlist_artwork_urls(
        session,
        playlist.id,
    )

    artwork_url = next(
        (
            artwork
            for artwork in artwork_urls
            if artwork
        ),
        None,
    )

    is_owner = bool(viewer is not None and viewer.id == playlist.owner_id)

    is_saved = await playlist_is_saved(
        session,
        viewer,
        playlist.id,
    )

    is_liked_songs = bool(
        playlist.owner_id is not None
        and playlist.generated_key
        == f"liked:{playlist.owner_id}"
    )

    return PlaylistSummaryResponse(
        id=playlist.id,
        title=playlist.title,
        description=(playlist.description),
        visibility=(playlist.visibility),
        owner_id=(playlist.owner_id),
        owner_username=(owner_username),
        track_count=(track_count),
        total_duration_seconds=(total_duration),
        artwork_url=(artwork_url),
        artwork_urls=(artwork_urls),
        is_owner=is_owner,
        is_saved=is_saved,
        is_liked_songs=is_liked_songs,
        generated_kind=(
            playlist.generated_kind
        ),
        generated_query=(
            playlist.generated_query
        ),
        created_at=(playlist.created_at),
        updated_at=(playlist.updated_at),
    )


def serialize_playlist_track(
    playlist_track: PlaylistTrack,
    track: Track,
) -> PlaylistTrackResponse:
    return PlaylistTrackResponse(
        playlist_track_id=(playlist_track.id),
        id=track.id,
        position=(playlist_track.position),
        title=track.title,
        artist=track.artist,
        album=track.album,
        genre=getattr(
            track,
            "genre",
            None,
        ),
        release_year=getattr(
            track,
            "release_year",
            None,
        ),
        duration_seconds=(track.duration_seconds),
        audio_url=(
            _track_audio_url(
                track,
            )
        ),
        artwork_url=(
            _track_artwork_url(
                track,
            )
        ),
        mime_type=(track.mime_type),
        file_size=(track.file_size),
        media_version=(
            _track_media_version(
                track,
            )
        ),
        artwork_version=(
            _track_artwork_version(
                track,
            )
        ),
        added_at=(
            playlist_track.created_at
        ),
    )


async def load_playlist_tracks(
    session: DatabaseSession,
    playlist_id: UUID,
) -> list[PlaylistTrackResponse]:
    result = await session.execute(
        select(
            PlaylistTrack,
            Track,
        )
        .join(
            Track,
            Track.id == PlaylistTrack.track_id,
        )
        .where(
            PlaylistTrack.playlist_id == playlist_id,
            Track.is_published.is_(
                True,
            ),
        )
        .order_by(
            PlaylistTrack.position.asc(),
            PlaylistTrack.created_at.asc(),
        )
    )

    return [
        serialize_playlist_track(
            playlist_track,
            track,
        )
        for (
            playlist_track,
            track,
        ) in result.all()
    ]


async def serialize_playlist_detail(
    session: DatabaseSession,
    playlist: Playlist,
    viewer: User | None,
) -> PlaylistDetailResponse:
    summary = await serialize_playlist_summary(
        session,
        playlist,
        viewer,
    )

    tracks = await load_playlist_tracks(
        session,
        playlist.id,
    )

    return PlaylistDetailResponse(
        **summary.model_dump(),
        tracks=tracks,
    )


async def renumber_playlist_tracks(
    session: DatabaseSession,
    playlist_id: UUID,
) -> None:
    result = await session.execute(
        select(
            PlaylistTrack,
        )
        .where(
            PlaylistTrack.playlist_id == playlist_id,
        )
        .order_by(
            PlaylistTrack.position.asc(),
            PlaylistTrack.created_at.asc(),
        )
    )

    rows = list(result.scalars().all())

    for (
        position,
        row,
    ) in enumerate(
        rows,
    ):
        row.position = position


# ---------------------------------------------------------------------------
# Static routes must stay above /{playlist_id}
# ---------------------------------------------------------------------------


@router.get(
    "/mine",
    response_model=list[PlaylistSummaryResponse],
)
async def get_my_playlists(
    user: CurrentUser,
    session: DatabaseSession,
) -> list[PlaylistSummaryResponse]:
    require_registered_user(
        user,
    )

    result = await session.execute(
        select(
            Playlist,
        )
        .where(
            Playlist.owner_id == user.id,
        )
        .order_by(
            Playlist.updated_at.desc(),
            Playlist.created_at.desc(),
        )
    )

    playlists = list(result.scalars().all())

    refreshed_playlists = [
        await refresh_generated_playlist_if_stale(
            session,
            playlist,
        )
        for playlist in playlists
    ]

    return [
        await serialize_playlist_summary(
            session,
            playlist,
            user,
        )
        for playlist in refreshed_playlists
    ]


@router.get(
    "/saved",
    response_model=list[PlaylistSummaryResponse],
)
async def get_saved_playlists(
    user: CurrentUser,
    session: DatabaseSession,
) -> list[PlaylistSummaryResponse]:
    require_registered_user(
        user,
    )

    result = await session.execute(
        select(
            Playlist,
        )
        .join(
            SavedPlaylist,
            SavedPlaylist.playlist_id == Playlist.id,
        )
        .where(
            SavedPlaylist.user_id == user.id,
            Playlist.visibility.in_(
    (
        "public",
        "unlisted",
        "generated",
    ),
),
        )
        .order_by(
            SavedPlaylist.created_at.desc(),
        )
    )

    playlists = list(result.scalars().all())

    refreshed_playlists = [
        await refresh_generated_playlist_if_stale(
            session,
            playlist,
        )
        for playlist in playlists
    ]

    return [
        await serialize_playlist_summary(
            session,
            playlist,
            user,
        )
        for playlist in refreshed_playlists
    ]


@router.get(
    "/library/tracks",
    response_model=list[LibraryTrackResponse],
)
async def get_library_tracks(
    user: CurrentUser,
    session: DatabaseSession,
) -> list[LibraryTrackResponse]:
    require_registered_user(
        user,
    )

    owned_track_ids = (
        select(
            PlaylistTrack.track_id,
        )
        .join(
            Playlist,
            Playlist.id
            == PlaylistTrack.playlist_id,
        )
        .where(
            Playlist.owner_id
            == user.id,
        )
    )

    saved_track_ids = (
        select(
            PlaylistTrack.track_id,
        )
        .join(
            SavedPlaylist,
            SavedPlaylist.playlist_id
            == PlaylistTrack.playlist_id,
        )
        .where(
            SavedPlaylist.user_id
            == user.id,
        )
    )

    result = await session.execute(
        select(
            Track,
        )
        .where(
            Track.is_published.is_(
                True,
            ),
            or_(
                Track.id.in_(
                    owned_track_ids,
                ),
                Track.id.in_(
                    saved_track_ids,
                ),
            ),
        )
        .order_by(
            func.lower(
                Track.artist,
            ).asc(),
            func.lower(
                func.coalesce(
                    Track.album,
                    "",
                )
            ).asc(),
            func.lower(
                Track.title,
            ).asc(),
            Track.id.asc(),
        )
    )

    tracks = list(
        result.scalars().all()
    )

    return [
        LibraryTrackResponse(
            id=track.id,
            title=track.title,
            artist=track.artist,
            album=track.album,
            genre=getattr(
            track,
            "genre",
            None,
        ),
            release_year=getattr(
            track,
            "release_year",
            None,
        ),
            duration_seconds=(
                track.duration_seconds
            ),
            audio_url=(
                _track_audio_url(
                    track,
                )
            ),
            artwork_url=(
                _track_artwork_url(
                    track,
                )
            ),
            mime_type=(
                track.mime_type
            ),
            file_size=(
                track.file_size
            ),
            media_version=(
                _track_media_version(
                    track,
                )
            ),
            artwork_version=(
                _track_artwork_version(
                    track,
                )
            ),
            created_at=(
                track.created_at
            ),
        )
        for track in tracks
    ]


@router.get(
    "/search",
    response_model=list[PlaylistSummaryResponse],
)
async def search_public_playlists(
    session: DatabaseSession,
    viewer: OptionalCurrentUser,
    q: str = Query(
        default="",
        max_length=120,
    ),
) -> list[PlaylistSummaryResponse]:
    term = q.strip()

    if not term:
        return []

    pattern = f"%{term}%"

    result = await session.execute(
        select(
            Playlist,
        )
        .join(
            User,
            User.id == Playlist.owner_id,
        )
        .where(
            Playlist.visibility == "public",
            or_(
                Playlist.title.ilike(
                    pattern,
                ),
                Playlist.description.ilike(
                    pattern,
                ),
                User.username.ilike(
                    pattern,
                ),
            ),
        )
        .order_by(
            Playlist.updated_at.desc(),
        )
        .limit(
            30,
        )
    )

    playlists = list(result.scalars().all())

    return [
        await serialize_playlist_summary(
            session,
            playlist,
            viewer,
        )
        for playlist in playlists
    ]


@overload
async def get_liked_playlist(
    session: DatabaseSession,
    user: User,
    *,
    create: Literal[True],
) -> Playlist:
    ...


@overload
async def get_liked_playlist(
    session: DatabaseSession,
    user: User,
    *,
    create: Literal[False] = False,
) -> Playlist | None:
    ...


async def get_liked_playlist(
    session: DatabaseSession,
    user: User,
    *,
    create: bool = False,
) -> Playlist | None:
    liked_key = (
        f"liked:{user.id}"
    )

    result = await session.execute(
        select(
            Playlist,
        ).where(
            Playlist.generated_key
            == liked_key,
            Playlist.owner_id
            == user.id,
        )
    )

    playlist = (
        result.scalars()
        .first()
    )

    if (
        playlist is None
        and create
    ):
        playlist = Playlist(
            owner_id=user.id,
            title="Liked Songs",
            description=(
                "Songs you like on HyperSynced."
            ),
            visibility="private",
            generated_key=liked_key,
        )

        session.add(
            playlist,
        )

        await session.flush()

    return playlist


@router.post(
    "/generated",
    response_model=(
        PlaylistDetailResponse
    ),
    status_code=(
        status.HTTP_201_CREATED
    ),
)
async def create_generated_playlist(
    payload: GeneratedPlaylistCreateRequest,
    user: CurrentUser,
    session: DatabaseSession,
) -> PlaylistDetailResponse:
    require_registered_user(
        user,
    )

    query = " ".join(
        payload.query.split()
    )

    playlist = (
        await ensure_smart_playlist(
            session,
            user.id,
            query,
        )
    )

    if playlist is None:
        raise HTTPException(
            status_code=(
                status.HTTP_400_BAD_REQUEST
            ),
            detail=(
                "Playlist description is required."
            ),
        )

    return await serialize_playlist_detail(
        session,
        playlist,
        user,
    )


@router.get(
    "/liked/tracks/{track_id}",
    response_model=LikedTrackStateResponse,
)
async def get_liked_track_state(
    track_id: UUID,
    user: CurrentUser,
    session: DatabaseSession,
) -> LikedTrackStateResponse:
    require_registered_user(
        user,
    )

    playlist = (
        await get_liked_playlist(
            session,
            user,
        )
    )

    if playlist is None:
        return LikedTrackStateResponse(
            liked=False,
            playlist_id=None,
        )

    result = await session.execute(
        select(
            PlaylistTrack.id,
        ).where(
            PlaylistTrack.playlist_id
            == playlist.id,
            PlaylistTrack.track_id
            == track_id,
        )
    )

    return LikedTrackStateResponse(
        liked=(
            result.scalar_one_or_none()
            is not None
        ),
        playlist_id=playlist.id,
    )


@router.post(
    "/liked/tracks/{track_id}",
    response_model=LikedTrackStateResponse,
)
async def like_track(
    track_id: UUID,
    user: CurrentUser,
    session: DatabaseSession,
) -> LikedTrackStateResponse:
    require_registered_user(
        user,
    )

    track = await session.get(
        Track,
        track_id,
    )

    if (
        track is None
        or not track.is_published
    ):
        raise HTTPException(
            status_code=(
                status.HTTP_404_NOT_FOUND
            ),
            detail="Track not found.",
        )

    playlist = (
        await get_liked_playlist(
            session,
            user,
            create=True,
        )
    )

    existing = await session.execute(
        select(
            PlaylistTrack.id,
        ).where(
            PlaylistTrack.playlist_id
            == playlist.id,
            PlaylistTrack.track_id
            == track_id,
        )
    )

    if (
        existing.scalar_one_or_none()
        is None
    ):
        position_result = (
            await session.execute(
                select(
                    func.coalesce(
                        func.max(
                            PlaylistTrack.position,
                        ),
                        -1,
                    )
                ).where(
                    PlaylistTrack.playlist_id
                    == playlist.id,
                )
            )
        )

        next_position = (
            int(
                position_result.scalar_one(),
            )
            + 1
        )

        session.add(
            PlaylistTrack(
                playlist_id=playlist.id,
                track_id=track_id,
                position=next_position,
            )
        )

        await session.commit()

        await record_admin_activity(
            kind="track",
            title="Song liked",
            body=(
                "@"
                + str(
                    user.username
                    or "unknown",
                )
                + ' liked "'
                + track.title
                + '" by '
                + track.artist
                + "."
            ),
            actor_user_id=user.id,
            actor_username=user.username,
        )

    return LikedTrackStateResponse(
        liked=True,
        playlist_id=playlist.id,
    )


@router.delete(
    "/liked/tracks/{track_id}",
    response_model=LikedTrackStateResponse,
)
async def unlike_track(
    track_id: UUID,
    user: CurrentUser,
    session: DatabaseSession,
) -> LikedTrackStateResponse:
    require_registered_user(
        user,
    )

    playlist = (
        await get_liked_playlist(
            session,
            user,
        )
    )

    if playlist is None:
        return LikedTrackStateResponse(
            liked=False,
            playlist_id=None,
        )

    result = await session.execute(
        select(
            PlaylistTrack,
        ).where(
            PlaylistTrack.playlist_id
            == playlist.id,
            PlaylistTrack.track_id
            == track_id,
        )
    )

    playlist_track = (
        result.scalars()
        .first()
    )

    track = (
        await session.get(
            Track,
            track_id,
        )
        if playlist_track
        is not None
        else None
    )

    if playlist_track is not None:
        await session.delete(
            playlist_track,
        )

        await session.flush()

        await renumber_playlist_tracks(
            session,
            playlist.id,
        )

        await session.commit()

        if track is not None:
            await record_admin_activity(
                kind="track",
                title="Song unliked",
                body=(
                    "@"
                    + str(
                        user.username
                        or "unknown",
                    )
                    + ' removed "'
                    + track.title
                    + '" by '
                    + track.artist
                    + " from Liked Songs."
                ),
                actor_user_id=user.id,
                actor_username=user.username,
            )

    return LikedTrackStateResponse(
        liked=False,
        playlist_id=playlist.id,
    )


@router.post(
    "",
    response_model=(PlaylistDetailResponse),
    status_code=(status.HTTP_201_CREATED),
)
async def create_playlist(
    payload: PlaylistCreateRequest,
    user: CurrentUser,
    session: DatabaseSession,
) -> PlaylistDetailResponse:
    require_registered_user(
        user,
    )

    title = payload.title.strip()

    if not title:
        raise HTTPException(
            status_code=(status.HTTP_400_BAD_REQUEST),
            detail=("Playlist title cannot be empty."),
        )

    description = payload.description.strip() if payload.description else None

    playlist = Playlist(
        owner_id=user.id,
        title=title,
        description=description,
        visibility=(payload.visibility),
    )

    session.add(
        playlist,
    )

    await session.commit()

    await session.refresh(
        playlist,
    )

    return await serialize_playlist_detail(
        session,
        playlist,
        user,
    )


@router.get(
    "/{playlist_id}",
    response_model=(PlaylistDetailResponse),
)
async def get_playlist(
    playlist_id: UUID,
    session: DatabaseSession,
    viewer: OptionalCurrentUser,
) -> PlaylistDetailResponse:
    playlist = await get_playlist_or_404(
        session,
        playlist_id,
    )

    if not can_view_playlist(
        playlist,
        viewer,
    ):
        raise HTTPException(
            status_code=(status.HTTP_404_NOT_FOUND),
            detail=("Playlist not found."),
        )

    playlist = (
        await refresh_generated_playlist_if_stale(
            session,
            playlist,
        )
    )

    return await serialize_playlist_detail(
        session,
        playlist,
        viewer,
    )


@router.patch(
    "/{playlist_id}",
    response_model=(PlaylistDetailResponse),
)
async def update_playlist(
    playlist_id: UUID,
    payload: PlaylistUpdateRequest,
    user: CurrentUser,
    session: DatabaseSession,
) -> PlaylistDetailResponse:
    require_registered_user(
        user,
    )

    playlist = await require_playlist_owner(
        session,
        playlist_id,
        user,
    )

    supplied_fields = payload.model_fields_set

    if "title" in supplied_fields:
        title = (payload.title or "").strip()

        if not title:
            raise HTTPException(
                status_code=(status.HTTP_400_BAD_REQUEST),
                detail=("Playlist title cannot be empty."),
            )

        playlist.title = title

    if "description" in supplied_fields:
        playlist.description = payload.description.strip() if payload.description else None

    if "visibility" in supplied_fields and payload.visibility is not None:
        playlist.visibility = payload.visibility

    await session.commit()

    await session.refresh(
        playlist,
    )

    return await serialize_playlist_detail(
        session,
        playlist,
        user,
    )


@router.delete(
    "/{playlist_id}",
)
async def delete_playlist(
    playlist_id: UUID,
    user: CurrentUser,
    session: DatabaseSession,
) -> dict[str, str]:
    require_registered_user(
        user,
    )

    playlist = await require_playlist_owner(
        session,
        playlist_id,
        user,
    )

    await session.delete(
        playlist,
    )

    await session.commit()

    return {
        "status": "deleted",
    }


@router.post(
    "/{playlist_id}/tracks",
    response_model=(PlaylistTrackResponse),
    status_code=(status.HTTP_201_CREATED),
)
async def add_track_to_playlist(
    playlist_id: UUID,
    payload: PlaylistTrackAddRequest,
    user: CurrentUser,
    session: DatabaseSession,
) -> PlaylistTrackResponse:
    require_registered_user(
        user,
    )

    playlist = await require_playlist_owner(
        session,
        playlist_id,
        user,
    )

    track = await session.get(
        Track,
        payload.track_id,
    )

    if track is None or not track.is_published:
        raise HTTPException(
            status_code=(status.HTTP_404_NOT_FOUND),
            detail="Track not found.",
        )

    position_result = await session.execute(
        select(
            func.max(
                PlaylistTrack.position,
            )
        ).where(
            PlaylistTrack.playlist_id == playlist_id,
        )
    )

    max_position = position_result.scalar_one()

    next_position = int(max_position) + 1 if max_position is not None else 0

    playlist_track = PlaylistTrack(
        playlist_id=playlist_id,
        track_id=track.id,
        position=(next_position),
    )

    session.add(
        playlist_track,
    )

    await session.commit()

    await session.refresh(
        playlist_track,
    )

    await record_admin_activity(
        kind="track",
        title="Song added to playlist",
        body=(
            "@"
            + str(
                user.username
                or "unknown",
            )
            + ' added "'
            + track.title
            + '" by '
            + track.artist
            + ' to playlist "'
            + playlist.title
            + '".'
        ),
        actor_user_id=user.id,
        actor_username=user.username,
    )

    return serialize_playlist_track(
        playlist_track,
        track,
    )


@router.delete(
    ("/{playlist_id}/tracks/{playlist_track_id}"),
)
async def remove_track_from_playlist(
    playlist_id: UUID,
    playlist_track_id: UUID,
    user: CurrentUser,
    session: DatabaseSession,
) -> dict[str, str]:
    require_registered_user(
        user,
    )

    playlist = await require_playlist_owner(
        session,
        playlist_id,
        user,
    )

    playlist_track = await session.get(
        PlaylistTrack,
        playlist_track_id,
    )

    if playlist_track is None or playlist_track.playlist_id != playlist_id:
        raise HTTPException(
            status_code=(status.HTTP_404_NOT_FOUND),
            detail=("Playlist track not found."),
        )

    track = await session.get(
        Track,
        playlist_track.track_id,
    )

    await session.delete(
        playlist_track,
    )

    await session.flush()

    await renumber_playlist_tracks(
        session,
        playlist_id,
    )

    await session.commit()

    if track is not None:
        await record_admin_activity(
            kind="track",
            title="Song removed from playlist",
            body=(
                "@"
                + str(
                    user.username
                    or "unknown",
                )
                + ' removed "'
                + track.title
                + '" by '
                + track.artist
                + ' from playlist "'
                + playlist.title
                + '".'
            ),
            actor_user_id=user.id,
            actor_username=user.username,
        )

    return {
        "status": "removed",
    }


@router.put(
    "/{playlist_id}/tracks/reorder",
    response_model=(PlaylistDetailResponse),
)
async def reorder_playlist_tracks(
    playlist_id: UUID,
    payload: PlaylistReorderRequest,
    user: CurrentUser,
    session: DatabaseSession,
) -> PlaylistDetailResponse:
    require_registered_user(
        user,
    )

    playlist = await require_playlist_owner(
        session,
        playlist_id,
        user,
    )

    result = await session.execute(
        select(
            PlaylistTrack,
        ).where(
            PlaylistTrack.playlist_id == playlist_id,
        )
    )

    current_tracks = list(result.scalars().all())

    current_by_id = {row.id: row for row in current_tracks}

    requested_ids = payload.playlist_track_ids

    if (
        len(requested_ids) != len(current_tracks)
        or len(set(requested_ids)) != len(requested_ids)
        or set(requested_ids) != set(current_by_id.keys())
    ):
        raise HTTPException(
            status_code=(status.HTTP_400_BAD_REQUEST),
            detail=("Reorder request must contain every playlist track exactly once."),
        )

    for (
        position,
        playlist_track_id,
    ) in enumerate(
        requested_ids,
    ):
        current_by_id[playlist_track_id].position = position

    await session.commit()

    await session.refresh(
        playlist,
    )

    return await serialize_playlist_detail(
        session,
        playlist,
        user,
    )


@router.post(
    "/{playlist_id}/save",
)
async def save_playlist(
    playlist_id: UUID,
    user: CurrentUser,
    session: DatabaseSession,
) -> dict[str, str]:
    require_registered_user(
        user,
    )

    playlist = await get_playlist_or_404(
        session,
        playlist_id,
    )

    if playlist.owner_id == user.id:
        return {
            "status": "owned",
        }

    is_global_generated = (
    playlist.visibility == "generated"
    and playlist.owner_id is None
)

    if (
    playlist.visibility not in {
        "public",
        "unlisted",
    }
    and not is_global_generated
):
        raise HTTPException(
        status_code=(
            status.HTTP_404_NOT_FOUND
        ),
        detail="Playlist not found.",
    )

    existing = await session.get(
        SavedPlaylist,
        (
            user.id,
            playlist.id,
        ),
    )

    if existing is not None:
        return {
            "status": "saved",
        }

    session.add(
        SavedPlaylist(
            user_id=user.id,
            playlist_id=(playlist.id),
        )
    )

    await session.commit()

    return {
        "status": "saved",
    }


@router.delete(
    "/{playlist_id}/save",
)
async def unsave_playlist(
    playlist_id: UUID,
    user: CurrentUser,
    session: DatabaseSession,
) -> dict[str, str]:
    require_registered_user(
        user,
    )

    saved = await session.get(
        SavedPlaylist,
        (
            user.id,
            playlist_id,
        ),
    )

    if saved is not None:
        await session.delete(
            saved,
        )

        await session.commit()

    return {
        "status": "unsaved",
    }
