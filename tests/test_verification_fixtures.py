import asyncio
import wave

from scripts.verification.environment import (
    create_environment,
    owned_cleanup,
)
from scripts.verification.fixtures import (
    seed_fixtures,
)


def test_fixture_audio_and_accounts_are_distinct_and_local(
    tmp_path,
):
    environment = create_environment(
        tmp_path / "run"
    )
    try:
        manifest = asyncio.run(
            seed_fixtures(environment)
        )
        assert len(manifest["tracks"]) == 4
        assert (
            len(
                {
                    track["id"]
                    for track in manifest["tracks"]
                }
            )
            == 4
        )
        assert len(manifest["accounts"]) >= 2
        for track in manifest["tracks"]:
            with wave.open(
                str(
                    environment.root
                    / track["file"]
                ),
                "rb",
            ) as audio:
                assert (
                    audio.getnframes()
                    / audio.getframerate()
                    == track["duration"]
                )
                assert any(
                    audio.readframes(1000)
                )
        assert all(
            track["duration"] >= 30
            for track
            in manifest["tracks"][:3]
        )
    finally:
        owned_cleanup(environment)
