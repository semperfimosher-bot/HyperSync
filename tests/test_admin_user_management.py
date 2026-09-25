from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from backend.app.api.routes import (
    admin as admin_routes,
)


class FakeSession:
    def __init__(self) -> None:
        self.deleted = []
        self.committed = False
        self.rolled_back = False

    async def delete(
        self,
        value,
    ) -> None:
        self.deleted.append(
            value,
        )

    async def commit(
        self,
    ) -> None:
        self.committed = True

    async def rollback(
        self,
    ) -> None:
        self.rolled_back = True


@pytest.mark.asyncio
async def test_admin_user_delete_removes_avatar_then_database_account(
    monkeypatch,
) -> None:
    session = FakeSession()

    target = SimpleNamespace(
        profile=SimpleNamespace(
            avatar_object_key=(
                "avatars/user.png"
            ),
        ),
    )

    bucket = object()

    monkeypatch.setattr(
        admin_routes,
        "get_b2_bucket",
        lambda: bucket,
    )

    calls = []

    async def delete_versions(
        received_bucket,
        object_key,
    ):
        calls.append(
            (
                received_bucket,
                object_key,
            )
        )

        return 3

    monkeypatch.setattr(
        admin_routes,
        "delete_all_object_versions",
        delete_versions,
    )

    deleted_versions = (
        await admin_routes
        ._delete_admin_selected_user(
            session,
            target,
        )
    )

    assert deleted_versions == 3

    assert calls == [
        (
            bucket,
            "avatars/user.png",
        ),
    ]

    assert session.deleted == [
        target,
    ]

    assert session.committed is True
    assert session.rolled_back is False


@pytest.mark.asyncio
async def test_admin_user_delete_stops_if_avatar_cleanup_fails(
    monkeypatch,
) -> None:
    session = FakeSession()

    target = SimpleNamespace(
        profile=SimpleNamespace(
            avatar_object_key=(
                "avatars/user.png"
            ),
        ),
    )

    monkeypatch.setattr(
        admin_routes,
        "get_b2_bucket",
        lambda: object(),
    )

    async def fail_delete(
        _bucket,
        _object_key,
    ):
        raise RuntimeError(
            "B2 unavailable",
        )

    monkeypatch.setattr(
        admin_routes,
        "delete_all_object_versions",
        fail_delete,
    )

    with pytest.raises(
        HTTPException,
    ) as exc_info:
        await admin_routes             ._delete_admin_selected_user(
                session,
                target,
            )

    assert (
        exc_info.value.status_code
        == 500
    )

    assert session.deleted == []
    assert session.committed is False
    assert session.rolled_back is True
