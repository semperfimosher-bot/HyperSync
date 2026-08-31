import asyncio
import base64
from io import BytesIO
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from mutagen._file import File as MutagenFile
from mutagen.flac import Picture

from ...config import get_settings
from ...models.media import Track
from ...services.audio_metadata import (
    extract_embedded_audio_metadata,
    resolve_track_metadata,
)
from ...services.b2 import (
    delete_all_object_versions,
    get_b2_bucket,
)
from ..dependencies import AdminUser, DatabaseSession

router = APIRouter(
    prefix="/admin",
    tags=["administration"],
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

@router.post("/tracks/upload")
async def upload_track(
    file: Annotated[UploadFile, File(...)],
    title: Annotated[str, Form(...)],
    artist: Annotated[str, Form(...)],
    album: Annotated[str, Form(...)],
    duration_seconds: Annotated[int, Form(...)],
    user: AdminUser,
    session: DatabaseSession,
    title_edited: Annotated[bool, Form()] = False,
    artist_edited: Annotated[bool, Form()] = False,
    album_edited: Annotated[bool, Form()] = False,
    duration_edited: Annotated[bool, Form()] = False,
):
    """Upload an audio file to B2 and create a Track record."""

    if not file:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No file provided.",
        )

    if (
        not file.content_type
        or "audio" not in file.content_type
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File must be an audio file.",
        )

    settings = get_settings()

    try:
        file_content = await file.read()
        file_size = len(file_content)

        embedded_metadata = (
            extract_embedded_audio_metadata(
                file_content,
            )
        )

        resolved_metadata = (
            resolve_track_metadata(
                submitted_title=title,
                submitted_artist=artist,
                submitted_album=album,
                submitted_duration_seconds=(
                    duration_seconds
                ),
                title_edited=title_edited,
                artist_edited=artist_edited,
                album_edited=album_edited,
                duration_edited=(
                    duration_edited
                ),
                embedded=embedded_metadata,
            )
        )

        file_ext = (
            file.filename.split(".")[-1]
            if (
                file.filename
                and "." in file.filename
            )
            else "wav"
        )

        object_key = (
            f"{settings.b2_audio_prefix}/"
            f"{uuid4()}.{file_ext}"
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
                        apic_frames = (
                            tags.getall(
                                "APIC",
                            )
                        )

                        if apic_frames:
                            artwork_data = (
                                apic_frames[
                                    0
                                ].data
                            )

                            artwork_mime_type = (
                                apic_frames[
                                    0
                                ].mime
                            )

                    elif (
                        "metadata_block_picture"
                        in tags
                    ):
                        picture_data = (
                            base64.b64decode(
                                tags[
                                    "metadata_block_picture"
                                ][0],
                            )
                        )

                        picture = Picture(
                            picture_data,
                        )

                        artwork_data = (
                            picture.data
                        )

                        artwork_mime_type = (
                            picture.mime
                        )

        except Exception:
            # Artwork extraction should
            # never prevent the upload.
            pass

        bucket = get_b2_bucket()

        await asyncio.to_thread(
            bucket.upload_bytes,
            file_content,
            object_key,
            content_type=(
                file.content_type
            ),
        )

        artwork_object_key = None

        if (
            artwork_data
            and artwork_mime_type
        ):
            artwork_ext = (
                artwork_mime_type
                .split("/")[-1]
                if "/" in artwork_mime_type
                else "jpg"
            )

            artwork_object_key = (
                f"{settings.b2_artwork_prefix}/"
                f"{uuid4()}.{artwork_ext}"
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
            b2_object_key=(
                object_key
            ),
            artwork_object_key=(
                artwork_object_key
            ),
            mime_type=(
                file.content_type
            ),
            file_size=file_size,
            duration_seconds=(
                resolved_metadata[
                    "duration_seconds"
                ]
            ),
            is_published=True,
        )

        session.add(track)

        await session.commit()

        return {
            "success": True,
            "track_id": str(
                track.id,
            ),
            "title": track.title,
            "artist": track.artist,
            "album": track.album,
            "b2_object_key": (
                object_key
            ),
            "artwork_object_key": (
                artwork_object_key
            ),
            "file_size": file_size,
            "duration_seconds": (
                track.duration_seconds
            ),
        }

    except Exception as exc:
        await session.rollback()

        raise HTTPException(
            status_code=(
                status
                .HTTP_500_INTERNAL_SERVER_ERROR
            ),
            detail=(
                f"Upload failed: {exc}"
            ),
        ) from exc


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

    object_keys = [
        key
        for key in (
            track.b2_object_key,
            track.artwork_object_key,
        )
        if key
    ]

    try:
        deleted_versions = await asyncio.gather(
            *(
                delete_all_object_versions(
                    bucket,
                    object_key,
                )
                for object_key in object_keys
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
        "deleted_b2_versions": sum(deleted_versions),
    }
