import asyncio
import threading
from io import BytesIO

import pytest


def test_metadata_reader_rejects_unbounded_and_cumulative_reads():
    from backend.app.services.audio_metadata import MetadataBudgetExceeded, MetadataReadBudget

    reader = MetadataReadBudget(BytesIO(b"x" * 100), max_bytes=8)
    assert reader.read(4) == b"xxxx"
    reader.seek(0)
    assert reader.read(4) == b"xxxx"
    with pytest.raises(MetadataBudgetExceeded):
        reader.read(1)
    with pytest.raises(MetadataBudgetExceeded):
        MetadataReadBudget(BytesIO(b"x" * 10), max_bytes=8).read()


def test_disk_compression_disabled_never_reads_source(tmp_path, monkeypatch):
    from backend.app.services import audio_compression as module

    source = tmp_path / "source.wav"
    source.write_bytes(b"audio")
    monkeypatch.setattr(type(source), "read_bytes", lambda _self: pytest.fail("whole-file read"))
    result = module.compress_audio_file_for_storage(
        source,
        tmp_path / "out.mp3",
        filename="source.wav",
        mime_type="audio/wav",
        title="Song",
        artist="Artist",
        album=None,
        genre=None,
        artwork_data=None,
        artwork_mime_type=None,
        enabled=False,
        mp3_vbr_quality=2,
        min_source_kbps=224,
        min_savings_percent=10,
        timeout_seconds=3,
    )
    assert result.output_path == source
    assert not result.compressed
    assert result.final_size == 5


@pytest.mark.asyncio
async def test_cancelled_thread_waits_before_releasing_owned_files(tmp_path):
    from backend.app.services.thread_work import run_blocking

    started, release, finished = threading.Event(), threading.Event(), threading.Event()
    path = tmp_path / "owned"
    path.write_text("alive")

    def work():
        started.set()
        release.wait(3)
        assert path.read_text() == "alive"
        finished.set()

    task = asyncio.create_task(run_blocking(work))
    await asyncio.to_thread(started.wait, 3)
    task.cancel()
    await asyncio.sleep(0)
    assert not task.done()
    release.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert finished.is_set()


def test_compressed_id3_frame_is_skipped_before_mutagen(monkeypatch):
    from backend.app.services import audio_metadata as module

    frame = b"TIT2" + (4).to_bytes(4, "big") + b"\0\x80" + b"data"
    header = b"ID3\x03\0\0" + bytes([0, 0, 0, len(frame)])
    monkeypatch.setattr(module, "MutagenFile", lambda *_a, **_k: pytest.fail("unsafe parser"))
    assert module.extract_embedded_audio_metadata(header + frame)["title"] is None


@pytest.mark.asyncio
async def test_cancelled_upload_finishes_before_cleanup_and_removes_tempfile(monkeypatch):
    from pathlib import Path
    from types import SimpleNamespace
    from unittest.mock import AsyncMock, MagicMock

    from fastapi import BackgroundTasks, UploadFile
    from starlette.datastructures import Headers

    from backend.app.api.routes import admin

    started, release, finished = threading.Event(), threading.Event(), threading.Event()
    paths = []

    def upload(*, local_file, **_kwargs):
        path = Path(local_file)
        paths.append(path)
        started.set()
        release.wait(3)
        assert path.read_bytes() == b"audio"
        finished.set()

    async def cleanup(*_args):
        assert finished.is_set()

    monkeypatch.setattr(admin, "get_b2_bucket", lambda: SimpleNamespace(upload_local_file=upload))
    monkeypatch.setattr(admin, "_find_duplicate_track", AsyncMock(return_value=None))
    monkeypatch.setattr(admin, "delete_all_object_versions", AsyncMock(side_effect=cleanup))
    monkeypatch.setattr(
        admin,
        "get_settings",
        lambda: SimpleNamespace(
            audio_compression_enabled=False,
            audio_compression_mp3_vbr_quality=2,
            audio_compression_min_source_kbps=224,
            audio_compression_min_savings_percent=10,
            audio_compression_timeout_seconds=3,
            audio_max_upload_bytes=512 * 1024 * 1024,
            b2_audio_prefix="audio",
        ),
    )
    task = asyncio.create_task(
        admin.upload_track(
            file=UploadFile(
                BytesIO(b"audio"),
                filename="song.mp3",
                headers=Headers({"content-type": "audio/mpeg"}),
            ),
            title="Song",
            artist="Artist",
            duration_seconds=10,
            user=MagicMock(),
            session=MagicMock(commit=AsyncMock(), rollback=AsyncMock()),
            background_tasks=BackgroundTasks(),
        )
    )
    assert await asyncio.to_thread(started.wait, 3)
    task.cancel()
    await asyncio.sleep(0)
    assert paths[0].exists()
    assert not task.done()
    release.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert not paths[0].exists()
    admin.delete_all_object_versions.assert_awaited_once()


