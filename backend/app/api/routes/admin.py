import asyncio
import base64
from io import BytesIO
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from mutagen._file import File as MutagenFile
from mutagen.flac import Picture
from sqlalchemy import select

from ...config import get_settings
from ...models.media import Track
from ...services.b2 import get_b2_bucket
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
        file_size = len(file_content)

        file_ext = file.filename.split(".")[-1] if file.filename and "." in file.filename else "wav"

        object_key = f"{settings.b2_audio_prefix}/{uuid4()}.{file_ext}"

        # Extract embedded artwork from the audio file.
        artwork_data = None
        artwork_mime_type = None

        try:
            audio_file = MutagenFile(
                BytesIO(file_content),
                easy=False,
            )

            if audio_file is not None:
                if hasattr(audio_file, "tags") and audio_file.tags:
                    # MP3 / ID3 artwork.
                    if hasattr(audio_file.tags, "getall"):
                        apic_frames = audio_file.tags.getall("APIC")

                        if apic_frames:
                            artwork_data = apic_frames[0].data
                            artwork_mime_type = apic_frames[0].mime

                    # Ogg/Vorbis and FLAC artwork.
                    elif "metadata_block_picture" in audio_file.tags:
                        picture_data = base64.b64decode(
                            audio_file.tags["metadata_block_picture"][0]
                        )
                        picture = Picture(picture_data)
                        artwork_data = picture.data
                        artwork_mime_type = picture.mime

        except Exception:
            # If artwork extraction fails, continue without artwork.
            pass

        bucket = get_b2_bucket()

        await asyncio.to_thread(
            bucket.upload_bytes,
            file_content,
            object_key,
            content_type=file.content_type,
        )

        # Upload embedded artwork if found.
        artwork_object_key = None

        if artwork_data and artwork_mime_type:
            artwork_ext = artwork_mime_type.split("/")[-1] if "/" in artwork_mime_type else "jpg"

            artwork_object_key = f"{settings.b2_artwork_prefix}/{uuid4()}.{artwork_ext}"

            await asyncio.to_thread(
                bucket.upload_bytes,
                artwork_data,
                artwork_object_key,
                content_type=artwork_mime_type,
            )

        track = Track(
            id=uuid4(),
            title=title,
            artist=artist,
            album=album,
            b2_object_key=object_key,
            artwork_object_key=artwork_object_key,
            mime_type=file.content_type,
            file_size=file_size,
            duration_seconds=duration_seconds,
            is_published=True,
        )

        session.add(track)
        await session.commit()

        return {
            "success": True,
            "track_id": str(track.id),
            "title": track.title,
            "artist": track.artist,
            "album": track.album,
            "b2_object_key": object_key,
            "artwork_object_key": artwork_object_key,
            "file_size": file_size,
            "duration_seconds": duration_seconds,
        }

    except Exception as exc:
        await session.rollback()

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Upload failed: {str(exc)}",
        ) from exc


@router.delete("/tracks/{track_id}")
async def delete_track(
    track_id: UUID,
    user: AdminUser,
    session: DatabaseSession,
):
    """Delete a track and every stored version of its B2 object."""
    track = await session.get(Track, track_id)

    if track is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Track not found.",
        )

    bucket = get_b2_bucket()
    object_key = track.b2_object_key

    if object_key:
        try:
            versions = await asyncio.to_thread(
                bucket.list_file_versions,
                file_name=object_key,
            )

            for version in versions:
                file_name = getattr(version, "file_name", None) or getattr(
                    version, "fileName", None
                )

                file_id = getattr(version, "file_id", None) or getattr(version, "fileId", None)

                if file_name and file_id:
                    await asyncio.to_thread(
                        bucket.delete_file_version,
                        file_id=file_id,
                        file_name=file_name,
                    )

        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=(f"Failed to remove B2 versions for track: {str(exc)}"),
            ) from exc

    duplicate_tracks = (
        (
            await session.execute(
                select(Track).where(
                    Track.b2_object_key == object_key,
                )
            )
        )
        .scalars()
        .all()
    )

    for duplicate_track in duplicate_tracks:
        await session.delete(duplicate_track)

    await session.commit()

    return {
        "success": True,
        "deleted_track_id": str(track_id),
        "deleted_object_key": object_key,
        "deleted_rows": len(duplicate_tracks),
    }
