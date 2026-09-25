from __future__ import annotations

import pytest
from fastapi import HTTPException

from backend.app.api.routes.auth import (
    resolve_registration_role,
)
from backend.app.models.account import (
    UserRole,
)


def test_normal_registration_is_never_auto_promoted_to_admin() -> None:
    role = resolve_registration_role(
        create_admin=False,
        provided_admin_password=None,
        configured_admin_password="server-secret",
    )

    assert role == UserRole.USER


def test_admin_registration_accepts_matching_server_secret() -> None:
    role = resolve_registration_role(
        create_admin=True,
        provided_admin_password="server-secret",
        configured_admin_password="server-secret",
    )

    assert role == UserRole.ADMIN


def test_admin_registration_rejects_wrong_secret() -> None:
    with pytest.raises(
        HTTPException,
    ) as exc_info:
        resolve_registration_role(
            create_admin=True,
            provided_admin_password="wrong-secret",
            configured_admin_password="server-secret",
        )

    assert (
        exc_info.value.status_code
        == 403
    )


def test_admin_registration_requires_server_configuration() -> None:
    with pytest.raises(
        HTTPException,
    ) as exc_info:
        resolve_registration_role(
            create_admin=True,
            provided_admin_password="anything",
            configured_admin_password="",
        )

    assert (
        exc_info.value.status_code
        == 503
    )
