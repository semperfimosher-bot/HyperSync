import asyncio
import logging
import mimetypes
from datetime import (
    UTC,
    datetime,
)
from typing import (
    Annotated,
    Literal,
    cast,
)
from uuid import UUID, uuid4

from fastapi import (
    APIRouter,
    File,
    HTTPException,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from fastapi.responses import StreamingResponse
from pydantic import (
    BaseModel,
    Field,
    ValidationError,
)
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from ...config import get_settings
from ...database import get_session_factory
from ...models.account import (
    ListeningEvent,
    PlaybackDevice,
    User,
    UserAppState,
    UserFollow,
    UserProfile,
    UserRole,
)
from ...models.media import Track
from ...services.b2 import (
    delete_all_object_versions,
    get_b2_bucket,
)
from ...services.playback import (
    PLAYBACK_DEVICE_LIST_LIMIT,
    PLAYBACK_DEVICE_ONLINE_TTL,
    build_account_playback_queue,
    build_playback_state,
    list_playback_devices,
    playback_device_is_online,
    playback_queue_track_response,
    playback_track_response,
    poll_playback_device,
    prune_offline_playback_devices,
    require_registered_playback_user,
    send_playback_device_command,
    touch_playback_device,
)
from ...services.playback_realtime import (
    playback_realtime_hub,
)
from ...services.track_urls import (
    artwork_url,
    audio_url,
    presigned_or_fallback,
)
from ..dependencies import (
    CurrentUser,
    DatabaseSession,
    OptionalCurrentUser,
    authenticate_access_token,
)
from ..schemas.playback import (
    PlaybackDeviceKind,
    PlaybackDevicePollRequest,
    PlaybackDevicePollResponse,
    PlaybackDeviceResponse,
    PlaybackRemoteAction,
    PlaybackRemoteCommandRequest,
    PlaybackRemoteCommandResponse,
    PlaybackStateResponse,
    PlaybackStateUpdateRequest,
    PlaybackTrackResponse,
)
from .audio import stream_b2_file
from .catalog import (
    _track_artwork_version,
    _track_media_version,
)

logger = logging.getLogger(__name__)

__all__ = [
    "PLAYBACK_DEVICE_LIST_LIMIT",
    "PLAYBACK_DEVICE_ONLINE_TTL",
    "list_playback_devices",
    "playback_device_is_online",
    "prune_offline_playback_devices",
    "touch_playback_device",
    "PlaybackDeviceKind",
    "PlaybackDevicePollRequest",
    "PlaybackDevicePollResponse",
    "PlaybackDeviceResponse",
    "PlaybackRemoteAction",
    "PlaybackRemoteCommandRequest",
    "PlaybackRemoteCommandResponse",
    "PlaybackStateResponse",
    "PlaybackStateUpdateRequest",
    "PlaybackTrackResponse",
    "artwork_url",
    "audio_url",
    "build_account_playback_queue",
    "build_playback_state",
    "playback_queue_track_response",
    "playback_track_response",
    "presigned_or_fallback",
    "require_registered_playback_user",
]


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
    music_activity_public: bool


AppPage = Literal[
    "home",
    "search",
    "library",
    "messages",
    "profile",
    "public-profile",
    "admin",
    "admin-bot",
    "admin-uploads",
    "admin-catalog",
]

VALID_APP_PAGES: set[AppPage] = {
    "home",
    "search",
    "library",
    "messages",
    "profile",
    "public-profile",
    "admin",
    "admin-bot",
    "admin-uploads",
    "admin-catalog",
}

ADMIN_APP_PAGES: set[AppPage] = {
    "admin",
    "admin-bot",
    "admin-uploads",
    "admin-catalog",
}


class AppStateResponse(BaseModel):
    active_page: AppPage

    search_query: str = ""

    profile_username: str | None = None


class AppStateUpdateRequest(
    BaseModel,
):
    active_page: AppPage

    search_query: str = Field(
        default="",
        max_length=200,
    )

    profile_username: str | None = Field(
        default=None,
        max_length=32,
    )

class ListeningOutcomeRequest(
    BaseModel,
):
    outcome: Literal[
        "completed",
        "skipped",
    ]

    position_seconds: int = Field(
        default=0,
        ge=0,
        le=86_400,
    )

class ListeningRequest(BaseModel):
    track_id: UUID


class TrackSummary(BaseModel):
    id: UUID
    title: str
    artist: str
    album: str | None
    genre: str | None = None
    release_year: int | None = None
    audio_url: str | None = None
    artwork_url: str | None = None

    mime_type: str | None = None
    file_size: int | None = None
    media_version: str | None = None
    artwork_version: str | None = None

    play_count: int
    last_played_at: datetime


class ArtistSummary(BaseModel):
    artist: str
    plays: int


class UserSearchResult(BaseModel):
    username: str
    display_name: str
    avatar_url: str | None = None
    followers_count: int
    member_since: datetime


class ConnectionSummary(BaseModel):
    username: str
    display_name: str
    avatar_url: str | None = None
    followers_count: int
    member_since: datetime


class ProfileDashboardResponse(BaseModel):
    id: UUID
    username: str
    display_name: str
    role: str
    bio: str | None
    avatar_url: str | None = None

    music_activity_public: bool
    member_since: datetime

    followers_count: int
    following_count: int
    pending_requests_count: int

    tracks_played: int
    hours_listened: float

    recently_played: list[TrackSummary]
    top_artists: list[ArtistSummary]


class PublicProfileResponse(BaseModel):
    id: UUID
    username: str
    display_name: str
    avatar_url: str | None = None

    followers_count: int
    member_since: datetime

    music_activity_public: bool
    can_view_activity: bool

    follow_status: Literal[
        "none",
        "pending",
        "accepted",
        "self",
    ]

    bio: str | None = None
    following_count: int | None = None
    tracks_played: int | None = None
    hours_listened: float | None = None

    recently_played: list[TrackSummary]
    top_artists: list[ArtistSummary]


def avatar_url(
    user: User,
) -> str | None:
    if user.profile is None or not user.profile.avatar_object_key:
        return None

    return f"/api/users/{user.username}/avatar"


async def get_user_by_username(
    session: DatabaseSession,
    username: str,
) -> User | None:
    normalized = username.strip().lower()

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

    return result.scalar_one_or_none()


def default_app_state() -> AppStateResponse:
    return AppStateResponse(
        active_page="home",
        search_query="",
        profile_username=None,
    )


async def build_app_state(
    session: DatabaseSession,
    user: User,
) -> AppStateResponse:
    state = await session.get(
        UserAppState,
        user.id,
    )

    if state is None:
        return default_app_state()

    if state.active_page not in VALID_APP_PAGES:
        return default_app_state()

    active_page = cast(
        AppPage,
        state.active_page,
    )

    if active_page in ADMIN_APP_PAGES and user.role != UserRole.ADMIN:
        return default_app_state()

    profile_username = state.profile_username

    if active_page == "public-profile":
        if not profile_username:
            return default_app_state()

        target = await get_user_by_username(
            session,
            profile_username,
        )

        if target is None:
            return default_app_state()

    else:
        profile_username = None

    return AppStateResponse(
        active_page=active_page,
        search_query=(state.search_query or ""),
        profile_username=(profile_username),
    )


async def accepted_followers_count(
    session: DatabaseSession,
    user_id: UUID,
) -> int:
    result = await session.execute(
        select(
            func.count(
                UserFollow.follower_id,
            )
        ).where(
            UserFollow.following_id == user_id,
            UserFollow.accepted_at.is_not(None),
        )
    )

    return result.scalar_one() or 0


async def connection_summary(
    session: DatabaseSession,
    user: User,
) -> ConnectionSummary:
    return ConnectionSummary(
        username=user.username or "",
        display_name=(user.profile.display_name if user.profile else user.username or "User"),
        avatar_url=avatar_url(user),
        followers_count=await accepted_followers_count(
            session,
            user.id,
        ),
        member_since=user.created_at,
    )


async def follow_status_for(
    session: DatabaseSession,
    viewer: User | None,
    target: User,
) -> Literal[
    "none",
    "pending",
    "accepted",
    "self",
]:
    if viewer is None:
        return "none"

    if viewer.id == target.id:
        return "self"

    result = await session.execute(
        select(UserFollow).where(
            UserFollow.follower_id == viewer.id,
            UserFollow.following_id == target.id,
        )
    )

    relationship = result.scalar_one_or_none()

    if relationship is None:
        return "none"

    if relationship.accepted_at is None:
        return "pending"

    return "accepted"


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
            UserFollow.accepted_at.is_not(None),
        )
    )

    following_result = await session.execute(
        select(
            func.count(
                UserFollow.following_id,
            )
        ).where(
            UserFollow.follower_id == user.id,
            UserFollow.accepted_at.is_not(None),
        )
    )

    pending_result = await session.execute(
        select(
            func.count(
                UserFollow.follower_id,
            )
        ).where(
            UserFollow.following_id == user.id,
            UserFollow.accepted_at.is_(None),
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
        .limit(12)
    )

    recently_played = [
        TrackSummary(
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
            audio_url=audio_url(
                track,
            ),
            artwork_url=artwork_url(
                track,
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
            ).label(
                "plays",
            ),
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
        for (
            artist,
            plays,
        ) in top_artists_result.all()
    ]

    total_seconds = hours_result.scalar_one() or 0

    return ProfileDashboardResponse(
        id=user.id,
        username=user.username or "",
        display_name=profile.display_name,
        role=user.role.value,
        bio=profile.bio,
        avatar_url=avatar_url(user),
        music_activity_public=(profile.music_activity_public),
        member_since=user.created_at,
        followers_count=(followers_result.scalar_one() or 0),
        following_count=(following_result.scalar_one() or 0),
        pending_requests_count=(pending_result.scalar_one() or 0),
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
    display_name = payload.display_name.strip()

    if not display_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=("Display name cannot be empty."),
        )

    profile = user.profile

    if profile is None:
        profile = UserProfile(
            user_id=user.id,
            display_name=display_name,
            bio=(payload.bio.strip() if payload.bio else None),
        )

        session.add(profile)

    else:
        profile.display_name = display_name

        profile.bio = payload.bio.strip() if payload.bio else None

    await session.commit()

    await session.refresh(
        user,
        attribute_names=[
            "profile",
        ],
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
            display_name=(user.username or "User"),
        )

        session.add(profile)

    profile.music_activity_public = payload.music_activity_public

    # Accounts themselves remain discoverable.
    profile.is_public = True

    await session.commit()

    await session.refresh(
        user,
        attribute_names=[
            "profile",
        ],
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
            Track.is_published.is_(
                True,
            ),
        )
    )

    track = (
        track_result
        .scalar_one_or_none()
    )

    if track is None:
        raise HTTPException(
            status_code=(
                status.HTTP_404_NOT_FOUND
            ),
            detail="Track not found.",
        )


    event = ListeningEvent(
        user_id=user.id,
        track_id=track.id,
    )

    session.add(
        event,
    )

    await session.flush()

    event_id = event.id

    await session.commit()

    await playback_realtime_hub.broadcast(
        user.id,
        {
            "type":
                "listening_history_changed",
            "track_id":
                str(
                    track.id,
                ),
        },
    )


    return {
        "recorded": True,

        "event_id": str(
            event_id,
        ),

        "track_id": str(
            track.id,
        ),
    }

@router.patch(
    "/me/listening/{event_id}",
)
async def finish_listening(
    event_id: UUID,
    payload: ListeningOutcomeRequest,
    user: CurrentUser,
    session: DatabaseSession,
):
    event = await session.get(
        ListeningEvent,
        event_id,
    )

    if (
        event is None
        or event.user_id != user.id
    ):
        raise HTTPException(
            status_code=404,
            detail="Listening event not found.",
        )

    track = await session.get(
        Track,
        event.track_id,
    )

    if track is None:
        raise HTTPException(
            status_code=404,
            detail="Track not found.",
        )


    duration = max(
        int(
            track.duration_seconds
            or 0
        ),
        0,
    )

    position = max(
        int(
            payload.position_seconds
        ),
        0,
    )

    if duration > 0:
        position = min(
            position,
            duration,
        )

        ratio = min(
            position / duration,
            1.0,
        )
    else:
        ratio = None

     # A user hitting Next at 98% should
     # not be punished like someone
     # skipping after 5 seconds.
     
    completed = (
        payload.outcome
        == "completed"
        and (
            ratio is None
            or ratio >= 0.85
        )
    )

    skipped = (
        payload.outcome
        == "skipped"
        and (
            ratio is None
            or ratio < 0.90
        )
    )


    event.progress_seconds = (
        position
    )

    event.completion_ratio = (
        ratio
    )

    event.completed = (
        completed
    )

    event.skipped = (
        skipped
    )

    event.ended_at = (
        datetime.now(
            UTC,
        )
    )


    await session.commit()


    return {
        "completed":
            completed,

        "skipped":
            skipped,

        "completion_ratio":
            ratio,
    }

@router.post(
    "/me/avatar",
    response_model=ProfileDashboardResponse,
)
async def upload_my_avatar(
    user: CurrentUser,
    session: DatabaseSession,
    file: Annotated[
        UploadFile,
        File(),
    ],
):
    allowed_types = {
        "image/jpeg",
        "image/png",
        "image/webp",
    }

    if file.content_type not in allowed_types:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=("Profile picture must be a JPG, PNG, or WebP image."),
        )

    image_data = await file.read()

    if not image_data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=("Profile picture is empty."),
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
            display_name=(user.username or "User"),
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
            content_type=(file.content_type),
        )

        profile.avatar_object_key = object_key

        await session.commit()

    except Exception as exc:
        await session.rollback()

        raise HTTPException(
            status_code=(status.HTTP_500_INTERNAL_SERVER_ERROR),
            detail=("Failed to upload profile picture."),
        ) from exc

    if old_object_key:
        try:
            await delete_all_object_versions(
                bucket,
                old_object_key,
            )
        except Exception:
            logger.warning(
                "Failed to clean up old profile avatar %s",
                old_object_key,
                exc_info=True,
            )

    await session.refresh(
        user,
        attribute_names=[
            "profile",
        ],
    )

    return await build_dashboard(
        session,
        user,
    )


