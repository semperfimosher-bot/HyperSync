from __future__ import annotations

import math
import re
import unicodedata
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
    genre: str | None
    release_year: int | None


class ResolvedTrackMetadata(
    TypedDict,
):
    title: str
    artist: str
    album: str | None
    duration_seconds: int
    genre: str | None
    release_year: int | None


_ARTIST_CREDIT_SPLIT_PATTERN = re.compile(
    (
        r"\s+"
        r"(?:&|\band\b|\bx\b|\bwith\b|"
        r"\bfeat(?:uring)?\.?|\bft\.?)"
        r"\s+"
    ),
    flags=re.IGNORECASE,
)


def split_artist_credits(
    artist: object,
) -> tuple[str, ...]:
    raw = " ".join(
        str(
            artist
            if artist is not None
            else ""
        )
        .strip()
        .split()
    )

    if not raw:
        return ()

    parts = [
        " ".join(
            part
            .strip()
            .split()
        )
        for part in (
            _ARTIST_CREDIT_SPLIT_PATTERN
            .split(
                raw,
            )
        )
        if part.strip()
    ]

    seen: set[str] = set()
    result: list[str] = []

    for part in parts:
        key = unicodedata.normalize(
            "NFKC",
            part,
        ).casefold()

        if (
            not key
            or key in seen
        ):
            continue

        seen.add(
            key,
        )
        result.append(
            part,
        )

    return tuple(
        result
        or [
            raw,
        ]
    )


def primary_artist_credit(
    artist: object,
) -> str:
    credits = split_artist_credits(
        artist,
    )

    return (
        credits[0]
        if credits
        else ""
    )


def normalize_track_identity(
    value: object,
) -> str:
    text = unicodedata.normalize(
        "NFKC",
        str(
            value
            if value is not None
            else ""
        ),
    )

    return " ".join(
        text
        .strip()
        .casefold()
        .split()
    )


_VERSION_QUALIFIER_RE = re.compile(
    r"""
    \b(
        remix(?:ed)?
        | remaster(?:ed)?
        | acoustic
        | live
        | radio\s+(?:edit|version|mix)
        | edit
        | extended(?:\s+(?:mix|version))?
        | club\s+mix
        | dance\s+mix
        | original\s+mix
        | alternate(?:\s+version)?
        | alt(?:\s+version)?
        | version
        | instrumental
        | karaoke
        | demo
        | mono
        | stereo
        | clean
        | explicit
        | sped\s*[- ]?\s*up
        | slowed(?:\s*(?:\+|and)\s*reverb)?
        | reverb
        | nightcore
        | rework
        | re[- ]?record(?:ed|ing)?
        | anniversary
        | deluxe
    )\b
    """,
    re.IGNORECASE
    | re.VERBOSE,
)


_BARE_VERSION_SUFFIX_RE = re.compile(
    r"""
    \s+
    (?:
        remix(?:ed)?
        | (?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?
        | acoustic(?:\s+version)?
        | live(?:\s+version)?
        | radio\s+(?:edit|version|mix)
        | edit
        | extended(?:\s+(?:mix|version))?
        | club\s+mix
        | dance\s+mix
        | original\s+mix
        | alternate(?:\s+version)?
        | alt(?:\s+version)?
        | version
        | instrumental(?:\s+version)?
        | karaoke(?:\s+version)?
        | demo(?:\s+version)?
        | mono(?:\s+version)?
        | stereo(?:\s+version)?
        | clean(?:\s+version)?
        | explicit(?:\s+version)?
        | sped\s*[- ]?\s*up
        | slowed(?:\s*(?:\+|and)\s*reverb)?
        | nightcore
        | rework
        | re[- ]?record(?:ed|ing)?
        | anniversary(?:\s+edition)?
        | deluxe(?:\s+version)?
        | single\s+version
        | album\s+version
    )
    \s*$
    """,
    re.IGNORECASE
    | re.VERBOSE,
)


_TRAILING_BRACKET_RE = re.compile(
    r"\s*[\(\[\{]([^()\[\]{}]+)[\)\]\}]\s*$",
)


_TRAILING_SEPARATOR_RE = re.compile(
    r"^(.*)\s+[-–—:]\s+(.+)$",
)


def normalize_track_title_identity(
    value: object,
) -> str:
    """
    Normalize a track title to its root-song identity.

    Duplicate prevention should treat alternate releases of the
    same song as one catalog identity. Only explicit version
    qualifiers are removed, so meaningful subtitles such as
    "Sweet Dreams (Are Made of This)" remain distinct.
    """

    normalized = normalize_track_identity(
        value,
    )

    if not normalized:
        return ""

    root = normalized

    while root:
        previous = root

        bracket = _TRAILING_BRACKET_RE.search(
            root,
        )

        if (
            bracket is not None
            and _VERSION_QUALIFIER_RE.search(
                bracket.group(
                    1,
                )
            )
        ):
            root = (
                root[
                    : bracket.start()
                ]
                .strip()
            )

        separator = _TRAILING_SEPARATOR_RE.match(
            root,
        )

        if (
            separator is not None
            and _VERSION_QUALIFIER_RE.search(
                separator.group(
                    2,
                )
            )
        ):
            root = (
                separator.group(
                    1,
                )
                .strip()
            )

        root = _BARE_VERSION_SUFFIX_RE.sub(
            "",
            root,
        ).strip()

        if root == previous:
            break

    return root or normalized


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


def _release_year(
    tags,
) -> int | None:
    for key in (
        "date",
        "year",
        "originaldate",
        "originalyear",
    ):
        value = _tag_value(
            tags,
            key,
        )

        if not value:
            continue

        match = re.search(
            r"(?<!\d)(19\d{2}|20\d{2}|21\d{2})(?!\d)",
            value,
        )

        if not match:
            continue

        year = int(
            match.group(
                1,
            )
        )

        if (
            1900
            <= year
            <= 2100
        ):
            return year

    return None


def extract_embedded_audio_metadata(
    file_content: bytes,
) -> EmbeddedAudioMetadata:
    empty: EmbeddedAudioMetadata = {
        "title": None,
        "artist": None,
        "album": None,
        "duration_seconds": None,
        "genre": None,
        "release_year": None,
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
        "duration_seconds": (duration_seconds),
        "genre": _tag_value(
            tags,
            "genre",
        ),
        "release_year": _release_year(
            tags,
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
    submitted_title = submitted_title.strip()

    submitted_artist = submitted_artist.strip()

    submitted_album_clean = submitted_album.strip() if submitted_album else None

    if title_edited:
        title = submitted_title
    else:
        title = embedded["title"] or submitted_title

    if artist_edited:
        artist = submitted_artist
    else:
        artist = embedded["artist"] or submitted_artist

    if album_edited:
        album = submitted_album_clean
    else:
        album = embedded["album"] or submitted_album_clean

    if duration_edited:
        duration_seconds = submitted_duration_seconds
    else:
        duration_seconds = embedded["duration_seconds"] or submitted_duration_seconds

    return {
        "title": title,
        "artist": artist,
        "album": album,
        "duration_seconds": max(
            int(duration_seconds or 0),
            0,
        ),
        "genre": embedded.get(
            "genre",
        ),
        "release_year": embedded.get(
            "release_year",
        ),
    }
