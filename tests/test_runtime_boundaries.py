from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

import backend.app.main as app_main
from backend.app.main import (
    _activity_description,
)
from backend.app.services.artists import (
    normalize_artist_name,
)
from backend.app.services.audio_metadata import (
    normalize_track_identity,
)
from bot.runtime import (
    active_background_tasks,
    shutdown_background_tasks,
    spawn_background_task,
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


@pytest.mark.asyncio
async def test_activity_logging_failure_does_not_break_successful_request(
    monkeypatch,
) -> None:
    from starlette.requests import Request
    from starlette.responses import Response

    async def failing_record_admin_activity(
        **_kwargs,
    ) -> None:
        raise RuntimeError(
            "simulated activity sink outage"
        )

    monkeypatch.setattr(
        app_main,
        "record_admin_activity",
        failing_record_admin_activity,
    )

    request = Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": "POST",
            "scheme": "https",
            "path": "/api/admin/bot/scan",
            "raw_path": b"/api/admin/bot/scan",
            "query_string": b"",
            "headers": [],
            "client": (
                "127.0.0.1",
                12345,
            ),
            "server": (
                "testserver",
                443,
            ),
            "root_path": "",
        }
    )

    async def call_next(
        _request,
    ):
        return Response(
            status_code=204,
        )

    response = (
        await app_main.admin_activity_notifications(
            request,
            call_next,
        )
    )

    assert response.status_code == 204


def test_bot_routes_use_tracked_background_runtime() -> None:
    source = Path(
        "backend/app/api/routes/bot.py",
    ).read_text(
        encoding="utf-8",
    )

    assert "asyncio.create_task(" not in source
    assert source.count(
        "spawn_background_task(",
    ) >= 2


def test_shared_transaction_helpers_do_not_rollback_caller_session() -> None:
    for relative_path in (
        "backend/app/services/generated_playlists.py",
        "backend/app/services/media_identity.py",
    ):
        source = Path(
            relative_path,
        ).read_text(
            encoding="utf-8",
        )

        assert "session.rollback(" not in source, (
            relative_path
            + " must leave outer transaction ownership "
            "to its caller; use savepoints for local races."
        )
