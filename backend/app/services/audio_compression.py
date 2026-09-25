from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from mutagen import File as MutagenFile
from mutagen.id3._frames import (
    APIC,
    TALB,
    TCON,
    TIT2,
    TPE1,
)
from mutagen.mp3 import MP3


LOSSLESS_OR_UNCOMPRESSED_CODECS = {
    "alac",
    "ape",
    "flac",
    "pcm_alaw",
    "pcm_f32be",
    "pcm_f32le",
    "pcm_f64be",
    "pcm_f64le",
    "pcm_mulaw",
    "pcm_s16be",
    "pcm_s16le",
    "pcm_s24be",
    "pcm_s24le",
    "pcm_s32be",
    "pcm_s32le",
    "pcm_s8",
    "pcm_u16be",
    "pcm_u16le",
    "pcm_u24be",
    "pcm_u24le",
    "pcm_u32be",
    "pcm_u32le",
    "pcm_u8",
    "tta",
    "wavpack",
}

LOSSLESS_OR_UNCOMPRESSED_EXTENSIONS = {
    ".aif",
    ".aiff",
    ".alac",
    ".flac",
    ".wav",
    ".wave",
}


@dataclass(frozen=True)
class AudioProbe:
    codec: str | None
    bitrate_kbps: float | None
    duration_seconds: float | None
    channels: int | None


@dataclass(frozen=True)
class AudioCompressionResult:
    content: bytes
    mime_type: str
    extension: str
    compressed: bool
    original_size: int
    final_size: int
    savings_bytes: int
    savings_percent: float
    source_codec: str | None
    source_bitrate_kbps: float | None


def _safe_int(
    value: Any,
) -> int | None:
    try:
        parsed = int(
            value,
        )
    except (
        TypeError,
        ValueError,
    ):
        return None

    return parsed if parsed >= 0 else None


def _safe_float(
    value: Any,
) -> float | None:
    try:
        parsed = float(
            value,
        )
    except (
        TypeError,
        ValueError,
    ):
        return None

    if parsed <= 0:
        return None

    return parsed


def _probe_audio(
    path: Path,
    *,
    timeout_seconds: int,
) -> AudioProbe:
    ffprobe = shutil.which(
        "ffprobe",
    )

    if not ffprobe:
        return AudioProbe(
            codec=None,
            bitrate_kbps=None,
            duration_seconds=None,
            channels=None,
        )

    completed = subprocess.run(
        [
            ffprobe,
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-show_entries",
            (
                "stream=codec_name,bit_rate,channels:"
                "format=bit_rate,duration"
            ),
            "-of",
            "json",
            str(
                path,
            ),
        ],
        capture_output=True,
        text=True,
        timeout=max(
            timeout_seconds,
            1,
        ),
        check=False,
    )

    if completed.returncode != 0:
        return AudioProbe(
            codec=None,
            bitrate_kbps=None,
            duration_seconds=None,
            channels=None,
        )

    try:
        payload = json.loads(
            completed.stdout
            or "{}",
        )
    except json.JSONDecodeError:
        payload = {}

    streams = (
        payload.get(
            "streams",
        )
        or []
    )

    stream = (
        streams[0]
        if streams
        else {}
    )

    format_info = (
        payload.get(
            "format",
        )
        or {}
    )

    bitrate = (
        _safe_float(
            stream.get(
                "bit_rate",
            ),
        )
        or
        _safe_float(
            format_info.get(
                "bit_rate",
            ),
        )
    )

    return AudioProbe(
        codec=(
            str(
                stream.get(
                    "codec_name",
                )
                or ""
            ).strip()
            or None
        ),
        bitrate_kbps=(
            bitrate / 1000
            if bitrate
            else None
        ),
        duration_seconds=(
            _safe_float(
                format_info.get(
                    "duration",
                ),
            )
        ),
        channels=(
            _safe_int(
                stream.get(
                    "channels",
                ),
            )
        ),
    )


