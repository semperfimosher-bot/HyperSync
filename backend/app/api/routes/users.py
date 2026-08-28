from uuid import UUID

from fastapi import (
    APIRouter,
    HTTPException,
    status,
)
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from ...models.account import (
    ListeningEvent,
    User,
    UserFollow,
    UserProfile,
)
from ...models.media import Track
from ..dependencies import (
    CurrentUser,
    DatabaseSession,
)

router = APIRouter(
    prefix="/users",
    tags=["users"],
)


class ProfileUpdateRequest(BaseModel):
    display_name: str = Field(
        min_length=1,
        max_length=80,
    )

    bio: str | None = Field(
        default=None,
        max_length=500,
    )


class PrivacyUpdateRequest(BaseModel):
    is_public: bool


class ListeningRequest(BaseModel):
    track_id: UUID


class TrackSummary(BaseModel):
    id: UUID
    title: str
    artist: str
    album: str | None
    artwork_url: str | None = None


class ArtistSummary(BaseModel):
    artist: str
    plays: int


class ProfileDashboardResponse(BaseModel):
    id: UUID
    username: str
    display_name: str
    bio: str | None
    is_public: bool

    followers_count: int
    following_count: int
    tracks_played: int
    hours_listened: float

    recently_played: list[TrackSummary]
    top_artists: list[ArtistSummary]


def artwork_url(
    track: Track,
) -> str | None:
    if not track.artwork_object_key:
        return None

    if track.artwork_object_key.startswith(
        (
            "http://",
            "https://",
        ),
    ):
        return track.artwork_object_key

    return (
        f"/api/catalog/tracks/"
        f"{track.id}/artwork"
    )


async def build_dashboard(
    session: DatabaseSession,
    user: User,
) -> ProfileDashboardResponse:
    profile = user.profile

    if profile is None:
        profile = UserProfile(
            user_id=user.id,
            display_name=user.username or "User",
        )

        session.add(profile)
        await session.flush()

    followers_result = await session.execute(
        select(
            func.count(
                UserFollow.follower_id,
            )
        ).where(
            UserFollow.following_id == user.id,
        )
    )

    following_result = await session.execute(
        select(
            func.count(
                UserFollow.following_id,
            )
        ).where(
            UserFollow.follower_id == user.id,
        )
    )

    plays_result = await session.execute(
        select(
            func.count(
                ListeningEvent.id,
            )
        ).where(
            ListeningEvent.user_id == user.id,
        )
    )

    hours_result = await session.execute(
        select(
            func.coalesce(
                func.sum(
                    Track.duration_seconds,
                ),
                0,
            )
        )
        .select_from(ListeningEvent)
        .join(
            Track,
            Track.id
            == ListeningEvent.track_id,
        )
        .where(
            ListeningEvent.user_id == user.id,
        )
    )

    recent_result = await session.execute(
        select(Track)
        .join(
            ListeningEvent,
            ListeningEvent.track_id
            == Track.id,
        )
        .where(
            ListeningEvent.user_id == user.id,
        )
        .order_by(
            ListeningEvent.listened_at.desc(),
        )
        .limit(8)
    )

    top_artists_result = await session.execute(
        select(
            Track.artist,
            func.count(
                ListeningEvent.id,
            ).label("plays"),
        )
        .join(
            ListeningEvent,
            ListeningEvent.track_id
            == Track.id,
        )
        .where(
            ListeningEvent.user_id == user.id,
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
        .limit(5)
    )

    recently_played = [
        TrackSummary(
            id=track.id,
            title=track.title,
            artist=track.artist,
            album=track.album,
            artwork_url=artwork_url(track),
        )
        for track in recent_result.scalars().all()
    ]

    top_artists = [
        ArtistSummary(
            artist=artist,
            plays=plays,
        )
        for artist, plays
        in top_artists_result.all()
    ]

    total_seconds = (
        hours_result.scalar_one()
        or 0
    )

    return ProfileDashboardResponse(
        id=user.id,
        username=user.username or "",
        display_name=profile.display_name,
        bio=profile.bio,
        is_public=profile.is_public,
        followers_count=(
            followers_result.scalar_one()
            or 0
        ),
        following_count=(
            following_result.scalar_one()
            or 0
        ),
        tracks_played=(
            plays_result.scalar_one()
            or 0
        ),
        hours_listened=round(
            total_seconds / 3600,
            1,
        ),
        recently_played=recently_played,
        top_artists=top_artists,
    )


@router.get(
    "/me",
    response_model=ProfileDashboardResponse,
)
async def get_me(
    user: CurrentUser,
    session: DatabaseSession,
):
    return await build_dashboard(
        session,
        user,
    )


@router.patch(
    "/me/profile",
    response_model=ProfileDashboardResponse,
)
async def update_my_profile(
    payload: ProfileUpdateRequest,
    user: CurrentUser,
    session: DatabaseSession,
):
    profile = user.profile

    if profile is None:
        profile = UserProfile(
            user_id=user.id,
            display_name=payload.display_name.strip(),
            bio=payload.bio.strip()
            if payload.bio
            else None,
        )

        session.add(profile)
    else:
        profile.display_name = (
            payload.display_name.strip()
        )

        profile.bio = (
            payload.bio.strip()
            if payload.bio
            else None
        )

    await session.commit()

    await session.refresh(
        user,
        attribute_names=["profile"],
    )

    return await build_dashboard(
        session,
        user,
    )


@router.patch(
    "/me/privacy",
    response_model=ProfileDashboardResponse,
)
async def update_my_privacy(
    payload: PrivacyUpdateRequest,
    user: CurrentUser,
    session: DatabaseSession,
):
    profile = user.profile

    if profile is None:
        profile = UserProfile(
            user_id=user.id,
            display_name=user.username or "User",
        )

        session.add(profile)

    profile.is_public = payload.is_public

    await session.commit()

    await session.refresh(
        user,
        attribute_names=["profile"],
    )

    return await build_dashboard(
        session,
        user,
    )


@router.post(
    "/me/listening",
    status_code=status.HTTP_201_CREATED,
)
async def record_listening(
    payload: ListeningRequest,
    user: CurrentUser,
    session: DatabaseSession,
):
    track_result = await session.execute(
        select(Track).where(
            Track.id == payload.track_id,
            Track.is_published.is_(True),
        )
    )

    track = (
        track_result.scalar_one_or_none()
    )

    if track is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Track not found.",
        )

    session.add(
        ListeningEvent(
            user_id=user.id,
            track_id=track.id,
        )
    )

    await session.commit()

    return {
        "recorded": True,
        "track_id": str(track.id),
    }


