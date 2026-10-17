from types import SimpleNamespace
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
