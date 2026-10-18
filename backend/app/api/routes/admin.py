import asyncio
import base64
import hmac
import logging
import shutil
import tempfile
from pathlib import Path
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import (
    APIRouter,
    BackgroundTasks,
    File,
    Form,
    HTTPException,
    Query,
    Response,
    UploadFile,
    status,
)
from mutagen.flac import Picture
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.orm import selectinload

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
from ...services.artists import (
    ensure_artist_profiles_for_credit,
)
from ...services.audio_compression import (
    AudioProbe,
    compress_audio_file_for_storage,
    should_attempt_audio_compression,
)
from ...services.audio_metadata import (
    bounded_mutagen_file,
    extract_embedded_audio_metadata_file,
    resolve_track_metadata,
)
from ...services.b2 import (
    create_presigned_upload_url,
    delete_all_bucket_versions,
    delete_all_object_versions,
    get_b2_bucket,
    head_b2_object,
)
from ...services.catalog_ingestion import (
    lock_track_identity,
)
from ...services.maintenance_jobs import (
    enqueue_track_maintenance,
    maintenance_status,
    retry_failed_job,
)
from ...services.media_identity import (
    catalog_identity_diagnostics,
    duplicate_track_groups,
    group_duplicate_tracks,
    sync_track_media_identity,
)
from ...services.media_identity import (
    find_duplicate_track as find_indexed_duplicate_track,
)
from ...services.music_metadata import (
    enrich_track_metadata,
)
from ...services.storage_integrity import (
    audit_track_storage,
)
from ...services.thread_work import run_blocking
from ..dependencies import AdminUser, DatabaseSession

router = APIRouter(
    prefix="/admin",
    tags=["administration"],
)


logger = logging.getLogger(__name__)


def _duplicate_track_groups(
    tracks: list[Track],
) -> list[dict]:
    # Compatibility wrapper for older callers/tests.
    # The actual grouping rules live in media_identity.
    return group_duplicate_tracks(
        tracks,
    )


async def _find_duplicate_track(
    session: DatabaseSession,
    *,
    title: str,
    artist: str,
) -> Track | None:
    return await find_indexed_duplicate_track(
        session,
        title=title,
        artist=artist,
    )


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
        "identity_backfill_pending": 0,
    }

    storage_status = {
        "healthy": False,
        "message":
            "B2 storage unavailable.",
    }

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

        catalog_counts = (
            await catalog_identity_diagnostics(
                session,
            )
        )

        catalog_status = {
            "healthy": True,
            **catalog_counts,
        }

    except Exception:
        logger.exception("Admin diagnostics database check failed.")
        await session.rollback()

        database_status["message"] = (
            "Database check failed; inspect server logs."
        )

    try:
        bucket = await run_blocking(
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

    except Exception:
        logger.exception("Admin diagnostics storage check failed.")
        storage_status["message"] = (
            "Storage check failed; inspect server logs."
        )

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
    }


@router.get(
    "/media-integrity",
)
async def scan_media_integrity(
    user: AdminUser,
    session: DatabaseSession,
    limit: int = Query(
        default=500,
        ge=1,
        le=2000,
    ),
    offset: int = Query(
        default=0,
        ge=0,
    ),
):
    result = await session.execute(
        select(
            Track,
        )
        .where(
            Track.is_published.is_(
                True,
            )
        )
        .order_by(
            Track.created_at.asc(),
            Track.id.asc(),
        )
        .offset(
            offset,
        )
        .limit(
            limit,
        )
    )

    tracks = list(
        result.scalars().all()
    )

    audit = await audit_track_storage(
        tracks,
    )

    return {
        **audit,
        "offset":
            offset,
        "limit":
            limit,
        "has_more":
            len(
                tracks,
            )
            == limit,
    }


