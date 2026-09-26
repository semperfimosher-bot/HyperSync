import asyncio
import logging
import mimetypes
from datetime import (
    UTC,
    datetime,
    timedelta,
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
    status,
)
from fastapi.responses import StreamingResponse
from pydantic import (
    BaseModel,
    Field,
)
from sqlalchemy import delete, func, select
from sqlalchemy.orm import selectinload

from ...config import get_settings
from ...database import get_session_factory
from ...models.account import (
    AccountType,
    ListeningEvent,
    PlaybackCommand,
    PlaybackDevice,
    User,
    UserAppState,
    UserFollow,
    UserProfile,
    UserRole,
)
from ...models.media import Track
from ...services.b2 import (
    create_presigned_download_url,
    delete_all_object_versions,
    get_b2_bucket,
)
from ..dependencies import (
    CurrentUser,
    DatabaseSession,
    OptionalCurrentUser,
)
from .audio import stream_b2_file
from .catalog import (
    _track_artwork_version,
    _track_media_version,
)

logger = logging.getLogger(__name__)


router = APIRouter(
    prefix="/users",
    tags=["users"],
)


PLAYBACK_DEVICE_ONLINE_TTL = timedelta(
    seconds=90,
)

PLAYBACK_DEVICE_LIST_LIMIT = 20

PLAYBACK_COMMAND_BATCH_LIMIT = 32


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

class PlaybackTrackResponse(
    BaseModel,
):
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


class PlaybackStateResponse(
    BaseModel,
):
    track: PlaybackTrackResponse | None = None

    position_seconds: float = 0.0

    paused: bool = True

    device_id: str | None = None

    updated_at: datetime | None = None


class PlaybackStateUpdateRequest(
    BaseModel,
):
    track_id: UUID | None = None

    position_seconds: float = Field(
        default=0.0,
        ge=0,
        le=86_400,
    )

    paused: bool = True

    device_id: str = Field(
        min_length=1,
        max_length=64,
    )


PlaybackDeviceKind = Literal[
    "desktop",
    "mobile",
    "tablet",
    "browser",
]


class PlaybackDevicePollRequest(
    BaseModel,
):
    device_id: str = Field(
        min_length=1,
        max_length=64,
    )

    name: str = Field(
        min_length=1,
        max_length=120,
    )

    device_type: PlaybackDeviceKind = (
        "browser"
    )


class PlaybackDeviceResponse(
    BaseModel,
):
    device_id: str

    name: str

    device_type: PlaybackDeviceKind

    is_online: bool

    is_active: bool

    last_seen_at: datetime


PlaybackRemoteAction = Literal[
    "play",
    "pause",
    "next",
    "previous",
    "seek",
    "volume",
    "transfer",
]


class PlaybackRemoteCommandRequest(
    BaseModel,
):
    source_device_id: str = Field(
        min_length=1,
        max_length=64,
    )

    action: PlaybackRemoteAction

    value: float | None = None


class PlaybackRemoteCommandResponse(
    BaseModel,
):
    id: UUID

    source_device_id: str

    target_device_id: str

    action: PlaybackRemoteAction

    value: float | None = None

    created_at: datetime


class PlaybackDevicePollResponse(
    BaseModel,
):
    devices: list[
        PlaybackDeviceResponse
    ]

    commands: list[
        PlaybackRemoteCommandResponse
    ]

    playback_state: PlaybackStateResponse


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


def presigned_or_fallback(
    object_key: str,
    fallback_url: str,
) -> str:
    try:
        return create_presigned_download_url(
            object_key,
        )

    except Exception:
        logger.exception(
            ("Unable to create presigned profile media URL for %s; using API fallback."),
            object_key,
        )

        return fallback_url


def audio_url(
    track: Track,
) -> str | None:
    if not track.b2_object_key:
        return None

    if track.b2_object_key.startswith(
        (
            "http://",
            "https://",
        ),
    ):
        return track.b2_object_key

    settings = get_settings()

    if settings.environment != "production":
        return f"/api/audio/{track.id}"

    return presigned_or_fallback(
        track.b2_object_key,
        f"/api/audio/{track.id}",
    )


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

    settings = get_settings()

    if settings.environment != "production":
        return f"/api/catalog/tracks/{track.id}/artwork"

    return presigned_or_fallback(
        track.artwork_object_key,
        (f"/api/catalog/tracks/{track.id}/artwork"),
    )


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


def require_registered_playback_user(
    user: User,
) -> None:
    if user.account_type != AccountType.REGISTERED:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="A registered account is required for playback sync.",
        )


