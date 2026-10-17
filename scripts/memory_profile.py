"""Fresh-process fixture memory measurements, not production capacity claims."""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import tracemalloc
from pathlib import Path
from types import SimpleNamespace
from typing import cast
from uuid import UUID


def track(index):
    from backend.app.models.media import Track
    return cast(Track, SimpleNamespace(
        id=UUID(int=index + 1),
        title=f"Song {index:08}",
        artist="Fixture Artist",
        album="Album",
        genre="Electronic",
        release_year=2020,
        duration_seconds=180,
        mime_type="audio/mpeg",
        file_size=1000000,
        b2_object_key="https://fixture.invalid/audio",
        artwork_object_key=None,
    ))


async def catalog_work(mode, count):
    from starlette.responses import JSONResponse

    from backend.app.api.routes import catalog

    class Session:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def stream(self, statement):
            return self

        def scalars(self):
            return self

        async def partitions(self, size):
            for start in range(0, count, size):
                yield [track(index) for index in range(start, min(count, start + size))]

        async def close(self):
            pass

    catalog.get_session_factory = lambda: Session
    tracemalloc.start()
    digest = hashlib.sha256()
    if mode == "catalog_bulk_reference":
        rows = [track(index) for index in range(count)]
        items = catalog._catalog_track_responses(rows)
        response = JSONResponse([item.model_dump(mode="json") for item in items])
        size = len(response.body)
        digest.update(response.body)
    else:
        response = await catalog._legacy_catalog_response("", {})
        size = 0
        try:
            async for chunk in response.body_iterator:
                assert isinstance(chunk, bytes)
                size += len(chunk)
                digest.update(chunk)
        finally:
            await response.close()
    return size, digest.hexdigest()


def audio_work(count):
    from backend.app.api.routes.admin import _copy_upload_to_path
    from backend.app.services.audio_compression import compress_audio_file_for_storage

    with tempfile.TemporaryDirectory(prefix="hs-memory-") as directory:
        source = Path(directory) / "source.mp3"
        with source.open("wb") as file:
            file.truncate(count)
        tracemalloc.start()
        copied = Path(directory) / "copied.mp3"
        with source.open("rb") as file:
            _copy_upload_to_path(file, copied)
        result = compress_audio_file_for_storage(
            copied,
            Path(directory) / "output.mp3",
            filename="source.mp3",
            mime_type="audio/mpeg",
            title="Fixture",
            artist="Fixture",
            album=None,
            genre=None,
            artwork_data=None,
            artwork_mime_type=None,
            enabled=False,
            mp3_vbr_quality=2,
            min_source_kbps=256,
            min_savings_percent=10,
            timeout_seconds=10,
        )
        if result.output_path != copied or result.final_size != count:
            raise AssertionError("Disk processing changed the source")
        return result.final_size, None


def child(mode, count):
    from backend.app.config import Settings

    Settings.model_config["env_file"] = None
    os.environ.update(
        ENVIRONMENT="test",
        DATABASE_URL="postgresql://test:test@127.0.0.1/not_used",
        JWT_SECRET="memory-fixture-secret-at-least-32-characters",
    )
    size, digest = (
        audio_work(count) if mode == "audio_disk" else asyncio.run(catalog_work(mode, count))
    )
    _, peak = tracemalloc.get_traced_memory()
    try:
        import resource

        rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        rss_bytes = int(rss * (1 if sys.platform == "darwin" else 1024))
    except ImportError:
        rss_bytes = None
    return {
        "mode": mode,
        "input_count_or_bytes": count,
        "output_bytes": size,
        "sha256": digest,
        "peak_python_bytes": peak,
        "peak_rss_bytes": rss_bytes,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--worker", choices=["catalog_bulk_reference", "catalog_disk", "audio_disk"]
    )
    parser.add_argument("--count", type=int, default=0)
    parser.add_argument("--output", type=Path, default=Path("verification-results/memory.json"))
    args = parser.parse_args()
    if args.worker:
        maximum = 64 * 1024 * 1024 if args.worker == "audio_disk" else 10000
        if not 0 < args.count <= maximum:
            parser.error("Fixture size must be positive and bounded")
        print(json.dumps(child(args.worker, args.count)))
        return 0
    results = []
    for mode, sizes in [
        ("catalog_bulk_reference", [1000, 10000]),
        ("catalog_disk", [1000, 10000]),
        ("audio_disk", [8 * 1024 * 1024, 64 * 1024 * 1024]),
    ]:
        for count in sizes:
            completed = subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "scripts.memory_profile",
                    "--worker",
                    mode,
                    "--count",
                    str(count),
                ],
                capture_output=True,
                text=True,
                timeout=90,
                check=True,
            )
            results.append(json.loads(completed.stdout))
    small, large = results[2:4]
    audio_small, audio_large = results[4:6]
    checks = {
        "json_equivalence": all(
            results[index]["sha256"] == results[index + 2]["sha256"] for index in range(2)
        ),
        "bounded_catalog_growth": large["peak_python_bytes"]
        <= small["peak_python_bytes"] * 1.5 + 2 * 1024 * 1024,
        "catalog_peak_reduced": large["peak_python_bytes"] < results[1]["peak_python_bytes"] / 2,
        "bounded_audio_growth": audio_large["peak_python_bytes"]
        <= audio_small["peak_python_bytes"] + 2 * 1024 * 1024,
    }
    report = {
        "evidence": "Fresh Python processes; synthetic catalog session and disk copy/compression "
        "disabled. RSS includes imports; traced peak excludes imports. No DB, live B2 or FFmpeg "
        "capacity measurement. Temporary storage must be disk-backed, not tmpfs.",
        "passed": all(checks.values()),
        "checks": checks,
        "results": results,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
