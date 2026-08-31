import importlib
from types import SimpleNamespace

import pytest


def load_audio_metadata_module():
    try:
        return importlib.import_module(
            "backend.app.services.audio_metadata",
        )
    except ModuleNotFoundError:
        return None


def test_extracts_embedded_audio_metadata(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    audio_metadata = (
        load_audio_metadata_module()
    )

    assert audio_metadata is not None

    fake_audio = SimpleNamespace(
        tags={
            "title": [
                "The Meaning",
            ],
            "artist": [
                "FKi 1st & Post Malone",
            ],
            "album": [
                (
                    "First Time for "
                    "Everything, Pt. 1 - EP"
                ),
            ],
        },
        info=SimpleNamespace(
            length=207.2,
        ),
    )

    monkeypatch.setattr(
        audio_metadata,
        "MutagenFile",
        lambda *args, **kwargs: (
            fake_audio
        ),
    )

    result = (
        audio_metadata
        .extract_embedded_audio_metadata(
            b"fake-audio",
        )
    )

    assert result == {
        "title": "The Meaning",
        "artist": (
            "FKi 1st & Post Malone"
        ),
        "album": (
            "First Time for "
            "Everything, Pt. 1 - EP"
        ),
        "duration_seconds": 207,
    }


def test_embedded_metadata_wins_when_field_was_not_edited() -> None:
    audio_metadata = (
        load_audio_metadata_module()
    )

    assert audio_metadata is not None

    result = (
        audio_metadata
        .resolve_track_metadata(
            submitted_title="Filename Title",
            submitted_artist=(
                "Filename Artist"
            ),
            submitted_album="",
            submitted_duration_seconds=207,
            title_edited=False,
            artist_edited=False,
            album_edited=False,
            duration_edited=False,
            embedded={
                "title": "Real Title",
                "artist": "Real Artist",
                "album": "Real Album",
                "duration_seconds": 208,
            },
        )
    )

    assert result == {
        "title": "Real Title",
        "artist": "Real Artist",
        "album": "Real Album",
        "duration_seconds": 208,
    }


def test_manual_metadata_wins_over_embedded_metadata() -> None:
    audio_metadata = (
        load_audio_metadata_module()
    )

    assert audio_metadata is not None

    result = (
        audio_metadata
        .resolve_track_metadata(
            submitted_title=(
                "Corrected Title"
            ),
            submitted_artist=(
                "Corrected Artist"
            ),
            submitted_album=(
                "Corrected Album"
            ),
            submitted_duration_seconds=210,
            title_edited=True,
            artist_edited=True,
            album_edited=True,
            duration_edited=True,
            embedded={
                "title": "Embedded Title",
                "artist": "Embedded Artist",
                "album": "Embedded Album",
                "duration_seconds": 208,
            },
        )
    )

    assert result == {
        "title": "Corrected Title",
        "artist": "Corrected Artist",
        "album": "Corrected Album",
        "duration_seconds": 210,
    }
    