def playback_track_response(
    track: Track,
) -> PlaybackTrackResponse:
    return PlaybackTrackResponse(
        id=track.id,
        title=track.title,
        artist=track.artist,
        album=track.album,
        duration_seconds=(
            track.duration_seconds
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
    )


async def build_playback_state(
    session: DatabaseSession,
    user: User,
) -> PlaybackStateResponse:
    state = await session.get(
        UserAppState,
        user.id,
    )

    if (
        state is None
        or state.playback_track_id
        is None
    ):
        return PlaybackStateResponse(
            position_seconds=0.0,
            paused=True,
            device_id=(
                state.playback_device_id
                if state is not None
                else None
            ),
            updated_at=(
                state.playback_updated_at
                if state is not None
                else None
            ),
        )

    track = await session.get(
        Track,
        state.playback_track_id,
    )

    if (
        track is None
        or not track.is_published
    ):
        return PlaybackStateResponse(
            position_seconds=0.0,
            paused=True,
            device_id=(
                state.playback_device_id
            ),
            updated_at=(
                state.playback_updated_at
            ),
        )

    return PlaybackStateResponse(
        track=playback_track_response(
            track,
        ),
        position_seconds=max(
            float(
                state.playback_position_seconds
                or 0.0
            ),
            0.0,
        ),
        paused=bool(
            state.playback_paused
        ),
        device_id=(
            state.playback_device_id
        ),
        updated_at=(
            state.playback_updated_at
        ),
    )


def playback_device_is_online(
    last_seen_at: datetime,
    *,
    now: datetime | None = None,
) -> bool:
    reference = (
        now
        if now is not None
        else datetime.now(
            UTC,
        )
    )

    normalized_last_seen = (
        last_seen_at
        if last_seen_at.tzinfo
        is not None
        else last_seen_at.replace(
            tzinfo=UTC,
        )
    )

    return (
        reference -
        normalized_last_seen
        <=
        PLAYBACK_DEVICE_ONLINE_TTL
    )


async def prune_offline_playback_devices(
    session: DatabaseSession,
    user: User,
    *,
    now: datetime | None = None,
) -> list[str]:
    reference = (
        now
        if now is not None
        else datetime.now(
            UTC,
        )
    )

    cutoff = (
        reference -
        PLAYBACK_DEVICE_ONLINE_TTL
    )

    stale_result = await session.execute(
        select(
            PlaybackDevice.device_id,
        ).where(
            PlaybackDevice.user_id
            == user.id,
            PlaybackDevice.last_seen_at
            < cutoff,
        )
    )

    stale_device_ids = [
        str(
            device_id,
        )
        for device_id in
        stale_result.scalars().all()
    ]

    if not stale_device_ids:
        return []

    await session.execute(
        delete(
            PlaybackCommand,
        ).where(
            PlaybackCommand.user_id
            == user.id,
            PlaybackCommand.target_device_id.in_(
                stale_device_ids,
            ),
        )
    )

    await session.execute(
        delete(
            PlaybackDevice,
        ).where(
            PlaybackDevice.user_id
            == user.id,
            PlaybackDevice.device_id.in_(
                stale_device_ids,
            ),
        )
    )

    return stale_device_ids


async def list_playback_devices(
    session: DatabaseSession,
    user: User,
    *,
    active_device_id: str | None,
    now: datetime | None = None,
) -> list[
    PlaybackDeviceResponse
]:
    reference = (
        now
        if now is not None
        else datetime.now(
            UTC,
        )
    )

    result = await session.execute(
        select(
            PlaybackDevice,
        )
        .where(
            PlaybackDevice.user_id
            == user.id,
            PlaybackDevice.last_seen_at
            >= (
                reference -
                PLAYBACK_DEVICE_ONLINE_TTL
            ),
        )
        .order_by(
            PlaybackDevice.last_seen_at.desc(),
        )
        .limit(
            PLAYBACK_DEVICE_LIST_LIMIT,
        )
    )

    devices = list(
        result.scalars().all()
    )

    return [
        PlaybackDeviceResponse(
            device_id=(
                device.device_id
            ),
            name=device.name,
            device_type=cast(
                PlaybackDeviceKind,
                device.device_type
                if device.device_type in {
                    "desktop",
                    "mobile",
                    "tablet",
                    "browser",
                }
                else "browser",
            ),
            is_online=(
                playback_device_is_online(
                    device.last_seen_at,
                    now=reference,
                )
            ),
            is_active=(
                active_device_id
                is not None
                and device.device_id
                == active_device_id
            ),
            last_seen_at=(
                device.last_seen_at
            ),
        )
        for device in devices
    ]


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
    )

    recently_played = [
        TrackSummary(
            id=track.id,
            title=track.title,
            artist=track.artist,
            album=track.album,
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

    state.playback_updated_at = (
        datetime.now(
            UTC,
        )
    )

    await session.commit()

    return await build_playback_state(
        session,
        user,
    )


@router.post(
    "/me/playback-devices/poll",
    response_model=PlaybackDevicePollResponse,
)
async def poll_my_playback_device(
    payload: PlaybackDevicePollRequest,
    user: CurrentUser,
    session: DatabaseSession,
):
    require_registered_playback_user(
        user,
    )

    now = datetime.now(
        UTC,
    )

    device = await session.get(
        PlaybackDevice,
        (
            user.id,
            payload.device_id,
        ),
    )

    if device is None:
        device = PlaybackDevice(
            user_id=user.id,
            device_id=(
                payload.device_id
            ),
            name=payload.name,
            device_type=(
                payload.device_type
            ),
            last_seen_at=now,
        )

        session.add(
            device,
        )

    else:
        device.name = payload.name
        device.device_type = (
            payload.device_type
        )
        device.last_seen_at = now

    await prune_offline_playback_devices(
        session,
        user,
        now=now,
    )

    commands_result = (
        await session.execute(
            select(
                PlaybackCommand,
            )
            .where(
                PlaybackCommand.user_id
                == user.id,
                PlaybackCommand.target_device_id
                == payload.device_id,
                PlaybackCommand.consumed_at.is_(
                    None,
                ),
            )
            .order_by(
                PlaybackCommand.created_at.asc(),
            )
            .limit(
                PLAYBACK_COMMAND_BATCH_LIMIT,
            )
        )
    )

    commands = list(
        commands_result.scalars().all()
    )

    for command in commands:
        command.consumed_at = now

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
                playback_state.device_id
            ),
            now=now,
        )
    )

    return PlaybackDevicePollResponse(
        devices=devices,
        commands=[
            PlaybackRemoteCommandResponse(
                id=command.id,
                source_device_id=(
                    command.source_device_id
                ),
                target_device_id=(
                    command.target_device_id
                ),
                action=cast(
                    PlaybackRemoteAction,
                    command.action,
                ),
                value=command.value,
                created_at=(
                    command.created_at
                ),
            )
            for command in commands
        ],
        playback_state=(
            playback_state
        ),
    )


