from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from bot.runtime import (
    active_background_tasks,
    shutdown_background_tasks,
    spawn_background_task,
)
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


PROJECT_ROOT = (
    Path(__file__)
    .resolve()
    .parents[1]
)


def test_api_routes_do_not_spawn_untracked_background_tasks() -> None:
    route_root = (
        PROJECT_ROOT
        / "backend"
        / "app"
        / "api"
        / "routes"
    )

    offenders = []

    for path in sorted(
        route_root.glob(
            "*.py",
        )
    ):
        source = path.read_text(
            encoding="utf-8",
        )

        if "asyncio.create_task(" in source:
            offenders.append(
                path.name,
            )

    assert offenders == [], (
        "API routes must hand detached work to a tracked "
        "runtime/supervisor instead of raw asyncio.create_task: "
        + ", ".join(
            offenders,
        )
    )


def test_frontend_root_has_global_render_recovery_boundary() -> None:
    main_source = (
        PROJECT_ROOT
        / "frontend"
        / "src"
        / "main.jsx"
    ).read_text(
        encoding="utf-8",
    )

    assert (
        'import AppErrorBoundary from "./components/AppErrorBoundary.jsx";'
        in main_source
    )
    assert "<AppErrorBoundary>" in main_source
    assert "</AppErrorBoundary>" in main_source


def test_app_shell_does_not_reabsorb_admin_page_implementations() -> None:
    app_source = (
        PROJECT_ROOT
        / "frontend"
        / "src"
        / "App.jsx"
    ).read_text(
        encoding="utf-8",
    )

    forbidden = (
        "function AdminCatalogPage(",
        "function AdminBotPage(",
        "function AdminDashboardPage(",
        "function AdminUploadsPage(",
    )

    found = [
        marker
        for marker in forbidden
        if marker in app_source
    ]

    assert found == [], (
        "Keep admin page implementations isolated under "
        "components/pages instead of growing App.jsx again: "
        + ", ".join(
            found,
        )
    )
