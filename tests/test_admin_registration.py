from __future__ import annotations

import pytest
from fastapi import HTTPException

from backend.app.api.routes.auth import (
    enforce_admin_creation_authorization,
    resolve_registration_role,
)
from backend.app.models.account import (
    UserRole,
)


def test_normal_registration_is_never_auto_promoted_to_admin() -> None:
    role = resolve_registration_role(
        create_admin=False,
        provided_admin_password=None,
        configured_admin_password="server-secret-that-is-at-least-24-chars",
    )

    assert role == UserRole.USER


def test_admin_registration_accepts_matching_server_secret() -> None:
    role = resolve_registration_role(
        create_admin=True,
        provided_admin_password="server-secret-that-is-at-least-24-chars",
        configured_admin_password="server-secret-that-is-at-least-24-chars",
    )

    assert role == UserRole.ADMIN


def test_admin_registration_rejects_wrong_secret() -> None:
    with pytest.raises(
        HTTPException,
    ) as exc_info:
        resolve_registration_role(
            create_admin=True,
            provided_admin_password="wrong-secret",
            configured_admin_password="server-secret-that-is-at-least-24-chars",
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



def test_admin_registration_rejects_placeholder_server_secret() -> None:
    with pytest.raises(
        HTTPException,
    ) as exc_info:
        resolve_registration_role(
            create_admin=True,
            provided_admin_password=(
                "replace-with-admin-account-creation-password"
            ),
            configured_admin_password=(
                "replace-with-admin-account-creation-password"
            ),
        )

    assert (
        exc_info.value.status_code
        == 503
    )


def test_first_admin_can_be_bootstrapped_without_existing_admin() -> None:
    enforce_admin_creation_authorization(
        existing_admin=False,
        requester_role=None,
    )


def test_additional_admin_requires_authenticated_admin() -> None:
    with pytest.raises(
        HTTPException,
    ) as exc_info:
        enforce_admin_creation_authorization(
            existing_admin=True,
            requester_role=None,
        )

    assert (
        exc_info.value.status_code
        == 403
    )

    enforce_admin_creation_authorization(
        existing_admin=True,
        requester_role=UserRole.ADMIN,
    )
