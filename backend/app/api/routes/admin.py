import asyncio
import base64
import hmac
from io import BytesIO
from pathlib import Path
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, File, Form, HTTPException, Query, Response, UploadFile, status
from mutagen._file import File as MutagenFile
from pydantic import BaseModel
from mutagen.flac import Picture
from sqlalchemy import select, text
from sqlalchemy.orm import selectinload

from bot.service import get_state

from ...config import get_settings
from ...models import (
    Base,
    SystemResetState,
)
from ...models.account import (
    AccountType,
    User,
    UserProfile,
)
from ...models.media import Track
from ...services.audio_compression import (
    AudioProbe,
    compress_audio_for_storage,
    should_attempt_audio_compression,
)
from ...services.artists import (
    ensure_artist_profile,
)
from ...services.audio_metadata import (
    extract_embedded_audio_metadata,
    normalize_track_identity,
    resolve_track_metadata,
)
from ...services.b2 import (
    create_presigned_upload_url,
    delete_all_bucket_versions,
    delete_all_object_versions,
    get_b2_bucket,
    head_b2_object,
)
from ...services.generated_playlists import (
    ensure_artist_playlist,
)
from ..dependencies import AdminUser, DatabaseSession

router = APIRouter(
    prefix="/admin",
    tags=["administration"],
)


async def _lock_track_upload_identity(
    session: DatabaseSession,
    *,
    title: str,
    artist: str,
) -> None:
    bind = session.get_bind()

    if (
        bind is None
        or bind.dialect.name
        != "postgresql"
    ):
        return

    identity = (
        normalize_track_identity(
            artist,
        )
        + "\x1f"
        + normalize_track_identity(
            title,
        )
    )

    await session.execute(
        text(
            "SELECT "
            "pg_advisory_xact_lock("
            "hashtext(:identity)"
            ")"
        ),
        {
            "identity":
                identity,
        },
    )


def _duplicate_track_groups(
    tracks: list[Track],
) -> list[dict]:
    groups: dict[
        tuple[str, str],
        list[Track],
    ] = {}

    for track in tracks:
        key = (
            normalize_track_identity(
                track.artist,
            ),
            normalize_track_identity(
                track.title,
            ),
        )

        groups.setdefault(
            key,
            [],
        ).append(
            track,
        )

    duplicates: list[dict] = []

    for (
        artist_key,
        title_key,
    ), grouped_tracks in groups.items():
        if len(grouped_tracks) < 2:
            continue

        first = grouped_tracks[0]

        duplicates.append(
            {
                "artist_key":
                    artist_key,
                "title_key":
                    title_key,
                "artist":
                    first.artist,
                "title":
                    first.title,
                "count":
                    len(
                        grouped_tracks,
                    ),
                "tracks": [
                    {
                        "id":
                            str(
                                item.id,
                            ),
                        "title":
                            item.title,
                        "artist":
                            item.artist,
                        "album":
                            item.album,
                        "b2_object_key":
                            item.b2_object_key,
                    }
                    for item in grouped_tracks
                ],
            }
        )

    duplicates.sort(
        key=lambda group: (
            -int(
                group["count"],
            ),
            str(
                group["artist_key"],
            ),
            str(
                group["title_key"],
            ),
        )
    )

    return duplicates


async def _find_duplicate_track(
    session: DatabaseSession,
    *,
    title: str,
    artist: str,
) -> Track | None:
    title_key = (
        normalize_track_identity(
            title,
        )
    )

    artist_key = (
        normalize_track_identity(
            artist,
        )
    )

    result = (
        await session.execute(
            select(
                Track,
            )
        )
    )

    for track in (
        result
        .scalars()
        .all()
    ):
        if (
            normalize_track_identity(
                track.title,
            )
            == title_key
            and
            normalize_track_identity(
                track.artist,
            )
            == artist_key
        ):
            return track

    return None


ADMIN_DATABASE_DELETE_CONFIRMATION = (
    "DELETE ALL DATA"
)


class PrepareDirectTrackUploadRequest(
    BaseModel,
):
    filename: str
    mime_type: str
    file_size: int
    duration_seconds: int
    title: str
    artist: str
    album: str | None = None
    genre: str | None = None
    release_year: int | None = None
    estimated_bitrate_kbps: float | None = None


class CancelDirectTrackUploadRequest(
    BaseModel,
):
    object_key: str


class BulkTrackDeleteRequest(
    BaseModel,
):
    track_ids: list[UUID]


def _direct_upload_extension(
    filename: str,
) -> str:
    suffix = (
        Path(
            filename,
        )
        .suffix
        .lower()
        .removeprefix(
            ".",
        )
    )

    return (
        suffix
        if suffix
        in {
            "aac",
            "flac",
            "m4a",
            "mp3",
            "ogg",
            "wav",
        }
        else "audio"
    )


