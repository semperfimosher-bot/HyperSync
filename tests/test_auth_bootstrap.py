import pytest
from httpx import ASGITransport, AsyncClient

from backend.app.main import app


@pytest.mark.asyncio
async def test_first_admin_bootstrap_then_normal_registration() -> None:
    transport = ASGITransport(
        app=app,
        client=("198.51.100.20", 12345),
    )

    async with AsyncClient(
        transport=transport,
        base_url="http://test",
    ) as client:
        status_before = await client.get(
            "/api/auth/bootstrap-status",
        )

        assert status_before.status_code == 200
        assert (
            status_before.json()["registration_mode"]
            == "admin_setup"
        )

        blocked = await client.post(
            "/api/auth/register",
            json={
                "username": "bootstrap-blocked",
                "email": "bootstrap-blocked@example.com",
                "password": "long-enough-password",
            },
        )

        assert blocked.status_code == 403

        first = await client.post(
            "/api/auth/register",
            json={
                "username": "bootstrap-admin",
                "email": "bootstrap-admin@example.com",
                "password": "long-enough-password",
                "admin_setup_code": (
                    "ci-test-admin-bootstrap-secret-1234567890"
                ),
            },
        )

        assert first.status_code == 201
        assert first.json()["user"]["role"] == "admin"

        status_after = await client.get(
            "/api/auth/bootstrap-status",
        )

        assert status_after.status_code == 200
        assert (
            status_after.json()["registration_mode"]
            == "user"
        )

        second = await client.post(
            "/api/auth/register",
            json={
                "username": "bootstrap-user",
                "email": "bootstrap-user@example.com",
                "password": "long-enough-password",
            },
        )

        assert second.status_code == 201
        assert second.json()["user"]["role"] == "user"