def should_attempt_audio_compression(
    *,
    filename: str | None,
    probe: AudioProbe,
    original_size: int,
    min_source_kbps: int,
) -> bool:
    if original_size <= 0:
        return False

    suffix = (
        Path(
            filename
            or ""
        )
        .suffix
        .lower()
    )

    codec = (
        probe.codec
        or ""
    ).lower()

    if (
        suffix
        in LOSSLESS_OR_UNCOMPRESSED_EXTENSIONS
        or codec
        in LOSSLESS_OR_UNCOMPRESSED_CODECS
        or codec.startswith(
            "pcm_",
        )
    ):
        return True

    bitrate = (
        probe.bitrate_kbps
    )

    if (
        bitrate is not None
        and bitrate
        >= max(
            min_source_kbps,
            1,
        )
    ):
        return True

    return False


def _embed_resolved_metadata(
    output_path: Path,
    *,
    title: str,
    artist: str,
    album: str | None,
    genre: str | None,
    artwork_data: bytes | None,
    artwork_mime_type: str | None,
) -> None:
    audio = MP3(
        output_path,
    )

    if audio.tags is None:
        audio.add_tags()

    tags = audio.tags

    if tags is None:
        return

    tags.delall(
        "TIT2",
    )

    tags.add(
        TIT2(
            encoding=3,
            text=[
                title,
            ],
        )
    )

    tags.delall(
        "TPE1",
    )

    tags.add(
        TPE1(
            encoding=3,
            text=[
                artist,
            ],
        )
    )

    tags.delall(
        "TALB",
    )

    if album:
        tags.add(
            TALB(
                encoding=3,
                text=[
                    album,
                ],
            )
        )

    tags.delall(
        "TCON",
    )

    if genre:
        tags.add(
            TCON(
                encoding=3,
                text=[
                    genre,
                ],
            )
        )

    if artwork_data:
        tags.delall(
            "APIC",
        )

        tags.add(
            APIC(
                encoding=3,
                mime=(
                    artwork_mime_type
                    or "image/jpeg"
                ),
                type=3,
                desc="Cover",
                data=artwork_data,
            )
        )

    audio.save(
        v2_version=3,
    )


def _validate_output(
    path: Path,
    *,
    expected_title: str,
    expected_artist: str,
) -> bool:
    if (
        not path.exists()
        or path.stat().st_size
        <= 0
    ):
        return False

    try:
        parsed = MutagenFile(
            path,
            easy=True,
        )
    except Exception:
        return False

    if parsed is None:
        return False

    info = getattr(
        parsed,
        "info",
        None,
    )

    length = getattr(
        info,
        "length",
        0,
    )

    if not isinstance(
        length,
        (
            int,
            float,
        ),
    ):
        return False

    if length <= 0:
        return False

    tags = getattr(
        parsed,
        "tags",
        None,
    )

    if tags:
        title_values = (
            tags.get(
                "title",
            )
            or []
        )

        artist_values = (
            tags.get(
                "artist",
            )
            or []
        )

        if (
            title_values
            and str(
                title_values[0],
            ).strip()
            != expected_title.strip()
        ):
            return False

        if (
            artist_values
            and str(
                artist_values[0],
            ).strip()
            != expected_artist.strip()
        ):
            return False

    return True


def _original_result(
    content: bytes,
    *,
    filename: str | None,
    mime_type: str,
    probe: AudioProbe,
) -> AudioCompressionResult:
    extension = (
        Path(
            filename
            or ""
        )
        .suffix
        .lower()
        .removeprefix(
            ".",
        )
        or "bin"
    )

    size = len(
        content,
    )

    return AudioCompressionResult(
        content=content,
        mime_type=mime_type,
        extension=extension,
        compressed=False,
        original_size=size,
        final_size=size,
        savings_bytes=0,
        savings_percent=0.0,
        source_codec=probe.codec,
        source_bitrate_kbps=(
            probe.bitrate_kbps
        ),
    )