def _direct_upload_is_safe(
    payload: PrepareDirectTrackUploadRequest,
) -> bool:
    settings = get_settings()

    if (
        not settings
        .b2_direct_upload_enabled
    ):
        return False

    if (
        payload.file_size <= 0
        or payload.duration_seconds
        <= 0
        or not payload.mime_type
        .lower()
        .startswith(
            "audio/",
        )
    ):
        return False

    if (
        not settings
        .audio_compression_enabled
    ):
        return True

    bitrate = (
        payload
        .estimated_bitrate_kbps
    )

    if (
        bitrate is None
        or bitrate <= 0
    ):
        return False

    return not (
        should_attempt_audio_compression(
            filename=payload.filename,
            probe=AudioProbe(
                codec=None,
                bitrate_kbps=(
                    bitrate
                ),
                duration_seconds=float(
                    payload
                    .duration_seconds,
                ),
                channels=None,
            ),
            original_size=(
                payload.file_size
            ),
            min_source_kbps=(
                settings
                .audio_compression_min_source_kbps
            ),
        )
    )


def _valid_release_year(
    value: int | None,
) -> int | None:
    if value is None:
        return None

    year = int(
        value,
    )

    return (
        year
        if 1900
        <= year
        <= 2100
        else None
    )


def _validate_prepared_audio_key(
    object_key: str,
) -> None:
    settings = get_settings()

    expected_prefix = (
        settings.b2_audio_prefix
        .strip("/")
        + "/"
    )

    if (
        not object_key
        .startswith(
            expected_prefix,
        )
    ):
        raise HTTPException(
            status_code=(
                status.HTTP_400_BAD_REQUEST
            ),
            detail=(
                "Invalid prepared audio object key."
            ),
        )


class DeleteAllDatabaseDataRequest(
    BaseModel,
):
    password: str

    confirmation: str


async def _delete_all_database_rows(
    session: DatabaseSession,
) -> tuple[
    dict[str, int],
    int,
]:
    deleted_rows: dict[
        str,
        int,
    ] = {}

    try:
        for table in reversed(
            Base.metadata.sorted_tables,
        ):
            if (
                table.name
                ==
                "system_reset_state"
            ):
                continue

            result = (
                await session.execute(
                    table.delete(),
                )
            )

            rowcount = getattr(
                result,
                "rowcount",
                None,
            )

            deleted_rows[
                table.name
            ] = max(
                int(
                    rowcount
                    if rowcount
                    is not None
                    else 0
                ),
                0,
            )

        reset_state = (
            await session.get(
                SystemResetState,
                1,
            )
        )

        if reset_state is None:
            reset_state = (
                SystemResetState(
                    id=1,
                    generation=0,
                )
            )

            session.add(
                reset_state,
            )

            await session.flush()

        reset_state.generation = (
            int(
                reset_state.generation
                or 0
            )
            + 1
        )

        generation = int(
            reset_state.generation,
        )

        await session.commit()

    except Exception:
        await session.rollback()

        raise

    return (
        deleted_rows,
        generation,
    )


@router.get("/access")
async def check_admin_access(
    user: AdminUser,
):
    return {
        "authorized": True,
        "user_id": str(user.id),
        "username": user.username,
        "role": user.role.value,
        "message": "Administrator access granted.",
    }


async def _delete_admin_selected_user(
    session: DatabaseSession,
    target: User,
) -> int:
    avatar_object_key = (
        target.profile.avatar_object_key
        if target.profile is not None
        else None
    )

    deleted_avatar_versions = 0

    if avatar_object_key:
        try:
            bucket = get_b2_bucket()

            deleted_avatar_versions = (
                await delete_all_object_versions(
                    bucket,
                    avatar_object_key,
                )
            )

        except Exception as exc:
            await session.rollback()

            raise HTTPException(
                status_code=(
                    status.HTTP_500_INTERNAL_SERVER_ERROR
                ),
                detail=(
                    "Unable to remove the user's "
                    "avatar data from B2. "
                    "The account was not deleted."
                ),
            ) from exc

    try:
        await session.delete(
            target,
        )

        await session.commit()

    except Exception as exc:
        await session.rollback()

        raise HTTPException(
            status_code=(
                status.HTTP_500_INTERNAL_SERVER_ERROR
            ),
            detail=(
                "Unable to delete the user account "
                "and related database data."
            ),
        ) from exc

    return deleted_avatar_versions


