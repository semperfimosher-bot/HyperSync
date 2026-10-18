from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException, Response

from backend.app.api.routes import admin
from backend.app.models.account import User, UserRole


def _reset_payload() -> admin.DeleteAllDatabaseDataRequest:
    return admin.DeleteAllDatabaseDataRequest(
        password="correct-test-admin-reset-password",
        confirmation=admin.ADMIN_DATABASE_DELETE_CONFIRMATION,
    )


def _admin_user() -> User:
    return User(id=uuid4(), role=UserRole.ADMIN)


@pytest.mark.asyncio
async def test_admin_reset_does_not_return_storage_exception_details(monkeypatch) -> None:
    monkeypatch.setattr(
        admin,
        "get_settings",
        lambda: SimpleNamespace(
            admin_database_delete_password="correct-test-admin-reset-password"
        ),
    )
    monkeypatch.setattr(admin, "get_b2_bucket", lambda: object())
    monkeypatch.setattr(
        admin,
        "delete_all_bucket_versions",
        AsyncMock(side_effect=RuntimeError("storage-private-detail")),
    )
    session = MagicMock()
    session.rollback = AsyncMock()

    with pytest.raises(HTTPException) as caught:
        await admin.delete_all_database_data(
            payload=_reset_payload(),
            response=Response(),
            user=_admin_user(),
            session=session,
        )

    assert caught.value.status_code == 500
    assert "storage-private-detail" not in caught.value.detail
    assert "database data was not wiped" in caught.value.detail.lower()
    session.rollback.assert_awaited_once()


@pytest.mark.asyncio
async def test_admin_reset_does_not_return_database_exception_details(monkeypatch) -> None:
    monkeypatch.setattr(
        admin,
        "get_settings",
        lambda: SimpleNamespace(
            admin_database_delete_password="correct-test-admin-reset-password"
        ),
    )
    monkeypatch.setattr(admin, "get_b2_bucket", lambda: object())
    monkeypatch.setattr(
        admin,
        "delete_all_bucket_versions",
        AsyncMock(return_value=3),
    )
    monkeypatch.setattr(
        admin,
        "_delete_all_database_rows",
        AsyncMock(side_effect=RuntimeError("database-private-detail")),
    )
    session = MagicMock()

    with pytest.raises(HTTPException) as caught:
        await admin.delete_all_database_data(
            payload=_reset_payload(),
            response=Response(),
            user=_admin_user(),
            session=session,
        )

    assert caught.value.status_code == 500
    assert "database-private-detail" not in caught.value.detail
    assert "storage objects were deleted" in caught.value.detail.lower()



@pytest.mark.asyncio
async def test_admin_diagnostics_does_not_return_database_exception_details(monkeypatch) -> None:
    async def fail_database(*args, **kwargs):
        raise RuntimeError("database-private-connection-detail")

    monkeypatch.setattr(
        admin,
        "run_blocking",
        AsyncMock(return_value=SimpleNamespace(name="fixture-bucket")),
    )
    session = SimpleNamespace(
        execute=fail_database,
        rollback=AsyncMock(),
    )

    result = await admin.admin_diagnostics(
        user=_admin_user(),
        session=cast(Any, session),
    )

    assert result["database"]["healthy"] is False
    assert result["database"]["message"] == (
        "Database check failed; inspect server logs."
    )
    assert "database-private-connection-detail" not in repr(result)


@pytest.mark.asyncio
async def test_admin_diagnostics_does_not_return_storage_exception_details(monkeypatch) -> None:
    async def execute(*args, **kwargs):
        return object()

    async def diagnostics(*args, **kwargs):
        return {
            "track_count": 0,
            "duplicate_groups": 0,
            "identity_backfill_pending": 0,
        }

    async def fail_storage(*args, **kwargs):
        raise RuntimeError("storage-private-credential-detail")

    monkeypatch.setattr(admin, "catalog_identity_diagnostics", diagnostics)
    monkeypatch.setattr(admin, "run_blocking", fail_storage)
    session = SimpleNamespace(
        execute=execute,
        rollback=AsyncMock(),
    )

    result = await admin.admin_diagnostics(
        user=_admin_user(),
        session=cast(Any, session),
    )

    assert result["storage"]["healthy"] is False
    assert result["storage"]["message"] == (
        "Storage check failed; inspect server logs."
    )
    assert "storage-private-credential-detail" not in repr(result)

@pytest.mark.asyncio
async def test_metadata_backfill_does_not_return_raw_parser_or_storage_errors(
    monkeypatch,
) -> None:
    private_detail = "storage-private-credential-detail"
    track = SimpleNamespace(
        id=uuid4(),
        title="Fixture Track",
        genre=None,
        release_year=None,
        b2_object_key="private/internal/object-key.mp3",
    )
    query_result = SimpleNamespace(
        scalars=lambda: SimpleNamespace(all=lambda: [track]),
    )
    session = SimpleNamespace(
        execute=AsyncMock(return_value=query_result),
        commit=AsyncMock(),
    )
    bucket = SimpleNamespace(
        download_file_by_name=MagicMock(
            side_effect=RuntimeError(private_detail),
        ),
    )

    async def run_blocking_inline(callback, *args, **kwargs):
        return callback(*args, **kwargs)

    monkeypatch.setattr(admin, "get_b2_bucket", lambda: bucket)
    monkeypatch.setattr(admin, "run_blocking", run_blocking_inline)

    result = await admin.backfill_track_metadata(
        user=_admin_user(),
        session=cast(Any, session),
        limit=1,
        external_limit=0,
    )

    assert result["failed"][0]["error"] == (
        "Embedded metadata could not be read."
    )
    assert private_detail not in repr(result)
    assert "private/internal/object-key.mp3" not in repr(result)
    session.commit.assert_awaited_once()
