import logging

from ..config import get_settings
from ..models.media import Track
from .b2 import create_presigned_download_url

logger = logging.getLogger(__name__)


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