def compress_audio_for_storage(
    content: bytes,
    *,
    filename: str | None,
    mime_type: str,
    title: str,
    artist: str,
    album: str | None,
    genre: str | None,
    artwork_data: bytes | None,
    artwork_mime_type: str | None,
    enabled: bool,
    mp3_vbr_quality: int,
    min_source_kbps: int,
    min_savings_percent: int,
    timeout_seconds: int,
) -> AudioCompressionResult:
    original_size = len(
        content,
    )

    if (
        not enabled
        or original_size <= 0
    ):
        return _original_result(
            content,
            filename=filename,
            mime_type=mime_type,
            probe=AudioProbe(
                codec=None,
                bitrate_kbps=None,
                duration_seconds=None,
                channels=None,
            ),
        )

    ffmpeg = shutil.which(
        "ffmpeg",
    )

    if not ffmpeg:
        return _original_result(
            content,
            filename=filename,
            mime_type=mime_type,
            probe=AudioProbe(
                codec=None,
                bitrate_kbps=None,
                duration_seconds=None,
                channels=None,
            ),
        )

    suffix = (
        Path(
            filename
            or ""
        )
        .suffix
        .lower()
        or ".audio"
    )

    with tempfile.TemporaryDirectory(
        prefix="hypersync-audio-",
    ) as temp_dir:
        temp_path = Path(
            temp_dir,
        )

        input_path = (
            temp_path
            / f"input{suffix}"
        )

        output_path = (
            temp_path
            / "output.mp3"
        )

        input_path.write_bytes(
            content,
        )

        probe = _probe_audio(
            input_path,
            timeout_seconds=(
                timeout_seconds
            ),
        )

        if (
            not should_attempt_audio_compression(
                filename=filename,
                probe=probe,
                original_size=(
                    original_size
                ),
                min_source_kbps=(
                    min_source_kbps
                ),
            )
        ):
            return _original_result(
                content,
                filename=filename,
                mime_type=mime_type,
                probe=probe,
            )

        quality = max(
            0,
            min(
                int(
                    mp3_vbr_quality,
                ),
                9,
            ),
        )

        command = [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(
                input_path,
            ),
            "-map",
            "0:a:0",
            "-map_metadata",
            "0",
            "-vn",
            "-c:a",
            "libmp3lame",
            "-q:a",
            str(
                quality,
            ),
            "-id3v2_version",
            "3",
            "-write_id3v1",
            "1",
            "-metadata",
            f"title={title}",
            "-metadata",
            f"artist={artist}",
        ]

        if album:
            command.extend(
                [
                    "-metadata",
                    f"album={album}",
                ]
            )

        if genre:
            command.extend(
                [
                    "-metadata",
                    f"genre={genre}",
                ]
            )

        command.append(
            str(
                output_path,
            )
        )

        try:
            completed = (
                subprocess.run(
                    command,
                    capture_output=True,
                    text=True,
                    timeout=max(
                        timeout_seconds,
                        1,
                    ),
                    check=False,
                )
            )
        except (
            OSError,
            subprocess.SubprocessError,
        ):
            return _original_result(
                content,
                filename=filename,
                mime_type=mime_type,
                probe=probe,
            )

        if (
            completed.returncode
            != 0
            or not output_path.exists()
        ):
            return _original_result(
                content,
                filename=filename,
                mime_type=mime_type,
                probe=probe,
            )

        try:
            _embed_resolved_metadata(
                output_path,
                title=title,
                artist=artist,
                album=album,
                genre=genre,
                artwork_data=(
                    artwork_data
                ),
                artwork_mime_type=(
                    artwork_mime_type
                ),
            )
        except Exception:
            return _original_result(
                content,
                filename=filename,
                mime_type=mime_type,
                probe=probe,
            )

        if not _validate_output(
            output_path,
            expected_title=title,
            expected_artist=artist,
        ):
            return _original_result(
                content,
                filename=filename,
                mime_type=mime_type,
                probe=probe,
            )

        compressed = (
            output_path.read_bytes()
        )

        final_size = len(
            compressed,
        )

        minimum_savings = (
            max(
                min_savings_percent,
                0,
            )
            / 100
        )

        if (
            final_size <= 0
            or final_size
            >= (
                original_size
                * (
                    1
                    - minimum_savings
                )
            )
        ):
            return _original_result(
                content,
                filename=filename,
                mime_type=mime_type,
                probe=probe,
            )

        savings_bytes = (
            original_size
            - final_size
        )

        savings_percent = (
            savings_bytes
            / original_size
            * 100
        )

        return AudioCompressionResult(
            content=compressed,
            mime_type="audio/mpeg",
            extension="mp3",
            compressed=True,
            original_size=(
                original_size
            ),
            final_size=(
                final_size
            ),
            savings_bytes=(
                savings_bytes
            ),
            savings_percent=(
                savings_percent
            ),
            source_codec=(
                probe.codec
            ),
            source_bitrate_kbps=(
                probe.bitrate_kbps
            ),
        )
