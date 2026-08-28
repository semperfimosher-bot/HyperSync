import asyncio
import mimetypes
from datetime import datetime
from uuid import UUID, uuid4

from fastapi import (
    APIRouter,
    File,
    HTTPException,
    UploadFile,
    status,
)
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from ...config import get_settings
from ...database import get_session_factory
from ...models.account import (
    ListeningEvent,
    User,
    UserFollow,
    UserProfile,
)
from ...models.media import Track
from ...services.b2 import (
    delete_all_object_versions,
    get_b2_bucket,
)
from ..dependencies import (
    CurrentUser,
    DatabaseSession,
)
from .audio import stream_b2_file

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

    play_count: int
    last_played_at: datetime


class ArtistSummary(BaseModel):
    artist: str
    plays: int


class UserSearchResult(BaseModel):
    username: str
    display_name: str
    bio: str | None
    avatar_url: str | None = None


class ProfileDashboardResponse(BaseModel):
    id: UUID
    username: str
    display_name: str
    bio: str | None
    avatar_url: str | None = None
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

    return f"/api/catalog/tracks/{track.id}/artwork"


def avatar_url(
    user: User,
) -> str | None:
    if user.profile is None or not user.profile.avatar_object_key:
        return None

    return f"/api/users/{user.username}/avatar"


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
            Track.id == ListeningEvent.track_id,
        )
        .where(
            ListeningEvent.user_id == user.id,
        )
    )

    recent_summary = (
        select(
            ListeningEvent.track_id.label(
                "track_id",
            ),
            func.count(
                ListeningEvent.id,
            ).label(
                "play_count",
            ),
            func.max(
                ListeningEvent.listened_at,
            ).label(
                "last_played_at",
            ),
        )
        .where(
            ListeningEvent.user_id == user.id,
        )
        .group_by(
            ListeningEvent.track_id,
        )
        .subquery()
    )

    recent_result = await session.execute(
        select(
            Track,
            recent_summary.c.play_count,
            recent_summary.c.last_played_at,
        )
        .join(
            recent_summary,
            recent_summary.c.track_id == Track.id,
        )
        .order_by(
            recent_summary.c.last_played_at.desc(),
        )
        .limit(8)
    )

    recently_played = [
        TrackSummary(
            id=track.id,
            title=track.title,
            artist=track.artist,
            album=track.album,
            artwork_url=artwork_url(track),
            play_count=play_count,
            last_played_at=last_played_at,
        )
        for (
            track,
            play_count,
            last_played_at,
        ) in recent_result.all()
    ]

    top_artists_result = await session.execute(
        select(
            Track.artist,
            func.count(
                ListeningEvent.id,
            ).label("plays"),
        )
        .join(
            ListeningEvent,
            ListeningEvent.track_id == Track.id,
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

    top_artists = [
        ArtistSummary(
            artist=artist,
            plays=plays,
        )
        for artist, plays in top_artists_result.all()
    ]

    total_seconds = hours_result.scalar_one() or 0

    return ProfileDashboardResponse(
        id=user.id,
        username=user.username or "",
        display_name=profile.display_name,
        bio=profile.bio,
        avatar_url=avatar_url(user),
        is_public=profile.is_public,
        followers_count=(followers_result.scalar_one() or 0),
        following_count=(following_result.scalar_one() or 0),
        tracks_played=(plays_result.scalar_one() or 0),
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
            bio=payload.bio.strip() if payload.bio else None,
        )

        session.add(profile)
    else:
        profile.display_name = payload.display_name.strip()

        profile.bio = payload.bio.strip() if payload.bio else None

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

    track = track_result.scalar_one_or_none()

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


@router.post(
    "/me/avatar",
    response_model=ProfileDashboardResponse,
)
async def upload_my_avatar(
    user: CurrentUser,
    session: DatabaseSession,
    file: UploadFile = File(...),
):
    if file.content_type not in {
        "image/jpeg",
        "image/png",
        "image/webp",
    }:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=("Profile picture must be a JPG, PNG, or WebP image."),
        )

    image_data = await file.read()

    if not image_data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Profile picture is empty.",
        )

    if len(image_data) > 5 * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=("Profile picture must be 5 MB or smaller."),
        )

    profile = user.profile

    if profile is None:
        profile = UserProfile(
            user_id=user.id,
            display_name=user.username or "User",
        )

        session.add(profile)
        await session.flush()

    old_object_key = profile.avatar_object_key

    settings = get_settings()

    extension = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
    }[file.content_type]

    object_key = f"{settings.b2_profile_prefix}/{user.id}/{uuid4()}.{extension}"

    bucket = get_b2_bucket()

    try:
        await asyncio.to_thread(
            bucket.upload_bytes,
            image_data,
            object_key,
            content_type=file.content_type,
        )

        profile.avatar_object_key = object_key

        await session.commit()

    except Exception as exc:
        await session.rollback()

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=(f"Failed to upload profile picture: {exc}"),
        ) from exc

    if old_object_key:
        try:
            await delete_all_object_versions(
                bucket,
                old_object_key,
            )
        except Exception:
            pass

    await session.refresh(
        user,
        attribute_names=["profile"],
    )

    return await build_dashboard(
        session,
        user,
    )