@router.post(
    "/me/playback-devices/{target_device_id}/commands",
    response_model=PlaybackRemoteCommandResponse,
    status_code=status.HTTP_201_CREATED,
)
async def send_playback_device_command(
    target_device_id: str,
    payload: PlaybackRemoteCommandRequest,
    user: CurrentUser,
    session: DatabaseSession,
):
    require_registered_playback_user(
        user,
    )

    target = await session.get(
        PlaybackDevice,
        (
            user.id,
            target_device_id,
        ),
    )

    if target is None:
        raise HTTPException(
            status_code=(
                status.HTTP_404_NOT_FOUND
            ),
            detail=(
                "Playback device not found."
            ),
        )

    now = datetime.now(
        UTC,
    )

    if not playback_device_is_online(
        target.last_seen_at,
        now=now,
    ):
        await session.execute(
            delete(
                PlaybackCommand,
            ).where(
                PlaybackCommand.user_id
                == user.id,
                PlaybackCommand.target_device_id
                == target_device_id,
            )
        )

        await session.delete(
            target,
        )

        await session.commit()

        raise HTTPException(
            status_code=(
                status.HTTP_404_NOT_FOUND
            ),
            detail=(
                "Playback device not found."
            ),
        )

    value = payload.value

    if payload.action == "seek":
        if (
            value is None
            or value < 0
            or value > 86_400
        ):
            raise HTTPException(
                status_code=(
                    status.HTTP_400_BAD_REQUEST
                ),
                detail=(
                    "Seek commands require a "
                    "position between 0 and "
                    "86400 seconds."
                ),
            )

    elif payload.action == "volume":
        if (
            value is None
            or value < 0
            or value > 1
        ):
            raise HTTPException(
                status_code=(
                    status.HTTP_400_BAD_REQUEST
                ),
                detail=(
                    "Volume commands require "
                    "a value between 0 and 1."
                ),
            )

    else:
        value = None

    command = PlaybackCommand(
        user_id=user.id,
        target_device_id=(
            target_device_id
        ),
        source_device_id=(
            payload.source_device_id
        ),
        action=payload.action,
        value=value,
    )

    session.add(
        command,
    )

    if payload.action == "transfer":
        playback_state = (
            await session.get(
                UserAppState,
                user.id,
            )
        )

        previous_device_id = (
            playback_state
                .playback_device_id
            if playback_state
            is not None
            else None
        )

        if (
            previous_device_id
            and previous_device_id
            != target_device_id
        ):
            session.add(
                PlaybackCommand(
                    user_id=user.id,
                    target_device_id=(
                        previous_device_id
                    ),
                    source_device_id=(
                        payload
                            .source_device_id
                    ),
                    action="pause",
                )
            )

    await session.commit()

    await session.refresh(
        command,
    )

    return PlaybackRemoteCommandResponse(
        id=command.id,
        source_device_id=(
            command.source_device_id
        ),
        target_device_id=(
            command.target_device_id
        ),
        action=cast(
            PlaybackRemoteAction,
            command.action,
        ),
        value=command.value,
        created_at=(
            command.created_at
        ),
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
