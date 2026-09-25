from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from backend.app.config import get_settings
from backend.app.database import (
    get_engine,
    get_session_factory,
)
from backend.app.main import app
from backend.app.models.account import (
    UserSession,
)
from backend.app.models.base import Base
from backend.app.security.tokens import (
    create_refresh_token,
    decode_access_token,
    hash_refresh_token,
)


@pytest.fixture(autouse=True)
async def auth_session_database_schema(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv(
        "JWT_SECRET",
        "auth-session-test-secret-that-is-longer-than-thirty-two-characters",
    )
    monkeypatch.setenv(
        "JWT_ISSUER",
        "hypersync-auth-session-test",
    )
    monkeypatch.setenv(
        "JWT_AUDIENCE",
        "hypersync-auth-session-client",
    )
    monkeypatch.setenv(
        "ACCESS_TOKEN_TTL_MINUTES",
        "60",
    )
    monkeypatch.setenv(
        "AUTH_REGISTER_RATE_LIMIT",
        "1000",
    )
    monkeypatch.setenv(
        "AUTH_LOGIN_IP_RATE_LIMIT",
        "1000",
    )
    monkeypatch.setenv(
        "AUTH_REFRESH_RATE_LIMIT",
        "1000",
    )

    get_settings.cache_clear()

    async with get_engine().begin() as connection:
        await connection.run_sync(
            Base.metadata.create_all,
        )

    yield

    get_settings.cache_clear()


async def _register(
    client: AsyncClient,
) -> dict:
    run_id = uuid4().hex[:10]

    response = await client.post(
        "/api/auth/register",
        json={
            "username": f"session-{run_id}",
            "email": f"session-{run_id}@example.com",
            "password": "stable-session-test-password",
        },
    )

    assert response.status_code == 201, response.text

    return response.json()


@pytest.mark.asyncio
async def test_refresh_keeps_one_stable_browser_session_and_purges_dead_rows() -> None:
    transport = ASGITransport(
        app=app,
    )

    async with AsyncClient(
        transport=transport,
        base_url="http://test",
    ) as client:
        registered = await _register(
            client,
        )

        first_claims = decode_access_token(
            registered["access_token"],
        )

        refresh_token = client.cookies.get(
            "hypersync_refresh",
        )

        assert refresh_token

        session_factory = (
            get_session_factory()
        )

        async with session_factory() as session:
            current = await session.get(
                UserSession,
                first_claims.session_id,
            )

            assert current is not None

            session.add(
                UserSession(
                    user_id=current.user_id,
                    family_id=current.family_id,
                    refresh_token_hash=(
                        hash_refresh_token(
                            create_refresh_token(),
                        )
                    ),
                    expires_at=(
                        datetime.now(UTC)
                        + timedelta(days=2)
                    ),
                    revoked_at=datetime.now(UTC),
                    revoke_reason="rotated",
                )
            )

            session.add(
                UserSession(
                    user_id=current.user_id,
                    family_id=current.family_id,
                    refresh_token_hash=(
                        hash_refresh_token(
                            create_refresh_token(),
                        )
                    ),
                    expires_at=(
                        datetime.now(UTC)
                        - timedelta(seconds=1)
                    ),
                )
            )

            await session.commit()

        refreshed = await client.post(
            "/api/auth/refresh",
        )

        assert refreshed.status_code == 200, refreshed.text

        second_claims = decode_access_token(
            refreshed.json()[
                "access_token"
            ],
        )

        assert (
            second_claims.session_id
            == first_claims.session_id
        )

        rotated_refresh_token = (
            client.cookies.get(
                "hypersync_refresh",
            )
        )

        assert rotated_refresh_token
        assert (
            rotated_refresh_token
            != refresh_token
        )

        # Simulate a second tab that started
        # refreshing with the just-rotated
        # token before the first response
        # updated the shared browser cookie.
        async with AsyncClient(
            transport=transport,
            base_url="http://test",
            headers={
                "Cookie":
                    f"hypersync_refresh={refresh_token}",
            },
        ) as stale_tab:
            concurrent = await stale_tab.post(
                "/api/auth/refresh",
            )

            assert (
                concurrent.status_code
                == 200
            ), concurrent.text

            concurrent_claims = (
                decode_access_token(
                    concurrent.json()[
                        "access_token"
                    ],
                )
            )

            assert (
                concurrent_claims.session_id
                == first_claims.session_id
            )

            concurrent_refresh_token = (
                stale_tab.cookies.get(
                    "hypersync_refresh",
                )
            )

            assert concurrent_refresh_token

        async with session_factory() as session:
            row = await session.get(
                UserSession,
                first_claims.session_id,
            )

            assert row is not None
            assert row.revoked_at is None
            assert (
                row.refresh_token_hash
                == hash_refresh_token(
                    concurrent_refresh_token,
                )
            )

            assert (
                row.previous_refresh_token_hash
                == hash_refresh_token(
                    rotated_refresh_token,
                )
            )

            assert (
                row.previous_refresh_valid_until
                is not None
            )

            count_result = (
                await session.execute(
                    select(
                        func.count(
                            UserSession.id,
                        )
                    ).where(
                        UserSession.user_id
                        == row.user_id,
                    )
                )
            )

            assert count_result.scalar_one() == 1


@pytest.mark.asyncio
async def test_legacy_reuse_row_deletes_only_itself_not_live_sibling() -> None:
    transport = ASGITransport(
        app=app,
    )

    async with AsyncClient(
        transport=transport,
        base_url="http://test",
    ) as client:
        registered = await _register(
            client,
        )

        claims = decode_access_token(
            registered["access_token"],
        )

        session_factory = (
            get_session_factory()
        )

        sibling_id = uuid4()

        async with session_factory() as session:
            current = await session.get(
                UserSession,
                claims.session_id,
            )

            assert current is not None

            current.revoked_at = (
                datetime.now(UTC)
            )
            current.revoke_reason = (
                "refresh_reuse_detected"
            )

            sibling_token = (
                create_refresh_token()
            )

            session.add(
                UserSession(
                    id=sibling_id,
                    user_id=current.user_id,
                    family_id=current.family_id,
                    refresh_token_hash=(
                        hash_refresh_token(
                            sibling_token,
                        )
                    ),
                    expires_at=(
                        datetime.now(UTC)
                        + timedelta(days=2)
                    ),
                )
            )

            await session.commit()

        response = await client.post(
            "/api/auth/refresh",
        )

        assert response.status_code == 401

        async with session_factory() as session:
            dead = await session.get(
                UserSession,
                claims.session_id,
            )

            live = await session.get(
                UserSession,
                sibling_id,
            )

            assert dead is None
            assert live is not None
            assert live.revoked_at is None


@pytest.mark.asyncio
async def test_logout_physically_deletes_current_browser_session() -> None:
    transport = ASGITransport(
        app=app,
    )

    async with AsyncClient(
        transport=transport,
        base_url="http://test",
    ) as client:
        registered = await _register(
            client,
        )

        claims = decode_access_token(
            registered["access_token"],
        )

        response = await client.post(
            "/api/auth/logout",
        )

        assert response.status_code == 200

        session_factory = (
            get_session_factory()
        )

        async with session_factory() as session:
            row = await session.get(
                UserSession,
                claims.session_id,
            )

            assert row is None


@pytest.mark.asyncio
async def test_expired_access_session_deletes_itself_from_database() -> None:
    transport = ASGITransport(
        app=app,
    )

    async with AsyncClient(
        transport=transport,
        base_url="http://test",
    ) as client:
        registered = await _register(
            client,
        )

        access_token = registered[
            "access_token"
        ]

        claims = decode_access_token(
            access_token,
        )

        session_factory = (
            get_session_factory()
        )

        async with session_factory() as session:
            row = await session.get(
                UserSession,
                claims.session_id,
            )

            assert row is not None

            row.expires_at = (
                datetime.now(UTC)
                - timedelta(seconds=1)
            )

            await session.commit()

        response = await client.get(
            "/api/users/me",
            headers={
                "Authorization":
                    f"Bearer {access_token}",
            },
        )

        assert response.status_code == 401

        async with session_factory() as session:
            row = await session.get(
                UserSession,
                claims.session_id,
            )

            assert row is None
