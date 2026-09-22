from __future__ import annotations


ALLOWED_IMAGE_TYPES = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}


def normalized_image_type(
    content_type: str | None,
) -> str | None:
    if not content_type:
        return None

    value = content_type.strip().lower()

    if value in ALLOWED_IMAGE_TYPES:
        return value

    return None


def image_extension(
    content_type: str,
) -> str:
    return ALLOWED_IMAGE_TYPES[content_type]


def image_signature_matches(
    data: bytes,
    content_type: str,
) -> bool:
    if not data:
        return False

    if content_type == "image/jpeg":
        return (
            len(data) >= 3
            and data[:3] == b"\xff\xd8\xff"
        )

    if content_type == "image/png":
        return (
            len(data) >= 8
            and data[:8]
            == b"\x89PNG\r\n\x1a\n"
        )

    if content_type == "image/webp":
        return (
            len(data) >= 12
            and data[:4] == b"RIFF"
            and data[8:12] == b"WEBP"
        )

    return False