@router.delete(
    "/me/avatar",
    response_model=ProfileDashboardResponse,
)
async def remove_my_avatar(
    user: CurrentUser,
    session: DatabaseSession,
):
    profile = user.profile

    if profile is None or not profile.avatar_object_key:
        return await build_dashboard(
            session,
            user,
        )

    object_key = profile.avatar_object_key

    profile.avatar_object_key = None

    await session.commit()

    try:
        bucket = get_b2_bucket()

        await delete_all_object_versions(
            bucket,
            object_key,
        )

    except Exception:
        logger.warning(
            "Failed to clean up removed profile avatar %s",
            object_key,
            exc_info=True,
        )

    await session.refresh(
        user,
        attribute_names=[
            "profile",
        ],
    )

    return await build_dashboard(
        session,
        user,
    )


@router.get(
    "/me/follow-requests",
    response_model=list[ConnectionSummary],
)
async def get_follow_requests(
    user: CurrentUser,
    session: DatabaseSession,
):
    result = await session.execute(
        select(User)
        .join(
            UserFollow,
            UserFollow.follower_id == User.id,
        )
        .options(
            selectinload(
                User.profile,
            ),
        )
        .where(
            UserFollow.following_id == user.id,
            UserFollow.accepted_at.is_(
                None,
            ),
            User.is_active.is_(True),
        )
        .order_by(
            UserFollow.created_at.desc(),
        )
    )

    requesters = result.scalars().all()

    return [
        await connection_summary(
            session,
            requester,
        )
        for requester in requesters
    ]


