from __future__ import annotations

import asyncio
from dataclasses import dataclass
from uuid import UUID, uuid4

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..database import get_session_factory
from ..models.media import Track
from .artists import (
    artist_names_for_credit,
    ensure_artist_profiles_for_credit,
)
from .audio_compression import (
    compress_audio_for_storage,
)
from .audio_metadata import (
    normalize_track_identity,
    normalize_track_title_identity,
)
from .b2 import (
    delete_all_object_versions,
    get_b2_bucket,
)
from .generated_playlists import (
    ensure_artist_playlist,
    refresh_smart_playlists_for_track,
)
from .on_demand_metadata import (
    CatalogTrackCandidate,
)


@dataclass(frozen=True)
class CatalogPublishResult:
    track_id: UUID
    created: bool
    title: str
    artist: str
    audio_object_key: str
    artwork_object_key: str | None


async def lock_track_identity(
    session: AsyncSession,
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
        + normalize_track_title_identity(
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


async def find_duplicate_track(
    session: AsyncSession,
    *,
    title: str,
    artist: str,
) -> Track | None:
    title_key = (
        normalize_track_title_identity(
            title,
        )
    )

    artist_key = (
        normalize_track_identity(
            artist,
        )
    )

    result = await session.execute(
        select(
            Track,
        )
    )

    for track in result.scalars().all():
        if (
            normalize_track_title_identity(
                track.title,
            )
            == title_key
            and normalize_track_identity(
                track.artist,
            )
            == artist_key
        ):
            return track

    return None


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
        if 1900 <= year <= 2100
        else None
    )


def _artwork_extension(
    mime_type: str | None,
) -> str:
    normalized = (
        mime_type
        or ""
    ).split(
        ";",
        1,
    )[0].strip().lower()

    mapping = {
        "image/jpeg": "jpg",
        "image/jpg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
    }

    return mapping.get(
        normalized,
        "jpg",
    )


async def publish_authorized_audio(
    *,
    metadata: CatalogTrackCandidate,
    audio_content: bytes,
    audio_filename: str,
    audio_mime_type: str,
    artwork_data: bytes | None = None,
    artwork_mime_type: str | None = None,
    source_provider: str | None = None,
    source_id: str | None = None,
) -> CatalogPublishResult:
    settings = get_settings()

    if not audio_content:
        raise RuntimeError(
            "Cannot publish empty audio."
        )

    session_factory = (
        get_session_factory()
    )

    async with session_factory() as session:
        await lock_track_identity(
            session,
            title=metadata.title,
            artist=metadata.artist,
        )

        existing = (
            await find_duplicate_track(
                session,
                title=metadata.title,
                artist=metadata.artist,
            )
        )

        if existing is not None:
            return CatalogPublishResult(
                track_id=existing.id,
                created=False,
                title=existing.title,
                artist=existing.artist,
                audio_object_key=(
                    existing.b2_object_key
                ),
                artwork_object_key=(
                    existing
                    .artwork_object_key
                ),
            )

        compression = (
            await asyncio.to_thread(
                compress_audio_for_storage,
                audio_content,
                filename=audio_filename,
                mime_type=(
                    audio_mime_type
                    or "application/octet-stream"
                ),
                title=metadata.title,
                artist=metadata.artist,
                album=metadata.album,
                genre=metadata.genre,
                artwork_data=artwork_data,
                artwork_mime_type=(
                    artwork_mime_type
                ),
                enabled=True,
                mp3_vbr_quality=(
                    settings
                    .audio_compression_mp3_vbr_quality
                ),
                min_source_kbps=1,
                min_savings_percent=0,
                timeout_seconds=(
                    settings
                    .audio_compression_timeout_seconds
                ),
                force_transcode=True,
                release_year=(
                    metadata.release_year
                ),
            )
        )

        if (
            not compression.content
            or compression.mime_type
            != "audio/mpeg"
            or compression.extension
            != "mp3"
        ):
            raise RuntimeError(
                "FFmpeg could not produce "
                "the canonical MP3 output."
            )

        audio_object_key = (
            f"{settings.b2_audio_prefix}/"
            f"{uuid4()}.mp3"
        )

        artwork_object_key = None

        if artwork_data:
            artwork_object_key = (
                f"{settings.b2_artwork_prefix}/"
                f"{uuid4()}."
                f"{_artwork_extension(artwork_mime_type)}"
            )

        bucket = get_b2_bucket()

        uploaded_audio = False
        uploaded_artwork = False

        try:
            await asyncio.to_thread(
                bucket.upload_bytes,
                compression.content,
                audio_object_key,
                content_type="audio/mpeg",
            )

            uploaded_audio = True

            if (
                artwork_object_key
                and artwork_data
            ):
                await asyncio.to_thread(
                    bucket.upload_bytes,
                    artwork_data,
                    artwork_object_key,
                    content_type=(
                        artwork_mime_type
                        or "image/jpeg"
                    ),
                )

                uploaded_artwork = True

            existing = (
                await find_duplicate_track(
                    session,
                    title=metadata.title,
                    artist=metadata.artist,
                )
            )

            if existing is not None:
                await session.rollback()

                return CatalogPublishResult(
                    track_id=existing.id,
                    created=False,
                    title=existing.title,
                    artist=existing.artist,
                    audio_object_key=(
                        existing.b2_object_key
                    ),
                    artwork_object_key=(
                        existing
                        .artwork_object_key
                    ),
                )

            track = Track(
                id=uuid4(),
                title=metadata.title,
                artist=metadata.artist,
                album=metadata.album,
                genre=metadata.genre,
                release_year=(
                    _valid_release_year(
                        metadata
                        .release_year
                    )
                ),
                isrc=(
                    metadata.isrc
                ),
                deezer_track_id=(
                    metadata
                    .deezer_track_id
                ),
                apple_track_id=(
                    metadata
                    .apple_track_id
                ),
                source_provider=(
                    source_provider
                ),
                source_id=(
                    source_id
                ),
                b2_object_key=(
                    audio_object_key
                ),
                artwork_object_key=(
                    artwork_object_key
                ),
                mime_type="audio/mpeg",
                file_size=(
                    compression.final_size
                ),
                duration_seconds=(
                    metadata.duration_seconds
                ),
                is_published=True,
            )

            session.add(
                track,
            )

            await ensure_artist_profiles_for_credit(
                session,
                track.artist,
                include_combined=True,
            )

            await session.commit()

            try:
                for artist_name in artist_names_for_credit(
                    track.artist,
                    include_combined=True,
                ):
                    await ensure_artist_playlist(
                        session,
                        artist_name,
                    )

                await refresh_smart_playlists_for_track(
                    session,
                    track,
                )

            except Exception:
                await session.rollback()

            return CatalogPublishResult(
                track_id=track.id,
                created=True,
                title=track.title,
                artist=track.artist,
                audio_object_key=(
                    audio_object_key
                ),
                artwork_object_key=(
                    artwork_object_key
                ),
            )

        except Exception:
            await session.rollback()
            raise

        finally:
            # If no Track row references the new objects,
            # remove them. This covers duplicate races and
            # database failures after B2 succeeds.
            result = await session.execute(
                select(
                    Track.id,
                ).where(
                    Track.b2_object_key
                    == audio_object_key,
                )
            )

            referenced = (
                result.scalar_one_or_none()
                is not None
            )

            if (
                uploaded_audio
                and not referenced
            ):
                try:
                    await delete_all_object_versions(
                        bucket,
                        audio_object_key,
                    )
                except Exception:
                    pass

            if (
                uploaded_artwork
                and artwork_object_key
                and not referenced
            ):
                try:
                    await delete_all_object_versions(
                        bucket,
                        artwork_object_key,
                    )
                except Exception:
                    pass
