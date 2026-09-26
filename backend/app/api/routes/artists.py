from __future__ import annotations

from datetime import (
    UTC,
    datetime,
    timedelta,
)
from uuid import UUID

from fastapi import (
    APIRouter,
    HTTPException,
    status,
)
from pydantic import BaseModel
from sqlalchemy import (
    func,
    select,
)

from ...models.account import (
    AccountType,
    ListeningEvent,
    User,
)
from ...models.artist import (
    ArtistFollow,
    ArtistProfile,
)
from ...models.media import Track
from ...services.artists import (
    ensure_artist_profile,
    normalize_artist_name,
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


router = APIRouter(
    prefix="/artists",
    tags=["artists"],
)


class ArtistTrackResponse(BaseModel):
    id: UUID
    title: str
    artist: str
    album: str | None
    duration_seconds: int | None
    audio_url: str | None = None
    artwork_url: str | None = None
    mime_type: str | None = None
    file_size: int | None = None
    media_version: str | None = None
    artwork_version: str | None = None
    global_play_count: int = 0
    released_at: datetime


class ArtistAlbumResponse(BaseModel):
    title: str
    track_count: int
    artwork_url: str | None = None
    released_at: datetime


class ArtistProfileResponse(BaseModel):
    id: UUID
    name: str
    bio: str | None = None
    artwork_url: str | None = None
    followers_count: int
    is_following: bool
    track_count: int
    album_count: int
    total_plays: int
    monthly_listeners: int
    popular_tracks: list[ArtistTrackResponse]
    new_releases: list[ArtistTrackResponse]
    albums: list[ArtistAlbumResponse]


async def _artist_entity(
    session: DatabaseSession,
    artist_name: str,
) -> ArtistProfile:
    clean = artist_name.strip()
    normalized = normalize_artist_name(
        clean,
    )

    if not normalized:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Artist not found.",
        )

    result = await session.execute(
        select(
            ArtistProfile,
        ).where(
            ArtistProfile.normalized_name
            == normalized,
        )
    )

    profile = result.scalar_one_or_none()

    if profile is not None:
        return profile

    track_result = await session.execute(
        select(
            Track,
        ).where(
            func.lower(
                Track.artist,
            )
            == normalized.lower(),
            Track.is_published.is_(True),
        )
        .order_by(
            Track.created_at.asc(),
        )
        .limit(1)
    )

    track = (
        track_result.scalar_one_or_none()
    )

    if track is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Artist not found.",
        )

    profile = await ensure_artist_profile(
        session,
        track.artist,
    )

    await session.commit()

    return profile


def _track_response(
    track: Track,
    play_count: int,
) -> ArtistTrackResponse:
    return ArtistTrackResponse(
        id=track.id,
        title=track.title,
        artist=track.artist,
        album=track.album,
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
        mime_type=track.mime_type,
        file_size=track.file_size,
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
        global_play_count=max(
            int(
                play_count,
            ),
            0,
        ),
        released_at=track.created_at,
    )