@router.get(
    "/{username}/avatar",
)
async def get_user_avatar(
    username: str,
):
    normalized = username.strip().lower()

    session_factory = get_session_factory()

    async with session_factory() as session:
        result = await session.execute(
            select(User)
            .options(
                selectinload(
                    User.profile,
                ),
            )
            .where(
                User.username_normalized == normalized,
                User.is_active.is_(True),
            )
        )

        target = result.scalar_one_or_none()

    if target is None or target.profile is None or not target.profile.avatar_object_key:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Profile picture not found.",
        )

    object_key = target.profile.avatar_object_key

    try:
        bucket = get_b2_bucket()

        downloaded = await asyncio.to_thread(
            bucket.download_file_by_name,
            object_key,
        )

        content_type, _ = mimetypes.guess_type(
            object_key,
        )

        if not content_type:
            content_type = "image/jpeg"

        return StreamingResponse(
            stream_b2_file(
                downloaded,
            ),
            media_type=content_type,
            headers={
                "Cache-Control": ("public, max-age=300, stale-while-revalidate=600"),
            },
        )

    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=(f"Profile picture unavailable: {exc}"),
        ) from exc


@router.get(
    "/search",
    response_model=list[UserSearchResult],
)
async def search_users(
    q: str,
    session: DatabaseSession,
):
    term = q.strip()

    if not term:
        return []

    pattern = f"%{term}%"

    result = await session.execute(
        select(User)
        .join(
            UserProfile,
            UserProfile.user_id == User.id,
        )
        .options(
            selectinload(
                User.profile,
            ),
        )
        .where(
            User.is_active.is_(True),
            UserProfile.is_public.is_(True),
            (
                User.username.ilike(pattern)
                | UserProfile.display_name.ilike(
                    pattern,
                )
            ),
        )
        .order_by(
            UserProfile.display_name.asc(),
        )
        .limit(20)
    )

    users = result.scalars().all()

    return [
        UserSearchResult(
            username=user.username or "",
            display_name=(user.profile.display_name if user.profile else user.username or ""),
            bio=(user.profile.bio if user.profile else None),
            avatar_url=avatar_url(user),
        )
        for user in users
    ]


@router.get(
    "/{username}",
    response_model=ProfileDashboardResponse,
)
async def get_public_profile(
    username: str,
    session: DatabaseSession,
):
    normalized = username.strip().lower()

    result = await session.execute(
        select(User)
        .options(
            selectinload(User.profile),
        )
        .where(
            User.username_normalized == normalized,
            User.is_active.is_(True),
        )
    )

    user = result.scalar_one_or_none()

    if user is None or user.profile is None or not user.profile.is_public:
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
    normalized = username.strip().lower()

    result = await session.execute(
        select(User).where(
            User.username_normalized == normalized,
            User.is_active.is_(True),
        )
    )

    target = result.scalar_one_or_none()

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
            UserFollow.follower_id == user.id,
            UserFollow.following_id == target.id,
        )
    )

    if existing_result.scalar_one_or_none() is None:
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
    normalized = username.strip().lower()

    result = await session.execute(
        select(User).where(
            User.username_normalized == normalized,
        )
    )

    target = result.scalar_one_or_none()

    if target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found.",
        )

    follow_result = await session.execute(
        select(UserFollow).where(
            UserFollow.follower_id == user.id,
            UserFollow.following_id == target.id,
        )
    )

    follow = follow_result.scalar_one_or_none()

    if follow is not None:
        await session.delete(follow)
        await session.commit()

    return {
        "following": False,
    }
