from __future__ import annotations

import io
import shutil
import subprocess
import wave

import pytest
from mutagen.id3 import ID3
from mutagen.mp3 import MP3

from backend.app.services import (
    audio_compression,
)
from backend.app.services.audio_compression import (
    AudioProbe,
    compress_audio_for_storage,
    should_attempt_audio_compression,
)


def _wav_bytes(
    seconds: int = 4,
) -> bytes:
    buffer = io.BytesIO()

    with wave.open(
        buffer,
        "wb",
    ) as output:
        output.setnchannels(
            2,
        )
        output.setsampwidth(
            2,
        )
        output.setframerate(
            44_100,
        )

        output.writeframes(
            b"\x00\x00\x00\x00"
            * (
                44_100
                * seconds
            )
        )

    return buffer.getvalue()


def _has_lame_encoder() -> bool:
    ffmpeg = shutil.which(
        "ffmpeg",
    )

    if not ffmpeg:
        return False

    completed = subprocess.run(
        [
            ffmpeg,
            "-hide_banner",
            "-encoders",
        ],
        capture_output=True,
        text=True,
        check=False,
    )

    return (
        completed.returncode
        == 0
        and "libmp3lame"
        in completed.stdout
    )


def test_lossless_or_uncompressed_audio_is_selected_for_compression() -> None:
    assert should_attempt_audio_compression(
        filename="track.wav",
        probe=AudioProbe(
            codec="pcm_s16le",
            bitrate_kbps=1411.2,
            duration_seconds=180,
            channels=2,
        ),
        original_size=20_000_000,
        min_source_kbps=224,
    )


def test_already_efficient_lossy_audio_is_left_untouched() -> None:
    assert not should_attempt_audio_compression(
        filename="track.mp3",
        probe=AudioProbe(
            codec="mp3",
            bitrate_kbps=192,
            duration_seconds=180,
            channels=2,
        ),
        original_size=4_500_000,
        min_source_kbps=224,
    )


def test_high_bitrate_lossy_audio_can_be_recompressed() -> None:
    assert should_attempt_audio_compression(
        filename="track.mp3",
        probe=AudioProbe(
            codec="mp3",
            bitrate_kbps=320,
            duration_seconds=180,
            channels=2,
        ),
        original_size=7_500_000,
        min_source_kbps=224,
    )


def test_missing_ffmpeg_falls_back_to_original_bytes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    original = _wav_bytes(
        seconds=1,
    )

    monkeypatch.setattr(
        audio_compression.shutil,
        "which",
        lambda _name: None,
    )

    result = compress_audio_for_storage(
        original,
        filename="track.wav",
        mime_type="audio/wav",
        title="Song",
        artist="Artist",
        album="Album",
        genre="Rock",
        artwork_data=None,
        artwork_mime_type=None,
        enabled=True,
        mp3_vbr_quality=2,
        min_source_kbps=224,
        min_savings_percent=10,
        timeout_seconds=30,
    )

    assert result.content == original
    assert result.compressed is False
    assert result.mime_type == "audio/wav"
    assert result.final_size == len(
        original,
    )


@pytest.mark.skipif(
    not _has_lame_encoder(),
    reason=(
        "FFmpeg with libmp3lame "
        "is unavailable."
    ),
)
def test_real_compression_preserves_core_metadata_artwork_and_playability() -> None:
    original = _wav_bytes(
        seconds=4,
    )

    artwork = (
        b"synthetic-cover-bytes"
    )

    result = compress_audio_for_storage(
        original,
        filename="track.wav",
        mime_type="audio/wav",
        title="Compression Test",
        artist="HyperSync Artist",
        album="Storage Album",
        genre="Electronic",
        artwork_data=artwork,
        artwork_mime_type="image/jpeg",
        enabled=True,
        mp3_vbr_quality=2,
        min_source_kbps=224,
        min_savings_percent=10,
        timeout_seconds=60,
    )

    assert result.compressed is True
    assert result.mime_type == "audio/mpeg"
    assert result.extension == "mp3"
    assert result.final_size < result.original_size
    assert result.savings_percent >= 10

    parsed = MP3(
        io.BytesIO(
            result.content,
        ),
    )

    assert parsed.info.length > 0

    tags = ID3(
        io.BytesIO(
            result.content,
        ),
    )

    assert str(
        tags.get(
            "TIT2",
        ),
    ) == "Compression Test"

    assert str(
        tags.get(
            "TPE1",
        ),
    ) == "HyperSync Artist"

    assert str(
        tags.get(
            "TALB",
        ),
    ) == "Storage Album"

    assert str(
        tags.get(
            "TCON",
        ),
    ) == "Electronic"

    covers = tags.getall(
        "APIC",
    )

    assert len(
        covers,
    ) == 1

    assert covers[0].data == artwork
    assert covers[0].mime == "image/jpeg"
