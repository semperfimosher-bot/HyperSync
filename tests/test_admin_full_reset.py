from __future__ import annotations

from dataclasses import dataclass

import pytest

from backend.app.models import Base
from backend.app.services.b2 import delete_all_bucket_versions


@dataclass
class FakeVersion:
    file_id: str
    file_name: str


class FakeBucket:
    def __init__(self) -> None:
        self.deleted: list[
            tuple[str, str]
        ] = []

    def ls(
        self,
        folder_to_list: str,
        *,
        show_versions: bool,
        recursive: bool,
    ):
        assert folder_to_list == ""
        assert show_versions is True
        assert recursive is True

        return [
            (
                FakeVersion(
                    "audio-v1",
                    "audio/song.wav",
                ),
                None,
            ),
            (
                FakeVersion(
                    "audio-v2",
                    "audio/song.wav",
                ),
                None,
            ),
            (
                FakeVersion(
                    "art-v1",
                    "artwork/song.jpg",
                ),
                None,
            ),
            (
                FakeVersion(
                    "orphan-v1",
                    "orphan/unused.bin",
                ),
                None,
            ),
        ]

    def delete_file_version(
        self,
        file_id: str,
        file_name: str,
    ) -> None:
        self.deleted.append(
            (
                file_id,
                file_name,
            )
        )


@pytest.mark.asyncio
async def test_delete_all_bucket_versions_removes_every_listed_version() -> None:
    bucket = FakeBucket()

    deleted = (
        await delete_all_bucket_versions(
            bucket,
        )
    )

    assert deleted == 4

    assert bucket.deleted == [
        (
            "audio-v1",
            "audio/song.wav",
        ),
        (
            "audio-v2",
            "audio/song.wav",
        ),
        (
            "art-v1",
            "artwork/song.jpg",
        ),
        (
            "orphan-v1",
            "orphan/unused.bin",
        ),
    ]


def test_full_reset_metadata_registers_all_application_tables() -> None:
    expected_tables = {
        "users",
        "user_profiles",
        "user_sessions",
        "user_follows",
        "listening_events",
        "user_app_state",
        "tracks",
        "track_lyrics",
        "playlists",
        "playlist_tracks",
        "saved_playlists",
    }

    assert expected_tables.issubset(
        set(
            Base.metadata.tables,
        )
    )