@router.get(
    "/users",
)
async def admin_search_users(
    q: str,
    user: AdminUser,
    session: DatabaseSession,
):
    term = q.strip()

    if not term:
        return {
            "users": [],
        }

    pattern = (
        f"%{term}%"
    )

    result = await session.execute(
        select(
            User,
        )
        .outerjoin(
            UserProfile,
            UserProfile.user_id
            == User.id,
        )
        .options(
            selectinload(
                User.profile,
            ),
        )
        .where(
            User.account_type
            == AccountType.REGISTERED,
            (
                User.username.ilike(
                    pattern,
                )
                | User.email.ilike(
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
        .limit(
            50,
        )
    )

    users = (
        result.scalars().all()
    )

    return {
        "users": [
            {
                "id":
                    str(
                        found.id,
                    ),
                "username":
                    found.username
                    or "",
                "email":
                    found.email
                    or "",
                "display_name":
                    (
                        found.profile.display_name
                        if found.profile
                        else found.username
                        or "User"
                    ),
                "role":
                    found.role.value,
                "active":
                    bool(
                        found.is_active,
                    ),
                "member_since":
                    (
                        found.created_at.isoformat()
                        if found.created_at
                        else None
                    ),
                "has_avatar":
                    bool(
                        found.profile
                        and found.profile.avatar_object_key
                    ),
                "is_current_admin":
                    found.id
                    == user.id,
            }
            for found in users
        ],
    }


@router.delete(
    "/users/{user_id}",
)
async def admin_delete_user(
    user_id: UUID,
    user: AdminUser,
    session: DatabaseSession,
):
    if user_id == user.id:
        raise HTTPException(
            status_code=(
                status.HTTP_400_BAD_REQUEST
            ),
            detail=(
                "You cannot delete the admin "
                "account currently signed in."
            ),
        )

    result = await session.execute(
        select(
            User,
        )
        .options(
            selectinload(
                User.profile,
            ),
        )
        .where(
            User.id
            == user_id,
        )
    )

    target = (
        result.scalar_one_or_none()
    )

    if target is None:
        raise HTTPException(
            status_code=(
                status.HTTP_404_NOT_FOUND
            ),
            detail=(
                "User account not found."
            ),
        )

    username = (
        target.username
        or str(
            target.id,
        )
    )

    deleted_avatar_versions = (
        await _delete_admin_selected_user(
            session,
            target,
        )
    )

    return {
        "success": True,
        "username":
            username,
        "deleted_avatar_versions":
            deleted_avatar_versions,
        "message": (
            "User account, sessions, profile, "
            "follows, playlists, saved playlists, "
            "listening history, app state, and "
            "profile avatar data were deleted."
        ),
    }


@router.get(
    "/diagnostics",
)
async def admin_diagnostics(
    user: AdminUser,
    session: DatabaseSession,
):
    database_status = {
        "healthy": False,
        "message":
            "Database unavailable.",
    }

    catalog_status = {
        "healthy": False,
        "track_count": 0,
        "duplicate_groups": 0,
    }

    storage_status = {
        "healthy": False,
        "message":
            "B2 storage unavailable.",
    }

    tracks: list[Track] = []

    try:
        await session.execute(
            text(
                "SELECT 1"
            )
        )

        database_status = {
            "healthy": True,
            "message":
                "Database query succeeded.",
        }

        result = await session.execute(
            select(
                Track,
            )
        )

        tracks = list(
            result.scalars().all()
        )

        duplicate_groups = (
            _duplicate_track_groups(
                tracks,
            )
        )

        catalog_status = {
            "healthy": True,
            "track_count":
                len(
                    tracks,
                ),
            "duplicate_groups":
                len(
                    duplicate_groups,
                ),
        }

    except Exception as exc:
        await session.rollback()

        database_status[
            "message"
        ] = str(
            exc,
        )

    try:
        bucket = await asyncio.to_thread(
            get_b2_bucket,
        )

        storage_status = {
            "healthy": True,
            "message":
                (
                    "Connected to "
                    f"{getattr(bucket, 'name', 'B2 bucket')}."
                ),
        }

    except Exception as exc:
        storage_status[
            "message"
        ] = str(
            exc,
        )

    bot_state = get_state()

    return {
        "api": {
            "healthy": True,
            "message":
                "Admin API is responding.",
        },
        "database":
            database_status,
        "storage":
            storage_status,
        "catalog":
            catalog_status,
        "bot": {
            "healthy": True,
            "running":
                bool(
                    bot_state.running,
                ),
            "status":
                bot_state.status,
            "current_job":
                bot_state.current_job,
            "queued_jobs":
                bot_state.queued_jobs,
            "completed_jobs":
                bot_state.completed_jobs,
            "failed_jobs":
                bot_state.failed_jobs,
        },
    }


@router.get(
    "/duplicates",
)
async def scan_catalog_duplicates(
    user: AdminUser,
    session: DatabaseSession,
):
    result = await session.execute(
        select(
            Track,
        )
    )

    tracks = list(
        result.scalars().all()
    )

    duplicate_groups = (
        _duplicate_track_groups(
            tracks,
        )
    )

    return {
        "scanned_tracks":
            len(
                tracks,
            ),
        "duplicate_group_count":
            len(
                duplicate_groups,
            ),
        "duplicate_track_count":
            sum(
                int(
                    group["count"],
                )
                for group
                in duplicate_groups
            ),
        "groups":
            duplicate_groups,
    }


@router.post(
    "/database/delete-all",
)
async def delete_all_database_data(
    payload: DeleteAllDatabaseDataRequest,
    response: Response,
    user: AdminUser,
    session: DatabaseSession,
):
    """
    Permanently delete every file version
    from the configured B2 bucket, then
    delete every application row from the
    database.

    The database schema and Alembic
    migration state are intentionally
    preserved.
    """

    settings = get_settings()

    configured_password = (
        settings
        .admin_database_delete_password
        .strip()
    )

    if not configured_password:
        raise HTTPException(
            status_code=(
                status.HTTP_503_SERVICE_UNAVAILABLE
            ),
            detail=(
                "Admin database deletion password "
                "is not configured."
            ),
        )

    password_ok = (
        hmac.compare_digest(
            payload.password,
            configured_password,
        )
    )

    confirmation_ok = (
        payload.confirmation
        ==
        ADMIN_DATABASE_DELETE_CONFIRMATION
    )

    if (
        not password_ok
        or not confirmation_ok
    ):
        raise HTTPException(
            status_code=(
                status.HTTP_403_FORBIDDEN
            ),
            detail=(
                "Invalid database deletion "
                "verification."
            ),
        )

    bucket = get_b2_bucket()

    try:
        deleted_b2_versions = (
            await delete_all_bucket_versions(
                bucket,
            )
        )

    except Exception as exc:
        await session.rollback()

        raise HTTPException(
            status_code=(
                status.HTTP_500_INTERNAL_SERVER_ERROR
            ),
            detail=(
                "Failed to delete every "
                f"B2 file version: {exc}. "
                "Database data was not wiped."
            ),
        ) from exc

    try:
        (
            deleted_rows,
            reset_generation,
        ) = (
            await _delete_all_database_rows(
                session,
            )
        )

    except Exception as exc:
        raise HTTPException(
            status_code=(
                status.HTTP_500_INTERNAL_SERVER_ERROR
            ),
            detail=(
                "B2 files were deleted, but "
                "the database wipe failed: "
                f"{exc}"
            ),
        ) from exc

    response.delete_cookie(
        key="hypersync_refresh",
        path="/api/auth",
    )

    return {
        "success": True,
        "deleted_rows":
            deleted_rows,
        "deleted_row_count":
            sum(
                deleted_rows.values()
            ),
        "deleted_b2_versions":
            deleted_b2_versions,
        "reset_generation":
            reset_generation,
        "message": (
            "All application database data "
            "and every B2 file version were "
            "permanently deleted. Database "
            "schema and migrations remain."
        ),
    }


@router.post(
    "/tracks/upload/prepare",
)
async def prepare_direct_track_upload(
    payload: PrepareDirectTrackUploadRequest,
    user: AdminUser,
    session: DatabaseSession,
):
    title = payload.title.strip()
    artist = payload.artist.strip()

    if (
        not title
        or not artist
    ):
        raise HTTPException(
            status_code=(
                status.HTTP_400_BAD_REQUEST
            ),
            detail=(
                "Title and artist are required."
            ),
        )

    duplicate = (
        await _find_duplicate_track(
            session,
            title=title,
            artist=artist,
        )
    )

    if duplicate is not None:
        raise HTTPException(
            status_code=(
                status.HTTP_409_CONFLICT
            ),
            detail=(
                "Duplicate track prevented: "
                f'\"{duplicate.title}\" by '
                f"{duplicate.artist} already "
                "exists in the catalog."
            ),
        )

    if not _direct_upload_is_safe(
        payload,
    ):
        return {
            "direct_upload":
                False,
            "reason":
                "backend-processing-required",
        }

    settings = get_settings()

    object_key = (
        f"{settings.b2_audio_prefix}/"
        f"{uuid4()}."
        f"{_direct_upload_extension(payload.filename)}"
    )

    try:
        upload_url = (
            create_presigned_upload_url(
                object_key,
                content_type=(
                    payload.mime_type
                ),
            )
        )

    except Exception:
        return {
            "direct_upload":
                False,
            "reason":
                "direct-upload-unavailable",
        }

    return {
        "direct_upload":
            True,
        "object_key":
            object_key,
        "upload_url":
            upload_url,
        "content_type":
            payload.mime_type,
        "expires_in_seconds":
            max(
                60,
                min(
                    int(
                        settings
                        .b2_direct_upload_ttl_seconds
                    ),
                    60 * 60,
                ),
            ),
    }


@router.post(
    "/tracks/upload/cancel",
)
async def cancel_direct_track_upload(
    payload: CancelDirectTrackUploadRequest,
    user: AdminUser,
):
    _validate_prepared_audio_key(
        payload.object_key,
    )

    bucket = get_b2_bucket()

    try:
        deleted_versions = (
            await delete_all_object_versions(
                bucket,
                payload.object_key,
            )
        )

    except Exception:
        deleted_versions = 0

    return {
        "success": True,
        "deleted_versions":
            deleted_versions,
    }


@router.post(
    "/tracks/upload/finalize",
)
async def finalize_direct_track_upload(
    object_key: Annotated[
        str,
        Form(...),
    ],
    title: Annotated[
        str,
        Form(...),
    ],
    artist: Annotated[
        str,
        Form(...),
    ],
    album: Annotated[
        str,
        Form(...),
    ],
    genre: Annotated[
        str,
        Form(...),
    ],
    duration_seconds: Annotated[
        int,
        Form(...),
    ],
    mime_type: Annotated[
        str,
        Form(...),
    ],
    original_file_size: Annotated[
        int,
        Form(...),
    ],
    user: AdminUser,
    session: DatabaseSession,
    release_year: Annotated[
        int | None,
        Form(),
    ] = None,
    artwork: Annotated[
        UploadFile | None,
        File(),
    ] = None,
):
    _validate_prepared_audio_key(
        object_key,
    )

    clean_title = title.strip()
    clean_artist = artist.strip()

    if (
        not clean_title
        or not clean_artist
    ):
        raise HTTPException(
            status_code=(
                status.HTTP_400_BAD_REQUEST
            ),
            detail=(
                "Title and artist are required."
            ),
        )

    bucket = get_b2_bucket()

    cleanup_audio = True
    artwork_object_key = None

    try:
        try:
            object_info = (
                await asyncio.to_thread(
                    head_b2_object,
                    object_key,
                )
            )

        except Exception as exc:
            raise HTTPException(
                status_code=(
                    status.HTTP_400_BAD_REQUEST
                ),
                detail=(
                    "Direct B2 upload could not "
                    "be verified."
                ),
            ) from exc

        stored_size = int(
            object_info.get(
                "ContentLength",
                0,
            )
            or 0
        )

        if (
            stored_size <= 0
            or stored_size
            != int(
                original_file_size,
            )
        ):
            raise HTTPException(
                status_code=(
                    status.HTTP_400_BAD_REQUEST
                ),
                detail=(
                    "Direct B2 upload size "
                    "verification failed."
                ),
            )

        stored_mime_type = (
            str(
                object_info.get(
                    "ContentType",
                    "",
                )
                or mime_type
            )
            .strip()
        )

        if (
            not stored_mime_type
            .lower()
            .startswith(
                "audio/",
            )
        ):
            raise HTTPException(
                status_code=(
                    status.HTTP_400_BAD_REQUEST
                ),
                detail=(
                    "Prepared B2 object is not audio."
                ),
            )

        await _lock_track_upload_identity(
            session,
            title=clean_title,
            artist=clean_artist,
        )

        duplicate = (
            await _find_duplicate_track(
                session,
                title=clean_title,
                artist=clean_artist,
            )
        )

        if duplicate is not None:
            raise HTTPException(
                status_code=(
                    status.HTTP_409_CONFLICT
                ),
                detail=(
                    "Duplicate track prevented: "
                    f'\"{duplicate.title}\" by '
                    f"{duplicate.artist} already "
                    "exists in the catalog."
                ),
            )

        if artwork is not None:
            artwork_data = (
                await artwork.read()
            )

            artwork_mime_type = (
                artwork.content_type
                or ""
            )

            if (
                artwork_data
                and artwork_mime_type
                .lower()
                .startswith(
                    "image/",
                )
            ):
                artwork_ext = (
                    artwork_mime_type
                    .split(
                        "/",
                        1,
                    )[-1]
                    .split(
                        ";",
                        1,
                    )[0]
                    .strip()
                    or "jpg"
                )

                artwork_object_key = (
                    f"{get_settings().b2_artwork_prefix}/"
                    f"{uuid4()}."
                    f"{artwork_ext}"
                )

                await asyncio.to_thread(
                    bucket.upload_bytes,
                    artwork_data,
                    artwork_object_key,
                    content_type=(
                        artwork_mime_type
                    ),
                )

        track = Track(
            id=uuid4(),
            title=clean_title,
            artist=clean_artist,
            album=(
                album.strip()
                or None
            ),
            genre=(
                genre.strip()
                or None
            ),
            release_year=(
                _valid_release_year(
                    release_year,
                )
            ),
            b2_object_key=(
                object_key
            ),
            artwork_object_key=(
                artwork_object_key
            ),
            mime_type=(
                stored_mime_type
            ),
            file_size=(
                stored_size
            ),
            duration_seconds=max(
                int(
                    duration_seconds
                    or 0
                ),
                0,
            ),
            is_published=True,
        )

        session.add(
            track,
        )

        await ensure_artist_profile(
            session,
            track.artist,
        )

        await session.commit()

        cleanup_audio = False

        response_payload = {
            "success": True,
            "track_id":
                str(
                    track.id,
                ),
            "title":
                track.title,
            "artist":
                track.artist,
            "album":
                track.album,
            "genre":
                track.genre,
            "release_year":
                track.release_year,
            "b2_object_key":
                object_key,
            "artwork_object_key":
                artwork_object_key,
            "file_size":
                stored_size,
            "original_file_size":
                original_file_size,
            "direct_upload":
                True,
            "compression": {
                "applied":
                    False,
                "saved_bytes":
                    0,
                "saved_percent":
                    0.0,
                "source_codec":
                    None,
                "source_bitrate_kbps":
                    None,
                "stored_mime_type":
                    stored_mime_type,
            },
            "duration_seconds":
                track.duration_seconds,
        }

        try:
            await ensure_artist_playlist(
                session,
                track.artist,
            )
        except Exception:
            await session.rollback()

        return response_payload

    except HTTPException:
        await session.rollback()
        raise

    except Exception as exc:
        await session.rollback()

        raise HTTPException(
            status_code=(
                status.HTTP_500_INTERNAL_SERVER_ERROR
            ),
            detail=(
                "Unable to finalize direct "
                f"upload: {exc}"
            ),
        ) from exc

    finally:
        if cleanup_audio:
            try:
                await delete_all_object_versions(
                    bucket,
                    object_key,
                )
            except Exception:
                pass

            if artwork_object_key:
                try:
                    await delete_all_object_versions(
                        bucket,
                        artwork_object_key,
                    )
                except Exception:
                    pass


@router.post("/tracks/upload")
async def upload_track(
    file: Annotated[UploadFile, File(...)],
    title: Annotated[str, Form(...)],
    artist: Annotated[str, Form(...)],
    album: Annotated[str, Form(...)],
    duration_seconds: Annotated[int, Form(...)],
    genre: Annotated[str, Form()] = "",
    user: AdminUser,
    session: DatabaseSession,
    title_edited: Annotated[bool, Form()] = False,
    artist_edited: Annotated[bool, Form()] = False,
    album_edited: Annotated[bool, Form()] = False,
    duration_edited: Annotated[bool, Form()] = False,
    release_year: Annotated[
        int | None,
        Form(),
    ] = None,
):
    """Upload an audio file to B2 and create a Track record."""

    if not file:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No file provided.",
        )

    if not file.content_type or "audio" not in file.content_type:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File must be an audio file.",
        )

    settings = get_settings()

    try:
        file_content = await file.read()
        original_file_size = len(
            file_content,
        )

        embedded_metadata = extract_embedded_audio_metadata(
            file_content,
        )

        resolved_metadata = resolve_track_metadata(
            submitted_title=title,
            submitted_artist=artist,
            submitted_album=album,
            submitted_duration_seconds=(duration_seconds),
            title_edited=title_edited,
            artist_edited=artist_edited,
            album_edited=album_edited,
            duration_edited=(duration_edited),
            embedded=embedded_metadata,
        )

        await _lock_track_upload_identity(
            session,
            title=(
                resolved_metadata[
                    "title"
                ]
            ),
            artist=(
                resolved_metadata[
                    "artist"
                ]
            ),
        )

        duplicate = (
            await _find_duplicate_track(
                session,
                title=(
                    resolved_metadata[
                        "title"
                    ]
                ),
                artist=(
                    resolved_metadata[
                        "artist"
                    ]
                ),
            )
        )

        if duplicate is not None:
            raise HTTPException(
                status_code=(
                    status.HTTP_409_CONFLICT
                ),
                detail=(
                    "Duplicate track prevented: "
                    f'\"{duplicate.title}\" by '
                    f"{duplicate.artist} already "
                    "exists in the catalog."
                ),
            )

        artwork_data = None
        artwork_mime_type = None

        try:
            audio_file = MutagenFile(
                BytesIO(file_content),
                easy=False,
            )

            if audio_file is not None:
                tags = getattr(
                    audio_file,
                    "tags",
                    None,
                )

                if tags:
                    if hasattr(
                        tags,
                        "getall",
                    ):
                        apic_frames = tags.getall(
                            "APIC",
                        )

                        if apic_frames:
                            artwork_data = apic_frames[0].data

                            artwork_mime_type = apic_frames[0].mime

                    elif "metadata_block_picture" in tags:
                        picture_data = base64.b64decode(
                            tags["metadata_block_picture"][0],
                        )

                        picture = Picture(
                            picture_data,
                        )

                        artwork_data = picture.data

                        artwork_mime_type = picture.mime

        except Exception:
            # Artwork extraction should
            # never prevent the upload.
            pass

        compression = (
            await asyncio.to_thread(
                compress_audio_for_storage,
                file_content,
                filename=(
                    file.filename
                ),
                mime_type=(
                    file.content_type
                    or "application/octet-stream"
                ),
                title=(
                    resolved_metadata[
                        "title"
                    ]
                ),
                artist=(
                    resolved_metadata[
                        "artist"
                    ]
                ),
                album=(
                    resolved_metadata[
                        "album"
                    ]
                ),
                genre=(
                    resolved_metadata[
                        "genre"
                    ]
                ),
                artwork_data=(
                    artwork_data
                ),
                artwork_mime_type=(
                    artwork_mime_type
                ),
                enabled=(
                    settings
                    .audio_compression_enabled
                ),
                mp3_vbr_quality=(
                    settings
                    .audio_compression_mp3_vbr_quality
                ),
                min_source_kbps=(
                    settings
                    .audio_compression_min_source_kbps
                ),
                min_savings_percent=(
                    settings
                    .audio_compression_min_savings_percent
                ),
                timeout_seconds=(
                    settings
                    .audio_compression_timeout_seconds
                ),
            )
        )

        file_content = (
            compression.content
        )

        file_size = (
            compression.final_size
        )

        upload_mime_type = (
            compression.mime_type
        )

        file_ext = (
            compression.extension
        )

        object_key = (
            f"{settings.b2_audio_prefix}/"
            f"{uuid4()}.{file_ext}"
        )

        bucket = get_b2_bucket()

        await asyncio.to_thread(
            bucket.upload_bytes,
            file_content,
            object_key,
            content_type=(
                upload_mime_type
            ),
        )

        artwork_object_key = None

        if artwork_data and artwork_mime_type:
            artwork_ext = artwork_mime_type.split("/")[-1] if "/" in artwork_mime_type else "jpg"

            artwork_object_key = f"{settings.b2_artwork_prefix}/{uuid4()}.{artwork_ext}"

            await asyncio.to_thread(
                bucket.upload_bytes,
                artwork_data,
                artwork_object_key,
                content_type=(artwork_mime_type),
            )

        track = Track(
            id=uuid4(),
            title=(resolved_metadata["title"]),
            artist=(resolved_metadata["artist"]),
            album=(resolved_metadata["album"]),
            genre=(
                genre.strip()
                or resolved_metadata["genre"]
            ),
            release_year=(
                _valid_release_year(
                    release_year
                    or resolved_metadata.get(
                        "release_year",
                    ),
                )
            ),
            b2_object_key=(object_key),
            artwork_object_key=(artwork_object_key),
            mime_type=(
                upload_mime_type
            ),
            file_size=file_size,
            duration_seconds=(resolved_metadata["duration_seconds"]),
            is_published=True,
        )

        session.add(track)

        await ensure_artist_profile(
            session,
            track.artist,
        )

        await session.commit()

        response_payload = {
            "success": True,
            "track_id": str(
                track.id,
            ),
            "title": track.title,
            "artist": track.artist,
            "album": track.album,
            "genre": track.genre,
            "release_year":
                track.release_year,
            "b2_object_key": (object_key),
            "artwork_object_key": (artwork_object_key),
            "file_size":
                file_size,
            "original_file_size":
                original_file_size,
            "compression": {
                "applied":
                    compression.compressed,
                "saved_bytes":
                    compression.savings_bytes,
                "saved_percent":
                    round(
                        compression.savings_percent,
                        1,
                    ),
                "source_codec":
                    compression.source_codec,
                "source_bitrate_kbps":
                    (
                        round(
                            compression
                            .source_bitrate_kbps,
                            1,
                        )
                        if compression
                        .source_bitrate_kbps
                        is not None
                        else None
                    ),
                "stored_mime_type":
                    upload_mime_type,
            },
            "duration_seconds":
                track.duration_seconds,
        }

        # Generated artist playlists are shared
        # objects. Refresh the matching playlist as
        # soon as new published music lands so every
        # saved copy sees the same membership.
        #
        # The playlist read path also performs this
        # freshness check, so an unexpected refresh
        # failure must not turn a successfully
        # committed upload into a false upload error.
        try:
            await ensure_artist_playlist(
                session,
                track.artist,
            )
        except Exception:
            await session.rollback()

        return response_payload

    except HTTPException:
        await session.rollback()

        raise

    except Exception as exc:
        await session.rollback()

        raise HTTPException(
            status_code=(status.HTTP_500_INTERNAL_SERVER_ERROR),
            detail=(f"Upload failed: {exc}"),
        ) from exc


async def _delete_track_object_versions(
    bucket,
    track: Track,
) -> int:
    object_keys = [
        key
        for key in (
            track.b2_object_key,
            track.artwork_object_key,
        )
        if key
    ]

    deleted_versions = await asyncio.gather(
        *(
            delete_all_object_versions(
                bucket,
                object_key,
            )
            for object_key in object_keys
        )
    )

    return sum(
        deleted_versions,
    )


@router.post(
    "/tracks/backfill-metadata",
)
async def backfill_track_metadata(
    user: AdminUser,
    session: DatabaseSession,
    limit: int = Query(
        default=100,
        ge=1,
        le=500,
    ),
):
    result = await session.execute(
        select(
            Track,
        )
        .where(
            (
                Track.genre.is_(None)
                | (
                    Track.genre
                    == ""
                )
                | Track.release_year.is_(None)
            ),
        )
        .order_by(
            Track.created_at.asc(),
        )
        .limit(
            limit,
        )
    )

    tracks = list(
        result.scalars().all()
    )

    if not tracks:
        return {
            "scanned": 0,
            "updated": 0,
            "genre_updated": 0,
            "year_updated": 0,
            "failed": [],
        }

    bucket = get_b2_bucket()
    updated = 0
    genre_updated = 0
    year_updated = 0
    failed: list[dict] = []

    for track in tracks:
        try:
            downloaded = (
                await asyncio.to_thread(
                    bucket.download_file_by_name,
                    track.b2_object_key,
                )
            )

            def _read_bytes() -> bytes:
                buffer = BytesIO()
                downloaded.save(
                    buffer,
                )
                return buffer.getvalue()

            file_content = (
                await asyncio.to_thread(
                    _read_bytes,
                )
            )

            embedded = (
                extract_embedded_audio_metadata(
                    file_content,
                )
            )

            changed = False

            if (
                not (
                    track.genre
                    or ""
                ).strip()
                and embedded.get(
                    "genre",
                )
            ):
                track.genre = (
                    str(
                        embedded[
                            "genre"
                        ]
                    )
                    .strip()[:120]
                    or None
                )

                if track.genre:
                    changed = True
                    genre_updated += 1

            if (
                track.release_year
                is None
                and embedded.get(
                    "release_year",
                )
                is not None
            ):
                track.release_year = (
                    _valid_release_year(
                        embedded[
                            "release_year"
                        ],
                    )
                )

                if (
                    track.release_year
                    is not None
                ):
                    changed = True
                    year_updated += 1

            if changed:
                updated += 1

        except Exception as exc:
            failed.append(
                {
                    "track_id":
                        str(
                            track.id,
                        ),
                    "title":
                        track.title,
                    "error":
                        str(
                            exc,
                        ),
                }
            )

    await session.commit()

    return {
        "scanned":
            len(
                tracks,
            ),
        "updated":
            updated,
        "genre_updated":
            genre_updated,
        "year_updated":
            year_updated,
        "failed":
            failed,
    }


@router.post(
    "/tracks/delete-bulk",
)
async def delete_tracks_bulk(
    payload: BulkTrackDeleteRequest,
    user: AdminUser,
    session: DatabaseSession,
):
    unique_track_ids = list(
        dict.fromkeys(
            payload.track_ids,
        )
    )

    if not unique_track_ids:
        return {
            "success": True,
            "deleted_track_ids": [],
            "deleted_count": 0,
            "failed": [],
            "deleted_b2_versions": 0,
        }

    if len(unique_track_ids) > 2000:
        raise HTTPException(
            status_code=(
                status.HTTP_400_BAD_REQUEST
            ),
            detail=(
                "Bulk deletion is limited "
                "to 2000 tracks at a time."
            ),
        )

    result = await session.execute(
        select(
            Track,
        ).where(
            Track.id.in_(
                unique_track_ids,
            )
        )
    )

    tracks = list(
        result.scalars().all()
    )

    track_by_id = {
        track.id: track
        for track in tracks
    }

    bucket = get_b2_bucket()

    storage_limit = (
        asyncio.Semaphore(
            12,
        )
    )

    async def delete_storage(
        track: Track,
    ):
        async with storage_limit:
            try:
                deleted_versions = (
                    await _delete_track_object_versions(
                        bucket,
                        track,
                    )
                )

                return (
                    track,
                    deleted_versions,
                    None,
                )

            except Exception as exc:
                return (
                    track,
                    0,
                    str(
                        exc,
                    ),
                )

    storage_results = (
        await asyncio.gather(
            *(
                delete_storage(
                    track,
                )
                for track in tracks
            )
        )
    )

    deleted_track_ids: list[str] = []
    failed: list[dict[str, str]] = []
    deleted_b2_versions = 0

    for (
        track,
        deleted_versions,
        error_message,
    ) in storage_results:
        if error_message is not None:
            failed.append(
                {
                    "track_id":
                        str(
                            track.id,
                        ),
                    "message":
                        (
                            "Failed to permanently "
                            "remove track files from "
                            f"B2: {error_message}"
                        ),
                }
            )

            continue

        await session.delete(
            track,
        )

        deleted_track_ids.append(
            str(
                track.id,
            )
        )

        deleted_b2_versions += int(
            deleted_versions,
        )

    for track_id in unique_track_ids:
        if track_id in track_by_id:
            continue

        failed.append(
            {
                "track_id":
                    str(
                        track_id,
                    ),
                "message":
                    "Track not found.",
            }
        )

    try:
        await session.commit()

    except Exception as exc:
        await session.rollback()

        raise HTTPException(
            status_code=(
                status.HTTP_500_INTERNAL_SERVER_ERROR
            ),
            detail=(
                "Track files were removed from "
                "storage, but the database bulk "
                f"delete failed: {exc}"
            ),
        ) from exc

    return {
        "success":
            len(
                failed,
            )
            == 0,
        "deleted_track_ids":
            deleted_track_ids,
        "deleted_count":
            len(
                deleted_track_ids,
            ),
        "failed":
            failed,
        "deleted_b2_versions":
            deleted_b2_versions,
    }


@router.delete("/tracks/{track_id}")
async def delete_track(
    track_id: UUID,
    user: AdminUser,
    session: DatabaseSession,
):
    """Permanently delete a track and all of its B2 versions."""

    track = await session.get(
        Track,
        track_id,
    )

    if track is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Track not found.",
        )

    bucket = get_b2_bucket()

    try:
        deleted_versions = (
            await _delete_track_object_versions(
                bucket,
                track,
            )
        )

    except Exception as exc:
        await session.rollback()

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=(f"Failed to permanently remove track files from B2: {exc}"),
        ) from exc

    await session.delete(track)

    await session.commit()

    return {
        "success": True,
        "deleted_track_id": str(track_id),
        "deleted_object_key": track.b2_object_key,
        "deleted_artwork_object_key": track.artwork_object_key,
        "deleted_b2_versions": deleted_versions,
    }