@router.post(
    "/me/follow-requests/{username}/accept",
)
async def accept_follow_request(
    username: str,
    user: CurrentUser,
    session: DatabaseSession,
):
    requester = await get_user_by_username(
        session,
        username,
    )

    if requester is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found.",
        )

    result = await session.execute(
        select(UserFollow).where(
            UserFollow.follower_id == requester.id,
            UserFollow.following_id == user.id,
            UserFollow.accepted_at.is_(
                None,
            ),
        )
    )

    relationship = result.scalar_one_or_none()

    if relationship is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=("Follow request not found."),
        )

    relationship.accepted_at = datetime.now(UTC)

    await session.commit()

    return {
        "status": "accepted",
    }


@router.delete(
    "/me/follow-requests/{username}",
)
async def decline_follow_request(
    username: str,
    user: CurrentUser,
    session: DatabaseSession,
):
    requester = await get_user_by_username(
        session,
        username,
    )

    if requester is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found.",
        )

    result = await session.execute(
        select(UserFollow).where(
            UserFollow.follower_id == requester.id,
            UserFollow.following_id == user.id,
            UserFollow.accepted_at.is_(
                None,
            ),
        )
    )

    relationship = result.scalar_one_or_none()

    if relationship is not None:
        await session.delete(
            relationship,
        )

        await session.commit()

    return {
        "status": "declined",
    }