@router.get(
    "/duplicates",
)
async def scan_catalog_duplicates(
    user: AdminUser,
    session: DatabaseSession,
):
    (
        scanned_tracks,
        duplicate_groups,
    ) = await duplicate_track_groups(
        session,
    )

    return {
        "scanned_tracks":
            scanned_tracks,
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

    except Exception:
        logger.exception("Unable to delete every B2 object version during admin reset.")
        await session.rollback()

        raise HTTPException(
            status_code=(
                status.HTTP_500_INTERNAL_SERVER_ERROR
            ),
            detail=(
                "Unable to remove all storage objects. "
                "Database data was not wiped; inspect server logs before retrying."
            ),
        ) from None

    try:
        (
            deleted_rows,
            reset_generation,
        ) = (
            await _delete_all_database_rows(
                session,
            )
        )

    except Exception:
        logger.exception("Storage objects were deleted but the admin database reset failed.")
        raise HTTPException(
            status_code=(
                status.HTTP_500_INTERNAL_SERVER_ERROR
            ),
            detail=(
                "Storage objects were deleted, but the database reset failed. "
                "Inspect server logs before retrying."
            ),
        ) from None

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

    await session.commit()

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
        logger.exception(
            (
                "Unable to clean cancelled direct-upload "
                "object %s."
            ),
            payload.object_key,
        )

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
    background_tasks: BackgroundTasks,
    album: Annotated[str, Form()] = "",
    genre: Annotated[str, Form()] = "",
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

    bucket = await run_blocking(get_b2_bucket)

    cleanup_audio = True
    artwork_object_key = None

    try:
        try:
            object_info = await run_blocking(
                head_b2_object,
                object_key,
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

        if artwork is not None:
            artwork_data = await artwork.read(5 * 1024 * 1024 + 1)

            if len(artwork_data) > 5 * 1024 * 1024:
                raise HTTPException(status_code=413, detail="Artwork exceeds 5 MiB.")

            artwork_mime_type = (
                artwork.content_type
                or ""
            )

            if artwork_data and artwork_mime_type.lower().startswith(
                "image/",
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

                await run_blocking(
                    bucket.upload_bytes,
                    artwork_data,
                    artwork_object_key,
                    content_type=(artwork_mime_type),
                )

        await lock_track_identity(
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

        session.add(track)

        await ensure_artist_profiles_for_credit(
            session,
            track.artist,
            include_combined=False,
        )

        await sync_track_media_identity(
            session,
            track,
        )

        await enqueue_track_maintenance(session, track.id)
        # Once COMMIT is sent, a lost acknowledgement cannot prove rollback.
        # Retain objects for reconciliation instead of deleting committed audio.
        cleanup_audio = False
        await session.commit()

        response_payload = {
            "success": True,
            "metadata_enrichment_scheduled": True,
            "track_id": str(
                track.id,
            ),
            "title": track.title,
            "artist": track.artist,
            "album": track.album,
            "genre": track.genre,
            "release_year": track.release_year,
            "b2_object_key": object_key,
            "artwork_object_key": artwork_object_key,
            "file_size": stored_size,
            "original_file_size": original_file_size,
            "direct_upload": True,
            "compression": {
                "applied": False,
                "saved_bytes": 0,
                "saved_percent": 0.0,
                "source_codec": None,
                "source_bitrate_kbps": None,
                "stored_mime_type": stored_mime_type,
            },
            "duration_seconds": track.duration_seconds,
        }

        return response_payload

    except HTTPException:
        await session.rollback()
        raise

    except Exception:
        logger.exception("Direct B2 upload finalization failed.")
        await session.rollback()

        raise HTTPException(
            status_code=(
                status.HTTP_500_INTERNAL_SERVER_ERROR
            ),
            detail=(
                "Unable to finalize direct upload. "
                "Please retry or contact support."
            ),
        ) from None

    finally:
        if cleanup_audio:
            try:
                await delete_all_object_versions(
                    bucket,
                    object_key,
                )
            except Exception:
                logger.exception(
                    (
                        "Unable to clean failed direct-upload "
                        "audio object %s."
                    ),
                    object_key,
                )

            if artwork_object_key:
                try:
                    await delete_all_object_versions(
                        bucket,
                        artwork_object_key,
                    )
                except Exception:
                    logger.exception(
                        (
                            "Unable to clean failed direct-upload "
                            "artwork object %s."
                        ),
                        artwork_object_key,
                    )


def _copy_upload_to_path(upload, path: Path) -> None:
    upload.seek(0)
    with path.open("wb") as target:
        shutil.copyfileobj(upload, target, length=1024 * 1024)


def _extract_upload_artwork(path: Path):
    try:
        with path.open("rb") as source:
            audio_file = bounded_mutagen_file(source, easy=False)
        tags = getattr(
            audio_file,
            "tags",
            None,
        )
        if tags:
            if hasattr(tags, "getall"):
                frames = tags.getall("APIC")
                if frames and len(frames[0].data) <= 5 * 1024 * 1024:
                    return frames[0].data, frames[0].mime
            elif "metadata_block_picture" in tags:
                encoded = tags["metadata_block_picture"][0]
                if len(encoded) <= 7 * 1024 * 1024:
                    picture = Picture(base64.b64decode(encoded))
                    if len(picture.data) <= 5 * 1024 * 1024:
                        return picture.data, picture.mime
    except Exception:
        pass
    return None, None


@router.post("/tracks/upload")
async def upload_track(
    file: Annotated[UploadFile, File(...)],
    title: Annotated[str, Form(...)],
    artist: Annotated[str, Form(...)],
    duration_seconds: Annotated[int, Form(...)],
    user: AdminUser,
    session: DatabaseSession,
    background_tasks: BackgroundTasks,
    album: Annotated[str, Form()] = "",
    title_edited: Annotated[bool, Form()] = False,
    artist_edited: Annotated[bool, Form()] = False,
    album_edited: Annotated[bool, Form()] = False,
    duration_edited: Annotated[bool, Form()] = False,
    genre: Annotated[
        str,
        Form(),
    ] = "",
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

    bucket = None
    pending_object_keys: list[str] = []
    commit_attempted = False
    temporary = tempfile.TemporaryDirectory(prefix="hypersync-upload-")
    source_path = Path(temporary.name) / "source.audio"
    output_path = Path(temporary.name) / "output.mp3"

    try:
        await run_blocking(_copy_upload_to_path, file.file, source_path)
        original_file_size = source_path.stat().st_size
        embedded_metadata = await run_blocking(extract_embedded_audio_metadata_file, source_path)

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

        # No database connection is needed during compression or B2 I/O.
        await session.commit()

        artwork_data, artwork_mime_type = await run_blocking(_extract_upload_artwork, source_path)

        compression = await run_blocking(
            compress_audio_file_for_storage,
            source_path,
            output_path,
            filename=(file.filename),
            mime_type=(file.content_type or "application/octet-stream"),
            title=(resolved_metadata["title"]),
            artist=(resolved_metadata["artist"]),
            album=(resolved_metadata["album"]),
            genre=(resolved_metadata["genre"]),
            artwork_data=(artwork_data),
            artwork_mime_type=(artwork_mime_type),
            enabled=(settings.audio_compression_enabled),
            mp3_vbr_quality=(settings.audio_compression_mp3_vbr_quality),
            min_source_kbps=(settings.audio_compression_min_source_kbps),
            min_savings_percent=(settings.audio_compression_min_savings_percent),
            timeout_seconds=(settings.audio_compression_timeout_seconds),
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

        bucket = await run_blocking(
            get_b2_bucket,
        )
        pending_object_keys.append(object_key)

        await run_blocking(
            bucket.upload_local_file,
            local_file=str(compression.output_path),
            file_name=object_key,
            content_type=(upload_mime_type),
        )

        artwork_object_key = None

        if artwork_data and artwork_mime_type:
            artwork_ext = artwork_mime_type.split("/")[-1] if "/" in artwork_mime_type else "jpg"

            artwork_object_key = f"{settings.b2_artwork_prefix}/{uuid4()}.{artwork_ext}"

            pending_object_keys.append(artwork_object_key)
            await run_blocking(
                bucket.upload_bytes,
                artwork_data,
                artwork_object_key,
                content_type=(artwork_mime_type),
            )

        # Serialize only the final catalog write, then recheck concurrent uploads.
        await lock_track_identity(
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

        await ensure_artist_profiles_for_credit(
            session,
            track.artist,
            include_combined=False,
        )

        await sync_track_media_identity(
            session,
            track,
        )

        await enqueue_track_maintenance(session, track.id)
        # Ambiguous commit failures must not delete audio belonging to a
        # potentially committed row. Storage auditing can reconcile an orphan.
        commit_attempted = True
        await session.commit()

        response_payload = {
            "success": True,
            "metadata_enrichment_scheduled": True,
            "track_id": str(
                track.id,
            ),
            "title": track.title,
            "artist": track.artist,
            "album": track.album,
            "genre": track.genre,
            "release_year": track.release_year,
            "b2_object_key": (object_key),
            "artwork_object_key": (artwork_object_key),
            "file_size": file_size,
            "original_file_size": original_file_size,
            "compression": {
                "applied": compression.compressed,
                "saved_bytes": compression.savings_bytes,
                "saved_percent": round(
                    compression.savings_percent,
                    1,
                ),
                "source_codec": compression.source_codec,
                "source_bitrate_kbps": (
                    round(
                        compression.source_bitrate_kbps,
                        1,
                    )
                    if compression.source_bitrate_kbps is not None
                    else None
                ),
                "stored_mime_type": upload_mime_type,
            },
            "duration_seconds": track.duration_seconds,
        }

        return response_payload

    except HTTPException:
        await session.rollback()

        raise

    except Exception:
        logger.exception("Backend audio upload failed.")
        await session.rollback()

        raise HTTPException(
            status_code=(status.HTTP_500_INTERNAL_SERVER_ERROR),
            detail=(
                "Upload failed while processing the audio file. "
                "Please retry or contact support."
            ),
        ) from None

    finally:
        temporary.cleanup()
        if bucket is not None and not commit_attempted:
            for pending_key in pending_object_keys:
                try:
                    await delete_all_object_versions(bucket, pending_key)
                except Exception:
                    logger.exception("Unable to clean failed upload object %s.", pending_key)


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
        ),
        return_exceptions=True,
    )

    # A failed delete can still have removed versions, and sibling
    # operations may also succeed. Settle all outcomes before reporting
    # failure; callers must retain the durable unpublished staging row.
    total = 0
    for result in deleted_versions:
        if isinstance(result, BaseException):
            raise result
        total += result
    return total


@router.post(
    "/tracks/{track_id}/enrich-metadata",
)
async def enrich_track_metadata_endpoint(
    track_id: UUID,
    user: AdminUser,
    session: DatabaseSession,
):
    track = await session.get(
        Track,
        track_id,
    )

    if track is None:
        raise HTTPException(
            status_code=(
                status.HTTP_404_NOT_FOUND
            ),
            detail="Track not found.",
        )

    result = await enrich_track_metadata(
        session,
        track,
    )

    return {
        "track_id":
            str(
                track.id,
            ),
        "title":
            track.title,
        "artist":
            track.artist,
        **result,
    }


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
    external_limit: int = Query(
        default=12,
        ge=0,
        le=50,
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
            "external_checked": 0,
            "external_matched": 0,
            "external_sources": {},
            "failed": [],
        }

    bucket = get_b2_bucket()
    updated = 0
    genre_updated = 0
    year_updated = 0
    external_checked = 0
    external_matched = 0
    external_sources: dict[
        str,
        int,
    ] = {}
    failed: list[dict] = []

    for track in tracks:
        old_genre = (
            track.genre
        )

        old_year = (
            track.release_year
        )

        embedded_error: str | None = (
            None
        )

        try:
            downloaded = await run_blocking(
                bucket.download_file_by_name,
                track.b2_object_key,
            )

            with tempfile.TemporaryDirectory(prefix="hypersync-metadata-") as temp_dir:
                source_path = Path(temp_dir) / "source.audio"
                await run_blocking(downloaded.save_to, str(source_path))
                embedded = await run_blocking(extract_embedded_audio_metadata_file, source_path)

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

        except Exception:
            logger.exception(
                "Unable to read embedded metadata for track %s.",
                track.id,
            )
            embedded_error = "Embedded metadata could not be read."

        still_missing = (
            not (
                track.genre
                or ""
            ).strip()
            or track.release_year
            is None
        )

        external_result = None

        if (
            still_missing
            and external_checked
            < external_limit
        ):
            external_checked += 1

            external_result = (
                await enrich_track_metadata(
                    session,
                    track,
                )
            )

            if external_result[
                "matched"
            ]:
                external_matched += 1

                source = (
                    external_result.get(
                        "source",
                    )
                )

                if source:
                    external_sources[
                        str(
                            source,
                        )
                    ] = (
                        external_sources.get(
                            str(
                                source,
                            ),
                            0,
                        )
                        + 1
                    )

        genre_changed = (
            track.genre
            != old_genre
        )

        year_changed = (
            track.release_year
            != old_year
        )

        if genre_changed:
            genre_updated += 1

        if year_changed:
            year_updated += 1

        if (
            genre_changed
            or year_changed
        ):
            updated += 1

        elif (
            embedded_error
            and (
                external_result
                is None
                or not external_result[
                    "matched"
                ]
            )
        ):
            failed.append(
                {
                    "track_id":
                        str(
                            track.id,
                        ),
                    "title":
                        track.title,
                    "error":
                        embedded_error,
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
        "external_checked":
            external_checked,
        "external_matched":
            external_matched,
        "external_sources":
            dict(
                sorted(
                    external_sources.items(),
                )
            ),
        "failed":
            failed,
    }


async def _stage_tracks_for_storage_delete(
    session: DatabaseSession,
    tracks: list[Track],
) -> dict[UUID, bool]:
    """Hide tracks before destructive object-store mutation."""

    original = {
        track.id:
            bool(
                track.is_published,
            )
        for track in tracks
    }

    for track in tracks:
        track.is_published = False

    try:
        await session.commit()

    except Exception:
        await session.rollback()
        raise

    return original


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

    try:
        await _stage_tracks_for_storage_delete(
            session,
            tracks,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=(
                status.HTTP_500_INTERNAL_SERVER_ERROR
            ),
            detail=(
                "Unable to safely stage tracks for deletion. "
                "No storage objects were removed."
            ),
        ) from exc

    try:
        bucket = get_b2_bucket()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=(
                "Unable to access storage for deletion. Tracks remain hidden; "
                "retry deletion to finish cleanup."
            ),
        ) from exc

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

            except Exception:
                logger.exception(
                    "Bulk storage deletion failed for track %s.",
                    track.id,
                )
                return (
                    track,
                    0,
                    "Storage deletion failed.",
                )

    storage_queue: asyncio.Queue[
        Track
    ] = asyncio.Queue()

    for track in tracks:
        storage_queue.put_nowait(
            track,
        )

    storage_results: list[
        tuple[
            Track,
            int,
            str | None,
        ]
    ] = []

    async def storage_worker() -> None:
        while True:
            try:
                track = (
                    storage_queue
                    .get_nowait()
                )
            except asyncio.QueueEmpty:
                return

            try:
                storage_results.append(
                    await delete_storage(
                        track,
                    )
                )
            finally:
                storage_queue.task_done()

    workers = [
        asyncio.create_task(
            storage_worker(),
        )
        for _index in range(
            min(
                12,
                len(
                    tracks,
                ),
            )
        )
    ]

    if workers:
        await asyncio.gather(
            *workers,
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
                            "Failed to permanently remove track files from B2. "
                            "Track remains hidden; retry deletion to finish cleanup. "
                            "Inspect server logs for diagnostic details."
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

        # Staging remains durable for every target, including storage
        # failures that may already have removed some object versions.
        raise HTTPException(
            status_code=(
                status.HTTP_500_INTERNAL_SERVER_ERROR
            ),
            detail=(
                "Storage deletion completed, but final "
                "database cleanup failed. Affected tracks "
                "were quarantined from the public catalog "
                "instead of leaving broken media entries."
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
            status_code=(
                status.HTTP_404_NOT_FOUND
            ),
            detail="Track not found.",
        )

    deleted_object_key = (
        track.b2_object_key
    )
    deleted_artwork_object_key = (
        track.artwork_object_key
    )
    try:
        await _stage_tracks_for_storage_delete(
            session,
            [
                track,
            ],
        )
    except Exception as exc:
        raise HTTPException(
            status_code=(
                status.HTTP_500_INTERNAL_SERVER_ERROR
            ),
            detail=(
                "Unable to safely stage the track for "
                "deletion. No storage objects were removed."
            ),
        ) from exc

    try:
        bucket = get_b2_bucket()
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
            detail=(
                "Failed to permanently remove track files "
                "from B2. The track remains hidden; retry deletion "
                "to finish cleanup."
            ),
        ) from exc

    try:
        current = await session.get(
            Track,
            track_id,
        )

        if current is not None:
            await session.delete(
                current,
            )

        await session.commit()

    except Exception as exc:
        await session.rollback()

        raise HTTPException(
            status_code=(
                status.HTTP_500_INTERNAL_SERVER_ERROR
            ),
            detail=(
                "Track files were removed from storage, but "
                "final database cleanup failed. The track "
                "was quarantined from the public catalog."
            ),
        ) from exc

    return {
        "success": True,
        "deleted_track_id": str(track_id),
        "deleted_object_key": deleted_object_key,
        "deleted_artwork_object_key": deleted_artwork_object_key,
        "deleted_b2_versions": deleted_versions,
    }


@router.get("/maintenance/jobs")
async def get_maintenance_jobs(user: AdminUser, session: DatabaseSession):
    return await maintenance_status(session)


@router.post("/maintenance/jobs/{job_id}/retry")
async def retry_maintenance_job(job_id: UUID, user: AdminUser, session: DatabaseSession):
    if not await retry_failed_job(session, job_id):
        raise HTTPException(status_code=404, detail="Exhausted maintenance job not found.")
    return {"success": True}
