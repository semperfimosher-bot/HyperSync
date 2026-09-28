from __future__ import annotations

import asyncio

import pytest

from bot.runtime import (
    active_background_tasks,
    shutdown_background_tasks,
    spawn_background_task,
)
from backend.app.main import (
    _activity_description,
)
from backend.app.services.artists import (
    normalize_artist_name,
)
from backend.app.services.audio_metadata import (
    normalize_track_identity,
)


@pytest.mark.asyncio
async def test_background_tasks_are_tracked_and_shutdown_cleanly() -> None:
    started = asyncio.Event()
    cancelled = asyncio.Event()

    async def worker() -> None:
        started.set()

        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            cancelled.set()
            raise

    task = spawn_background_task(
        worker(),
        name="test-background-worker",
    )

    await started.wait()

    assert task in active_background_tasks()

    await shutdown_background_tasks()

    assert cancelled.is_set()
    assert task.cancelled()
    assert active_background_tasks() == ()


@pytest.mark.asyncio
async def test_completed_background_task_is_removed() -> None:
    async def worker() -> int:
        await asyncio.sleep(
            0,
        )
        return 42

    task = spawn_background_task(
        worker(),
        name="test-completed-worker",
    )

    assert await task == 42

    await asyncio.sleep(
        0,
    )

    assert task not in active_background_tasks()


def test_admin_bot_activity_is_classified_as_bot_activity() -> None:
    assert _activity_description(
        "POST",
        "/api/admin/bot/scan",
    ) == (
        "bot",
        "Bot control activity",
    )

    assert _activity_description(
        "DELETE",
        "/api/admin/tracks/example",
    ) == (
        "admin",
        "Administrator action",
    )


def test_artist_and_track_identity_share_normalization() -> None:
    value = "  Café\u00a0Artist  "

    assert normalize_artist_name(
        value,
    ) == normalize_track_identity(
        value,
    )