@router.get(
    "/me/app-state",
    response_model=AppStateResponse,
)
async def get_my_app_state(
    user: CurrentUser,
    session: DatabaseSession,
):
    return await build_app_state(
        session,
        user,
    )


@router.patch(
    "/me/app-state",
    response_model=AppStateResponse,
)
async def update_my_app_state(
    payload: AppStateUpdateRequest,
    user: CurrentUser,
    session: DatabaseSession,
):
    if payload.active_page in ADMIN_APP_PAGES and user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=(status.HTTP_403_FORBIDDEN),
            detail=("Administrator access is required for this page."),
        )

    profile_username = payload.profile_username.strip() if payload.profile_username else None

    if payload.active_page == "public-profile":
        if not profile_username:
            raise HTTPException(
                status_code=(status.HTTP_400_BAD_REQUEST),
                detail=("A profile username is required."),
            )

        target = await get_user_by_username(
            session,
            profile_username,
        )

        if target is None:
            raise HTTPException(
                status_code=(status.HTTP_404_NOT_FOUND),
                detail=("Profile not found."),
            )

        profile_username = target.username

    else:
        profile_username = None

    app_state = await session.get(
        UserAppState,
        user.id,
    )

    if app_state is None:
        app_state = UserAppState(
            user_id=user.id,
        )

        session.add(
            app_state,
        )

    app_state.active_page = payload.active_page

    app_state.search_query = payload.search_query

    app_state.profile_username = profile_username

    await session.commit()

    return AppStateResponse(
        active_page=(payload.active_page),
        search_query=(app_state.search_query),
        profile_username=(app_state.profile_username),
    )


@router.get(
    "/me/playback-state",
    response_model=PlaybackStateResponse,
)
async def get_my_playback_state(
    user: CurrentUser,
    session: DatabaseSession,
):
    require_registered_playback_user(
        user,
    )

    return await build_playback_state(
        session,
        user,
    )