async def _artist_profile_response(
    session: DatabaseSession,
    profile: ArtistProfile,
    viewer: User | None,
) -> ArtistProfileResponse:
    normalized = (
        profile.normalized_name
    )

    track_result = await session.execute(
        select(
            Track,
        ).where(
            func.lower(
                Track.artist,
            )
            == normalized.lower(),
            Track.is_published.is_(True),
        )
        .order_by(
            Track.created_at.desc(),
        )
    )

    tracks = list(
        track_result.scalars().all()
    )

    track_ids = [
        track.id
        for track in tracks
    ]

    play_counts: dict[
        UUID,
        int,
    ] = {}

    total_plays = 0
    monthly_listeners = 0

    if track_ids:
        plays_result = await session.execute(
            select(
                ListeningEvent.track_id,
                func.count(
                    ListeningEvent.id,
                ),
            )
            .where(
                ListeningEvent.track_id.in_(
                    track_ids,
                ),
            )
            .group_by(
                ListeningEvent.track_id,
            )
        )

        play_counts = {
            track_id: int(
                count or 0,
            )
            for (
                track_id,
                count,
            ) in plays_result.all()
        }

        total_plays = sum(
            play_counts.values(),
        )

        monthly_result = await session.execute(
            select(
                func.count(
                    func.distinct(
                        ListeningEvent.user_id,
                    ),
                ),
            ).where(
                ListeningEvent.track_id.in_(
                    track_ids,
                ),
                ListeningEvent.listened_at
                >= (
                    datetime.now(
                        UTC,
                    )
                    - timedelta(
                        days=28,
                    )
                ),
            )
        )

        monthly_listeners = int(
            monthly_result.scalar_one()
            or 0
        )

    followers_result = await session.execute(
        select(
            func.count(
                ArtistFollow.user_id,
            ),
        ).where(
            ArtistFollow.artist_id
            == profile.id,
        )
    )

    followers_count = int(
        followers_result.scalar_one()
        or 0
    )

    is_following = False

    if (
        viewer is not None
        and viewer.account_type
        == AccountType.REGISTERED
    ):
        follow_result = await session.execute(
            select(
                ArtistFollow.user_id,
            ).where(
                ArtistFollow.artist_id
                == profile.id,
                ArtistFollow.user_id
                == viewer.id,
            )
        )

        is_following = (
            follow_result.scalar_one_or_none()
            is not None
        )

    ranked_tracks = sorted(
        tracks,
        key=lambda track: (
            -play_counts.get(
                track.id,
                0,
            ),
            -track.created_at.timestamp(),
        ),
    )

    popular_tracks = [
        _track_response(
            track,
            play_counts.get(
                track.id,
                0,
            ),
        )
        for track in ranked_tracks[:10]
    ]

    new_releases = [
        _track_response(
            track,
            play_counts.get(
                track.id,
                0,
            ),
        )
        for track in tracks[:12]
    ]

    albums_by_key: dict[
        str,
        dict,
    ] = {}

    for track in tracks:
        album_title = (
            track.album.strip()
            if track.album
            and track.album.strip()
            else "Singles"
        )

        key = album_title.casefold()

        if key not in albums_by_key:
            albums_by_key[key] = {
                "title":
                    album_title,
                "track_count":
                    0,
                "artwork_url":
                    _track_artwork_url(
                        track,
                    ),
                "released_at":
                    track.created_at,
            }

        album = albums_by_key[key]
        album["track_count"] += 1

        if (
            not album["artwork_url"]
            and track.artwork_object_key
        ):
            album["artwork_url"] = (
                _track_artwork_url(
                    track,
                )
            )

        if (
            track.created_at
            > album["released_at"]
        ):
            album["released_at"] = (
                track.created_at
            )

    albums = [
        ArtistAlbumResponse(
            **album,
        )
        for album in sorted(
            albums_by_key.values(),
            key=lambda item:
                item["released_at"],
            reverse=True,
        )
    ]

    artwork_url = (
        _track_artwork_url(
            tracks[0],
        )
        if tracks
        else None
    )

    return ArtistProfileResponse(
        id=profile.id,
        name=profile.name,
        bio=profile.bio,
        artwork_url=artwork_url,
        followers_count=(
            followers_count
        ),
        is_following=is_following,
        track_count=len(
            tracks,
        ),
        album_count=len(
            albums,
        ),
        total_plays=total_plays,
        monthly_listeners=(
            monthly_listeners
        ),
        popular_tracks=popular_tracks,
        new_releases=new_releases,
        albums=albums,
    )


@router.get(
    "/{artist_name}",
    response_model=ArtistProfileResponse,
)
async def get_artist_profile(
    artist_name: str,
    session: DatabaseSession,
    viewer: OptionalCurrentUser,
) -> ArtistProfileResponse:
    profile = await _artist_entity(
        session,
        artist_name,
    )

    return await _artist_profile_response(
        session,
        profile,
        viewer,
    )


@router.post(
    "/{artist_name}/follow",
    response_model=ArtistProfileResponse,
)
async def follow_artist(
    artist_name: str,
    user: CurrentUser,
    session: DatabaseSession,
) -> ArtistProfileResponse:
    if (
        user.account_type
        != AccountType.REGISTERED
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "A registered account is required "
                "to follow artists."
            ),
        )

    profile = await _artist_entity(
        session,
        artist_name,
    )

    existing = await session.execute(
        select(
            ArtistFollow,
        ).where(
            ArtistFollow.user_id
            == user.id,
            ArtistFollow.artist_id
            == profile.id,
        )
    )

    if existing.scalar_one_or_none() is None:
        session.add(
            ArtistFollow(
                user_id=user.id,
                artist_id=profile.id,
            )
        )

        await session.commit()

    return await _artist_profile_response(
        session,
        profile,
        user,
    )


@router.delete(
    "/{artist_name}/follow",
    response_model=ArtistProfileResponse,
)
async def unfollow_artist(
    artist_name: str,
    user: CurrentUser,
    session: DatabaseSession,
) -> ArtistProfileResponse:
    if (
        user.account_type
        != AccountType.REGISTERED
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "A registered account is required "
                "to follow artists."
            ),
        )

    profile = await _artist_entity(
        session,
        artist_name,
    )

    existing = await session.execute(
        select(
            ArtistFollow,
        ).where(
            ArtistFollow.user_id
            == user.id,
            ArtistFollow.artist_id
            == profile.id,
        )
    )

    follow = existing.scalar_one_or_none()

    if follow is not None:
        await session.delete(
            follow,
        )
        await session.commit()

    return await _artist_profile_response(
        session,
        profile,
        user,
    )
