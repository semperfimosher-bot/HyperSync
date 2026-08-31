from __future__ import annotations

import math
from io import BytesIO
from typing import TypedDict

from mutagen._file import (
    File as MutagenFile,
)


class EmbeddedAudioMetadata(
    TypedDict,
):
    title: str | None
    artist: str | None
    album: str | None
    duration_seconds: int | None


class ResolvedTrackMetadata(
    TypedDict,
):
    title: str
    artist: str
    album: str | None
    duration_seconds: int


def _clean_text(
    value: object,
) -> str | None:
    if value is None:
        return None

    if isinstance(
        value,
        (list, tuple),
    ):
        if not value:
            return None

        value = value[0]

    text = str(
        value,
    ).strip()

    return text or None


def _tag_value(
    tags,
    key: str,
) -> str | None:
    if not tags:
        return None

    try:
        value = tags.get(
            key,
        )
    except Exception:
        return None

    return _clean_text(
        value,
    )


def extract_embedded_audio_metadata(
    file_content: bytes,
) -> EmbeddedAudioMetadata:
    empty: EmbeddedAudioMetadata = {
        "title": None,
        "artist": None,
        "album": None,
        "duration_seconds": None,
    }

    if not file_content:
        return empty

    try:
        audio_file = MutagenFile(
            BytesIO(
                file_content,
            ),
            easy=True,
        )
    except Exception:
        return empty

    if audio_file is None:
        return empty

    tags = getattr(
        audio_file,
        "tags",
        None,
    )

    duration_seconds = None

    info = getattr(
        audio_file,
        "info",
        None,
    )

    length = getattr(
        info,
        "length",
        None,
    )

    if isinstance(
        length,
        (
            int,
            float,
            str,
        ),
    ):
        try:
            numeric_length = float(
                length,
            )

            if (
                math.isfinite(
                    numeric_length,
                )
                and numeric_length > 0
            ):
                duration_seconds = round(
                    numeric_length,
                )

        except ValueError:
            pass

    return {
        "title": _tag_value(
            tags,
            "title",
        ),
        "artist": _tag_value(
            tags,
            "artist",
        ),
        "album": _tag_value(
            tags,
            "album",
        ),
        "duration_seconds": (
            duration_seconds
        ),
    }


def resolve_track_metadata(
    *,
    submitted_title: str,
    submitted_artist: str,
    submitted_album: str | None,
    submitted_duration_seconds: int,
    title_edited: bool,
    artist_edited: bool,
    album_edited: bool,
    duration_edited: bool,
    embedded: EmbeddedAudioMetadata,
) -> ResolvedTrackMetadata:
    submitted_title = (
        submitted_title.strip()
    )

    submitted_artist = (
        submitted_artist.strip()
    )

    submitted_album_clean = (
        submitted_album.strip()
        if submitted_album
        else None
    )

    if title_edited:
        title = submitted_title
    else:
        title = (
            embedded["title"]
            or submitted_title
        )

    if artist_edited:
        artist = submitted_artist
    else:
        artist = (
            embedded["artist"]
            or submitted_artist
        )

    if album_edited:
        album = (
            submitted_album_clean
        )
    else:
        album = (
            embedded["album"]
            or submitted_album_clean
        )

    if duration_edited:
        duration_seconds = (
            submitted_duration_seconds
        )
    else:
        duration_seconds = (
            embedded[
                "duration_seconds"
            ]
            or submitted_duration_seconds
        )

    return {
        "title": title,
        "artist": artist,
        "album": album,
        "duration_seconds": max(
            int(
                duration_seconds
                or 0
            ),
            0,
        ),
    }