@router.patch(
    "/me/playback-state",
    response_model=PlaybackStateResponse,
)
async def update_my_playback_state(
    payload: PlaybackStateUpdateRequest,
    user: CurrentUser,
    session: DatabaseSession,
):
    require_registered_playback_user(
        user,
    )

    track = None

    if payload.track_id is not None:
        result = await session.execute(
            select(
                Track,
            ).where(
                Track.id == payload.track_id,
                Track.is_published.is_(
                    True,
                ),
            )
        )

        track = (
            result.scalar_one_or_none()
        )

        if track is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Track not found.",
            )

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

    elif (
        state.playback_device_id
        and state.playback_device_id
        != payload.device_id
    ):
        active_device = await session.get(
            PlaybackDevice,
            (
                user.id,
                state.playback_device_id,
            ),
        )

        if (
            active_device is not None
            and (
                playback_device_is_online(
                    active_device.last_seen_at,
                )
                or await playback_realtime_hub
                .is_connected(
                    user.id,
                    state.playback_device_id,
                )
            )
        ):
            # Another live device currently owns audio output.
            # Ignore stale progress/pause writes from the old
            # controller so a completed handoff cannot be
            # stolen back.
            return await build_playback_state(
                session,
                user,
            )

    position = max(
        float(
            payload.position_seconds
        ),
        0.0,
    )

    if (
        track is not None
        and track.duration_seconds
        is not None
        and track.duration_seconds > 0
    ):
        position = min(
            position,
            float(
                track.duration_seconds
            ),
        )

    if track is None:
        position = 0.0

    state.playback_track_id = (
        track.id
        if track is not None
        else None
    )

    state.playback_position_seconds = (
        position
    )

    state.playback_paused = (
        True
        if track is None
        else payload.paused
    )

    state.playback_device_id = (
        payload.device_id
    )

    queue_ids = [
        str(
            queue_id,
        )
        for queue_id
        in payload.queue_track_ids[:500]
    ]

    queue_index = (
        payload.queue_index
        if (
            payload.queue_index
            is not None
            and payload.queue_index
            < len(
                queue_ids,
            )
        )
        else None
    )

    if track is None:
        queue_ids = []
        queue_index = None
    else:
        track_id_value = str(
            track.id,
        )

        if not queue_ids:
            queue_ids = [
                track_id_value,
            ]
            queue_index = 0
        elif (
            queue_index is None
            or queue_ids[
                queue_index
            ]
            != track_id_value
        ):
            try:
                queue_index = (
                    queue_ids.index(
                        track_id_value,
                    )
                )
            except ValueError:
                queue_ids.insert(
                    0,
                    track_id_value,
                )
                queue_ids = (
                    queue_ids[:500]
                )
                queue_index = 0

    state.playback_queue_track_ids = (
        queue_ids
    )

    state.playback_queue_index = (
        queue_index
    )

    state.playback_updated_at = (
        datetime.now(
            UTC,
        )
    )

    await session.commit()

    playback_state = (
        await build_playback_state(
            session,
            user,
        )
    )

    await playback_realtime_hub.broadcast(
        user.id,
        {
            "type": "playback_state",
            "playback_state":
                playback_state.model_dump(
                    mode="json",
                ),
        },
    )

    return playback_state


@router.post(
    "/me/playback-devices/poll",
    response_model=PlaybackDevicePollResponse,
)
async def poll_my_playback_device(
    payload: PlaybackDevicePollRequest,
    user: CurrentUser,
    session: DatabaseSession,
):
    return await poll_playback_device(
        payload,
        user,
        session,
    )


