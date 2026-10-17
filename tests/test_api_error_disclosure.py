from types import SimpleNamespace
from typing import Any, cast
from uuid import uuid4

import pytest
from fastapi import HTTPException

from backend.app.api.routes import messages as messages_route
from backend.app.models.account import User, UserRole


@pytest.mark.asyncio
async def test_push_subscription_validation_does_not_echo_exception_details(monkeypatch) -> None:
    def fail_validation(_endpoint: str) -> str:
        raise ValueError("private-endpoint-validation-detail")

    monkeypatch.setattr(
        messages_route,
        "validate_push_endpoint",
        fail_validation,
    )

    with pytest.raises(HTTPException) as caught:
        await messages_route.subscribe_push(
            payload=cast(Any, SimpleNamespace(endpoint="https://push.example.test/private")),
            request=cast(Any, None),
            user=User(id=uuid4(), role=UserRole.USER),
            session=cast(Any, None),
        )

    assert caught.value.status_code == 400
    assert "private-endpoint-validation-detail" not in caught.value.detail
    assert caught.value.detail == "Invalid push subscription endpoint."