def test_disk_compression_uses_stat_and_preserves_savings_policy(tmp_path, monkeypatch):
    from types import SimpleNamespace

    from backend.app.services import audio_compression as module

    source, output = tmp_path / "source.wav", tmp_path / "out.mp3"
    source.write_bytes(b"x" * 100)
    monkeypatch.setattr(module.shutil, "which", lambda _: "ffmpeg")
    monkeypatch.setattr(
        module, "_probe_audio", lambda *_a, **_k: module.AudioProbe("pcm_s16le", 1400, 1, 2)
    )

    def transcode(_input, output, **_kwargs):
        output.write_bytes(b"y" * 20)
        return SimpleNamespace(final_size=20)

    monkeypatch.setattr(module, "transcode_audio_file_to_mp3", transcode)
    monkeypatch.setattr(type(source), "read_bytes", lambda _self: pytest.fail("whole-file read"))

    def compress(minimum_savings):
        return module.compress_audio_file_for_storage(
            source,
            output,
            filename="source.wav",
            mime_type="audio/wav",
            title="Song",
            artist="Artist",
            album=None,
            genre=None,
            artwork_data=None,
            artwork_mime_type=None,
            enabled=True,
            mp3_vbr_quality=2,
            min_source_kbps=224,
            min_savings_percent=minimum_savings,
            timeout_seconds=3,
        )

    result = compress(10)
    assert result.compressed and result.output_path == output
    assert result.savings_bytes == 80 and result.savings_percent == 80
    result = compress(90)
    assert not result.compressed and result.output_path == source
    assert not output.exists()


@pytest.mark.asyncio
async def test_direct_finalize_rejects_oversized_artwork(monkeypatch):
    from types import SimpleNamespace
    from unittest.mock import AsyncMock, MagicMock

    from fastapi import BackgroundTasks, HTTPException, UploadFile

    from backend.app.api.routes import admin

    monkeypatch.setattr(
        admin,
        "get_settings",
        lambda: SimpleNamespace(
            b2_audio_prefix="audio",
            audio_max_upload_bytes=512 * 1024 * 1024,
        ),
    )
    monkeypatch.setattr(admin, "get_b2_bucket", lambda: MagicMock())
    monkeypatch.setattr(
        admin, "head_b2_object", lambda _key: {"ContentLength": 5, "ContentType": "audio/mpeg"}
    )
    monkeypatch.setattr(admin, "delete_all_object_versions", AsyncMock())
    with pytest.raises(HTTPException) as error:
        await admin.finalize_direct_track_upload(
            object_key="audio/test.mp3",
            title="Song",
            artist="Artist",
            duration_seconds=1,
            mime_type="audio/mpeg",
            original_file_size=5,
            user=MagicMock(),
            session=MagicMock(rollback=AsyncMock()),
            background_tasks=BackgroundTasks(),
            artwork=UploadFile(BytesIO(b"x" * (5 * 1024 * 1024 + 1)), filename="cover.jpg"),
        )
    assert error.value.status_code == 413


@pytest.mark.parametrize("container", [b"CHAP", b"CTOC"])
def test_nested_compressed_id3_is_skipped_before_expansion(monkeypatch, container):
    import struct
    import zlib

    from mutagen.id3 import ID3

    from backend.app.services import audio_metadata as module

    payload = struct.pack(">I", 1024) + zlib.compress(b"\x03" + b"x" * 1023)
    nested = b"TIT2" + len(payload).to_bytes(4, "big") + b"\0\x80" + payload
    prefix = b"chapter\0" + (b"\0" * 16 if container == b"CHAP" else b"\0\0")
    body = prefix + nested
    frame = container + len(body).to_bytes(4, "big") + b"\0\0" + body
    size = len(frame)
    header = b"ID3\x03\0\0" + bytes((size >> 21, (size >> 14) & 127, (size >> 7) & 127, size & 127))
    monkeypatch.setattr(module, "MutagenFile", lambda source, **_kwargs: ID3(fileobj=source))
    expanded = []
    original = zlib.decompress

    def decompress(data):
        expanded.append(True)
        return original(data)

    monkeypatch.setattr(zlib, "decompress", decompress)
    assert module.extract_embedded_audio_metadata(header + frame)["title"] is None
    assert not expanded, "Nested ID3 compression reached Mutagen's unbounded decompressor"