@router.websocket(
    "/me/playback-devices/live",
)
async def live_playback_device(
    websocket: WebSocket,
):
    await websocket.accept()

    user: User | None = None
    device_id = ""
    registered_socket = False

    # WebSocket playback updates are high-frequency client events.
    # Keep realtime delivery responsive without turning every playback
    # tick into a database write.
    last_playback_persist_at = 0.0
    last_playback_track_id: UUID | None = None
    last_playback_position = 0.0
    last_playback_paused = True
    last_playback_queue_signature: tuple[str, ...] = ()

    try:
        try:
            auth_message = await asyncio.wait_for(
                websocket.receive_json(),
                timeout=5,
            )
        except TimeoutError:
            await websocket.close(
                code=4408,
            )
            return

        if (
            not isinstance(
                auth_message,
                dict,
            )
            or auth_message.get(
                "type",
            ) != "authenticate"
        ):
            await websocket.close(
                code=4401,
            )
            return

        token = str(
            auth_message.get(
                "access_token",
                "",
            )
        ).strip()

        device_id = str(
            auth_message.get(
                "device_id",
                "",
            )
        ).strip()

        name = str(
            auth_message.get(
                "name",
                "",
            )
        ).strip()

        device_type = str(
            auth_message.get(
                "device_type",
                "browser",
            )
        ).strip()

        if (
            not token
            or not device_id
            or len(
                device_id,
            ) > 64
            or not name
            or len(
                name,
            ) > 120
            or device_type
            not in {
                "desktop",
                "mobile",
                "tablet",
                "browser",
            }
        ):
            await websocket.close(
                code=4401,
            )
            return

        session_factory = (
            get_session_factory()
        )

        async with session_factory() as session:
            try:
                user = (
                    await authenticate_access_token(
                        session,
                        token,
                    )
                )
            except HTTPException:
                await websocket.close(
                    code=4401,
                )
                return

            try:
                require_registered_playback_user(
                    user,
                )
            except HTTPException:
                await websocket.close(
                    code=4403,
                )
                return

            now = datetime.now(
                UTC,
            )

            await touch_playback_device(
                session,
                user,
                device_id=device_id,
                name=name,
                device_type=cast(
                    PlaybackDeviceKind,
                    device_type,
                ),
                now=now,
            )

            await prune_offline_playback_devices(
                session,
                user,
                now=now,
            )

            await session.commit()

            playback_state = (
                await build_playback_state(
                    session,
                    user,
                )
            )

            devices = (
                await list_playback_devices(
                    session,
                    user,
                    active_device_id=(
                        playback_state
                        .device_id
                    ),
                    now=now,
                )
            )

        await playback_realtime_hub.connect(
            user.id,
            device_id,
            websocket,
        )

        registered_socket = True

        await websocket.send_json(
            {
                "type": "ready",
                "devices": [
                    device.model_dump(
                        mode="json",
                    )
                    for device in devices
                ],
                "playback_state":
                    playback_state.model_dump(
                        mode="json",
                    ),
            }
        )

        await playback_realtime_hub.broadcast(
            user.id,
            {
                "type":
                    "presence_changed",
            },
            exclude_device_id=(
                device_id
            ),
        )

        while True:
            # Do not expire an authenticated playback socket just
            # because its JavaScript heartbeat was throttled.
            # Mobile browsers commonly suspend timers while the
            # screen is locked or another app is foregrounded.
            # The WebSocket itself remains the strongest presence
            # signal and disconnect cleanup handles a real close.
            message = (
                await websocket.receive_json()
            )

            if not isinstance(
                message,
                dict,
            ):
                continue

            message_type = str(
                message.get(
                    "type",
                    "",
                )
            ).strip()

            if message_type == "command":
                request_id = str(
                    message.get(
                        "request_id",
                        "",
                    )
                ).strip()[:96]

                target_device_id = str(
                    message.get(
                        "target_device_id",
                        "",
                    )
                ).strip()

                try:
                    if (
                        not request_id
                        or not target_device_id
                        or len(
                            target_device_id,
                        ) > 64
                    ):
                        raise ValueError(
                            "Invalid realtime playback command.",
                        )

                    command_payload = (
                        PlaybackRemoteCommandRequest(
                            source_device_id=(
                                device_id
                            ),
                            action=cast(
                                PlaybackRemoteAction,
                                message.get("action"),
                            ),
                            value=message.get(
                                "value",
                            ),
                            track_id=message.get(
                                "track_id",
                            ),
                            queue_track_ids=(
                                message.get(
                                    "queue_track_ids",
                                )
                                or []
                            ),
                            queue_index=message.get(
                                "queue_index",
                            ),
                            position_seconds=message.get(
                                "position_seconds",
                            ),
                            paused=message.get(
                                "paused",
                            ),
                        )
                    )

                    async with session_factory() as session:
                        command_response = (
                            await send_playback_device_command(
                                target_device_id,
                                command_payload,
                                user,
                                session,
                            )
                        )

                    await websocket.send_json(
                        {
                            "type":
                                "command_ack",
                            "request_id":
                                request_id,
                            "command":
                                command_response.model_dump(
                                    mode="json",
                                ),
                        }
                    )

                except ValidationError as exc:
                    await websocket.send_json(
                        {
                            "type":
                                "command_error",
                            "request_id":
                                request_id,
                            "status":
                                400,
                            "detail":
                                "Invalid playback command.",
                        }
                    )

                    logger.debug(
                        "Rejected realtime playback command: %s",
                        exc,
                    )

                except HTTPException as exc:
                    await websocket.send_json(
                        {
                            "type":
                                "command_error",
                            "request_id":
                                request_id,
                            "status":
                                exc.status_code,
                            "detail":
                                str(
                                    exc.detail,
                                ),
                        }
                    )

                except ValueError as exc:
                    await websocket.send_json(
                        {
                            "type":
                                "command_error",
                            "request_id":
                                request_id,
                            "status":
                                400,
                            "detail":
                                str(
                                    exc,
                                ),
                        }
                    )

                continue

            if message_type == "playback_state":
                try:
                    state_payload = (
                        PlaybackStateUpdateRequest(
                            track_id=message.get(
                                "track_id",
                            ),
                            position_seconds=message.get(
                                "position_seconds",
                                0,
                            ),
                            paused=message.get(
                                "paused",
                                True,
                            ),
                            queue_track_ids=(
                                message.get(
                                    "queue_track_ids",
                                )
                                or []
                            ),
                            queue_index=message.get(
                                "queue_index",
                            ),
                            device_id=device_id,
                        )
                    )

                    queue_signature = tuple(
                        str(value)
                        for value in state_payload.queue_track_ids
                    )
                    position = max(
                        float(state_payload.position_seconds or 0),
                        0.0,
                    )
                    now_monotonic = asyncio.get_running_loop().time()
                    state_changed = (
                        state_payload.track_id != last_playback_track_id
                        or bool(state_payload.paused) != last_playback_paused
                        or queue_signature != last_playback_queue_signature
                        or abs(position - last_playback_position) >= 2.0
                    )
                    due_for_persist = (
                        now_monotonic - last_playback_persist_at >= 2.0
                    )

                    if state_changed or due_for_persist:
                        async with session_factory() as session:
                            await update_my_playback_state(
                                state_payload,
                                user,
                                session,
                            )

                        last_playback_persist_at = now_monotonic
                        last_playback_track_id = state_payload.track_id
                        last_playback_position = position
                        last_playback_paused = bool(state_payload.paused)
                        last_playback_queue_signature = queue_signature

                except ValidationError:
                    logger.debug(
                        "Rejected invalid realtime playback state for %s",
                        device_id,
                    )

                except HTTPException:
                    logger.debug(
                        "Rejected realtime playback state for %s",
                        device_id,
                    )

                continue

            # A live WebSocket is the authoritative heartbeat for
            # connected devices. Avoid a database session and write
            # every time the client's 15-second heartbeat arrives.
            if message_type == "heartbeat":
                continue

            if message_type != "presence":
                continue

            async with session_factory() as session:
                now = datetime.now(
                    UTC,
                )

                await touch_playback_device(
                    session,
                    user,
                    device_id=device_id,
                    name=name,
                    device_type=cast(
                        PlaybackDeviceKind,
                        device_type,
                    ),
                    now=now,
                )

                await prune_offline_playback_devices(
                    session,
                    user,
                    now=now,
                )

                await session.commit()

    except WebSocketDisconnect:
        pass
    except RuntimeError as exc:
        # A peer can close a socket between Starlette's receive
        # bookkeeping and the next receive/send operation. Treat that
        # as an ordinary disconnect instead of logging a noisy server
        # exception or turning it into an application error.
        logger.debug(
            "Realtime playback socket closed during receive: %s",
            exc,
        )
    finally:
        should_cleanup = (
            user is not None
            and registered_socket
            and bool(
                device_id,
            )
        )

        is_current_socket = False

        if should_cleanup and user is not None:
            is_current_socket = (
                await playback_realtime_hub.disconnect(
                    user.id,
                    device_id,
                    websocket,
                )
            )

        if (
            should_cleanup
            and user is not None
            and is_current_socket
        ):
            # A socket close can be temporary: Vite reloads,
            # Wi-Fi changes, mobile backgrounding, and normal
            # reconnects all create short disconnect windows.
            #
            # Do not delete the shared playback_devices row here.
            # HTTP polling may already be refreshing that same
            # device, which previously raced this DELETE and
            # produced SQLAlchemy StaleDataError. The existing
            # background-tolerant presence TTL removes truly
            # offline devices and releases playback ownership.
            await playback_realtime_hub.broadcast(
                user.id,
                {
                    "type":
                        "presence_changed",
                },
            )


