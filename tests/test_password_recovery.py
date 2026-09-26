from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from backend.app.api.routes import auth as auth_routes
from backend.app.config import get_settings
from backend.app.database import (
    get_engine,
    get_session_factory,
)
from backend.app.main import app
from backend.app.models.account import User
from backend.app.models.base import Base
from backend.app.services import email as email_service
from backend.app.security.rate_limit import (
    reset_rate_limits,
)


@pytest.fixture(autouse=True)
async def password_recovery_database_schema(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv(
        "JWT_SECRET",
        "password-recovery-test-secret-that-is-longer-than-thirty-two-characters",
    )
    monkeypatch.setenv(
        "PASSWORD_RECOVERY_SECRET",
        "dedicated-password-recovery-test-secret-that-is-long-enough",
    )
    monkeypatch.setenv(
        "AUTH_LOGIN_RATE_LIMIT",
        "1000",
    )
    monkeypatch.setenv(
        "AUTH_LOGIN_IP_RATE_LIMIT",
        "1000",
    )
    monkeypatch.setenv(
        "AUTH_PASSWORD_RECOVERY_RATE_LIMIT",
        "1000",
    )
    monkeypatch.setenv(
        "AUTH_PASSWORD_RECOVERY_IP_RATE_LIMIT",
        "1000",
    )

    get_settings.cache_clear()
    reset_rate_limits()

    async with get_engine().begin() as connection:
        await connection.run_sync(
            Base.metadata.create_all,
        )

    yield

    reset_rate_limits()
    get_settings.cache_clear()


async def _register(
    client: AsyncClient,
) -> tuple[str, str, str]:
    run_id = uuid4().hex[:10]
    username = f"recover-{run_id}"
    email = f"recover-{run_id}@example.com"
    password = "original-recovery-password"

    response = await client.post(
        "/api/auth/register",
        json={
            "username": username,
            "email": email,
            "password": password,
        },
    )

    assert response.status_code == 201, response.text

    return (
        username,
        email,
        password,
    )


@pytest.mark.asyncio
async def test_login_reports_specific_failure_reason() -> None:
    transport = ASGITransport(
        app=app,
    )

    async with AsyncClient(
        transport=transport,
        base_url="http://test",
    ) as client:
        (
            username,
            email,
            password,
        ) = await _register(
            client,
        )

        await client.post(
            "/api/auth/logout",
        )

        missing_username = await client.post(
            "/api/auth/login",
            json={
                "username":
                    "definitely-missing-user",
                "password":
                    password,
            },
        )

        assert (
            missing_username.status_code
            == 404
        )
        assert (
            missing_username.json()[
                "detail"
            ]
            == "No account exists with that username."
        )

        missing_email = await client.post(
            "/api/auth/login",
            json={
                "username":
                    "missing-account@example.com",
                "password":
                    password,
            },
        )

        assert (
            missing_email.status_code
            == 404
        )
        assert (
            missing_email.json()[
                "detail"
            ]
            == "No account exists with that email address."
        )

        wrong_password = await client.post(
            "/api/auth/login",
            json={
                "username":
                    username,
                "password":
                    "wrong-password",
            },
        )

        assert (
            wrong_password.status_code
            == 401
        )
        assert (
            wrong_password.json()[
                "detail"
            ]
            == "Incorrect password."
        )

        session_factory = (
            get_session_factory()
        )

        async with session_factory() as session:
            result = await session.execute(
                select(
                    User,
                ).where(
                    User.email
                    == email,
                )
            )

            user = (
                result.scalar_one()
            )

            user.is_active = False

            await session.commit()

        disabled = await client.post(
            "/api/auth/login",
            json={
                "username":
                    username,
                "password":
                    password,
            },
        )

        assert (
            disabled.status_code
            == 403
        )
        assert (
            disabled.json()[
                "detail"
            ]
            == "This account is disabled."
        )


@pytest.mark.asyncio
async def test_recovery_email_contains_use_code_button(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    delivered = []

    monkeypatch.setenv(
        "FRONTEND_PUBLIC_URL",
        "https://hypersynced.app",
    )
    monkeypatch.setenv(
        "SMTP_HOST",
        "smtp.example.test",
    )
    monkeypatch.setenv(
        "SMTP_FROM_EMAIL",
        "no-reply@example.test",
    )

    get_settings.cache_clear()

    def capture_message(message) -> None:
        delivered.append(
            message,
        )

    monkeypatch.setattr(
        email_service,
        "_deliver_message",
        capture_message,
    )

    await email_service.send_password_recovery_email(
        recipient_email="listener@example.com",
        username="listener",
        otp_code="123456",
        reset_token="reset-token-value",
        expires_minutes=15,
    )

    assert len(delivered) == 1

    message = delivered[0]
    html_parts = [
        part.get_content()
        for part in message.walk()
        if part.get_content_type() == "text/html"
    ]

    assert len(html_parts) == 1

    html = html_parts[0]

    assert "USE RECOVERY CODE" in html
    assert "123456" in html
    assert (
        "recovery_identifier=listener"
        in html
    )
    assert (
        "recovery_code=123456"
        in html
    )


@pytest.mark.asyncio
async def test_recovery_otp_signs_in_and_reset_link_changes_password(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sent_messages: list[dict] = []

    async def fake_send_password_recovery_email(
        **kwargs,
    ) -> None:
        sent_messages.append(
            kwargs,
        )

    monkeypatch.setattr(
        auth_routes,
        "send_password_recovery_email",
        fake_send_password_recovery_email,
    )

    transport = ASGITransport(
        app=app,
    )

    async with AsyncClient(
        transport=transport,
        base_url="http://test",
    ) as client:
        (
            username,
            _email,
            old_password,
        ) = await _register(
            client,
        )

        await client.post(
            "/api/auth/logout",
        )

        requested = await client.post(
            "/api/auth/password-recovery/request",
            json={
                "identifier":
                    username,
            },
        )

        assert (
            requested.status_code
            == 202
        ), requested.text
        assert len(
            sent_messages,
        ) == 1

        first_message = (
            sent_messages[-1]
        )

        wrong_code = (
            "000000"
            if first_message[
                "otp_code"
            ] != "000000"
            else "999999"
        )

        wrong_otp = await client.post(
            "/api/auth/password-recovery/verify-otp",
            json={
                "identifier":
                    username,
                "otp":
                    wrong_code,
            },
        )

        assert (
            wrong_otp.status_code
            == 401
        )
        assert (
            wrong_otp.json()[
                "detail"
            ]
            == "Recovery code is incorrect."
        )

        verified = await client.post(
            "/api/auth/password-recovery/verify-otp",
            json={
                "identifier":
                    username,
                "otp":
                    first_message[
                        "otp_code"
                    ],
            },
        )

        assert (
            verified.status_code
            == 200
        ), verified.text

        assert (
            verified.json()[
                "user"
            ][
                "username"
            ]
            == username
        )

        await client.post(
            "/api/auth/logout",
        )

        sent_messages.clear()

        requested_again = await client.post(
            "/api/auth/password-recovery/request",
            json={
                "identifier":
                    username,
            },
        )

        assert (
            requested_again.status_code
            == 202
        ), requested_again.text

        second_message = (
            sent_messages[-1]
        )

        new_password = (
            "updated-recovery-password"
        )

        reset = await client.post(
            "/api/auth/password-recovery/reset",
            json={
                "token":
                    second_message[
                        "reset_token"
                    ],
                "new_password":
                    new_password,
            },
        )

        assert (
            reset.status_code
            == 200
        ), reset.text

        old_login = await client.post(
            "/api/auth/login",
            json={
                "username":
                    username,
                "password":
                    old_password,
            },
        )

        assert (
            old_login.status_code
            == 401
        )

        new_login = await client.post(
            "/api/auth/login",
            json={
                "username":
                    username,
                "password":
                    new_password,
            },
        )

        assert (
            new_login.status_code
            == 200
        ), new_login.text
