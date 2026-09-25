from __future__ import annotations

from typing import cast

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.api.routes.admin import (
    _find_duplicate_track,
)
from backend.app.models.media import (
    Track,
)
from backend.app.services.audio_metadata import (
    normalize_track_identity,
)


class _Scalars:
    def __init__(
        self,
        values,
    ) -> None:
        self._values = values

    def all(self):
        return list(
            self._values,
        )


class _Result:
    def __init__(
        self,
        values,
    ) -> None:
        self._values = values

    def scalars(self):
        return _Scalars(
            self._values,
        )


class _Session:
    def __init__(
        self,
        tracks,
    ) -> None:
        self._tracks = tracks

    async def execute(
        self,
        _statement,
    ):
        return _Result(
            self._tracks,
        )


def _track(
    *,
    title: str,
    artist: str,
) -> Track:
    return Track(
        title=title,
        artist=artist,
        album=None,
        genre=None,
        b2_object_key=(
            f"audio/{title}-{artist}.mp3"
        ),
        mime_type="audio/mpeg",
        file_size=1,
        duration_seconds=1,
        is_published=True,
    )


def test_duplicate_identity_normalizes_case_spacing_and_unicode() -> None:
    assert (
        normalize_track_identity(
            "  Ｔｈｅ   Weeknd  ",
        )
        ==
        "the weeknd"
    )

    assert (
        normalize_track_identity(
            "Straße",
        )
        ==
        "strasse"
    )


@pytest.mark.asyncio
async def test_duplicate_lookup_matches_normalized_artist_and_title() -> None:
    existing = _track(
        title="Blinding Lights",
        artist="The Weeknd",
    )

    session = _Session(
        [
            existing,
        ],
    )

    duplicate = (
        await _find_duplicate_track(
            cast(
                AsyncSession,
                session,
            ),
            title="  BLINDING   LIGHTS ",
            artist=" the   weeknd ",
        )
    )

    assert duplicate is existing


@pytest.mark.asyncio
async def test_duplicate_lookup_allows_same_title_for_different_artist() -> None:
    existing = _track(
        title="Home",
        artist="Artist One",
    )

    session = _Session(
        [
            existing,
        ],
    )

    duplicate = (
        await _find_duplicate_track(
            cast(
                AsyncSession,
                session,
            ),
            title="Home",
            artist="Artist Two",
        )
    )

    assert duplicate is None