@router.post(
    "/me/playback-devices/{target_device_id}/commands",
    response_model=PlaybackRemoteCommandResponse,
    status_code=status.HTTP_201_CREATED,
)
async def send_my_playback_device_command(
    target_device_id: str,
    payload: PlaybackRemoteCommandRequest,
    user: CurrentUser,
    session: DatabaseSession,
):
    return await send_playback_device_command(
        target_device_id,
        payload,
        user,
        session,
    )


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
        .outerjoin(
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
            (
                User.username.ilike(
                    pattern,
                )
                | UserProfile.display_name.ilike(
                    pattern,
                )
            ),
        )
        .order_by(
            User.username.asc(),
        )
        .limit(20)
    )

    users = result.scalars().all()

    return [
        UserSearchResult(
            username=(found_user.username or ""),
            display_name=(
                found_user.profile.display_name
                if found_user.profile
                else found_user.username or "User"
            ),
            avatar_url=avatar_url(
                found_user,
            ),
            followers_count=(
                await accepted_followers_count(
                    session,
                    found_user.id,
                )
            ),
            member_since=(found_user.created_at),
        )
        for found_user in users
    ]


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
                User.is_active.is_(
                    True,
                ),
            )
        )

        target = result.scalar_one_or_none()

    if target is None or target.profile is None or not target.profile.avatar_object_key:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=("Profile picture not found."),
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
            status_code=(status.HTTP_500_INTERNAL_SERVER_ERROR),
            detail=("Profile picture unavailable."),
        ) from exc