@router.get(
    "/{username}",
    response_model=ProfileDashboardResponse,
)
async def get_public_profile(
    username: str,
    session: DatabaseSession,
):
    normalized = (
        username.strip()
        .lower()
    )

    result = await session.execute(
        select(User)
        .options(
            selectinload(User.profile),
        )
        .where(
            User.username_normalized
            == normalized,
            User.is_active.is_(True),
        )
    )

    user = result.scalar_one_or_none()

    if (
        user is None
        or user.profile is None
        or not user.profile.is_public
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Profile not found.",
        )

    return await build_dashboard(
        session,
        user,
    )


@router.post(
    "/{username}/follow",
)
async def follow_user(
    username: str,
    user: CurrentUser,
    session: DatabaseSession,
):
    normalized = (
        username.strip()
        .lower()
    )

    result = await session.execute(
        select(User).where(
            User.username_normalized
            == normalized,
            User.is_active.is_(True),
        )
    )

    target = (
        result.scalar_one_or_none()
    )

    if target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found.",
        )

    if target.id == user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot follow yourself.",
        )

    existing_result = await session.execute(
        select(UserFollow).where(
            UserFollow.follower_id
            == user.id,
            UserFollow.following_id
            == target.id,
        )
    )

    if (
        existing_result.scalar_one_or_none()
        is None
    ):
        session.add(
            UserFollow(
                follower_id=user.id,
                following_id=target.id,
            )
        )

        await session.commit()

    return {
        "following": True,
    }


@router.delete(
    "/{username}/follow",
)
async def unfollow_user(
    username: str,
    user: CurrentUser,
    session: DatabaseSession,
):
    normalized = (
        username.strip()
        .lower()
    )

    result = await session.execute(
        select(User).where(
            User.username_normalized
            == normalized,
        )
    )

    target = (
        result.scalar_one_or_none()
    )

    if target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found.",
        )

    follow_result = await session.execute(
        select(UserFollow).where(
            UserFollow.follower_id
            == user.id,
            UserFollow.following_id
            == target.id,
        )
    )

    follow = (
        follow_result.scalar_one_or_none()
    )

    if follow is not None:
        await session.delete(follow)
        await session.commit()

    return {
        "following": False,
    }
