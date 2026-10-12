from __future__ import annotations

import pytest
from pathlib import Path

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
            "path": "/api/admin/tracks",
            "raw_path": b"/api/admin/tracks",
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