@router.get(
    "/{username}/followers",
    response_model=list[ConnectionSummary],
)
async def get_followers(
    username: str,
    session: DatabaseSession,
):
    target = await get_user_by_username(
        session,
        username,
    )

    if target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found.",
        )

    result = await session.execute(
        select(User)
        .join(
            UserFollow,
            UserFollow.follower_id == User.id,
        )
        .options(
            selectinload(
                User.profile,
            ),
        )
        .where(
            UserFollow.following_id == target.id,
            UserFollow.accepted_at.is_not(
                None,
            ),
            User.is_active.is_(True),
        )
        .order_by(
            User.username.asc(),
        )
        .limit(100)
    )

    users = result.scalars().all()

    return [
        await connection_summary(
            session,
            found_user,
        )
        for found_user in users
    ]


@router.get(
    "/{username}/following",
    response_model=list[ConnectionSummary],
)
async def get_following(
    username: str,
    session: DatabaseSession,
):
    target = await get_user_by_username(
        session,
        username,
    )

    if target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found.",
        )

    result = await session.execute(
        select(User)
        .join(
            UserFollow,
            UserFollow.following_id == User.id,
        )
        .options(
            selectinload(
                User.profile,
            ),
        )
        .where(
            UserFollow.follower_id == target.id,
            UserFollow.accepted_at.is_not(
                None,
            ),
            User.is_active.is_(True),
        )
        .order_by(
            User.username.asc(),
        )
        .limit(100)
    )

    users = result.scalars().all()

    return [
        await connection_summary(
            session,
            found_user,
        )
        for found_user in users
    ]


@router.get(
    "/{username}",
    response_model=PublicProfileResponse,
)
async def get_public_profile(
    username: str,
    session: DatabaseSession,
    viewer: OptionalCurrentUser,
):
    target = await get_user_by_username(
        session,
        username,
    )

    if target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Profile not found.",
        )

    dashboard = await build_dashboard(
        session,
        target,
    )

    relationship_status = await follow_status_for(
        session,
        viewer,
        target,
    )

    profile = target.profile

    activity_public = bool(profile and profile.music_activity_public)

    can_view_activity = (
        relationship_status
        in {
            "self",
            "accepted",
        }
        or activity_public
    )

    return PublicProfileResponse(
        id=target.id,
        username=(target.username or ""),
        display_name=(profile.display_name if profile else target.username or "User"),
        avatar_url=avatar_url(
            target,
        ),
        followers_count=(dashboard.followers_count),
        member_since=(target.created_at),
        music_activity_public=(activity_public),
        can_view_activity=(can_view_activity),
        follow_status=(relationship_status),
        bio=(dashboard.bio if can_view_activity else None),
        following_count=(dashboard.following_count if can_view_activity else None),
        tracks_played=(dashboard.tracks_played if can_view_activity else None),
        hours_listened=(dashboard.hours_listened if can_view_activity else None),
        recently_played=(dashboard.recently_played if can_view_activity else []),
        top_artists=(dashboard.top_artists if can_view_activity else []),
    )


@router.post(
    "/{username}/follow",
)
async def follow_user(
    username: str,
    user: CurrentUser,
    session: DatabaseSession,
):
    target = await get_user_by_username(
        session,
        username,
    )

    if target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found.",
        )

    if target.id == user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=("You cannot follow yourself."),
        )

    result = await session.execute(
        select(UserFollow).where(
            UserFollow.follower_id == user.id,
            UserFollow.following_id == target.id,
        )
    )

    existing = result.scalar_one_or_none()

    if existing is not None:
        return {
            "status": ("accepted" if existing.accepted_at else "pending"),
        }

    session.add(
        UserFollow(
            follower_id=user.id,
            following_id=target.id,
            accepted_at=None,
        )
    )

    await session.commit()

    return {
        "status": "pending",
    }


@router.delete(
    "/{username}/follow",
)
async def unfollow_user(
    username: str,
    user: CurrentUser,
    session: DatabaseSession,
):
    target = await get_user_by_username(
        session,
        username,
    )

    if target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found.",
        )

    result = await session.execute(
        select(UserFollow).where(
            UserFollow.follower_id == user.id,
            UserFollow.following_id == target.id,
        )
    )

    relationship = result.scalar_one_or_none()

    if relationship is not None:
        await session.delete(
            relationship,
        )

        await session.commit()

    return {
        "status": "none",
    }
