import wave

from scripts.verification.environment import create_environment
from scripts.verification.fixtures import seed_fixtures


async def test_fixture_audio_and_accounts_are_distinct_and_local(tmp_path):
    environment = create_environment(tmp_path / "run")
    manifest = await seed_fixtures(environment)
    assert len(manifest["tracks"]) == 4
    assert len({t["id"] for t in manifest["tracks"]}) == 4
    assert len(manifest["accounts"]) >= 2
    for track in manifest["tracks"]:
        with wave.open(str(environment.root / track["file"]), "rb") as audio:
            assert audio.getnframes() / audio.getframerate() == track["duration"]
            assert any(audio.readframes(1000))
    assert all(t["duration"] >= 30 for t in manifest["tracks"][:3])
