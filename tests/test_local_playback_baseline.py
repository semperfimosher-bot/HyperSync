from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient

from backend.app.main import app


@pytest.mark.asyncio
async def test_account_playback_state_is_authenticated_and_live_controls_are_removed() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Account playback state is intentionally available, but only to an
        # authenticated account. PATCH is not an exposed write method.
        response = await client.get("/api/users/me/playback-state")
        assert response.status_code == 401, response.text

        response = await client.patch("/api/users/me/playback-state", json={})
        assert response.status_code == 405, response.text

        # These legacy live-control and Jam endpoints must remain absent.
        for path in (
            "/api/users/me/playback-devices/poll",
            "/api/users/me/playback-devices/other-browser/commands",
            "/api/jams",
        ):
            response = await client.post(path, json={})
            assert response.status_code == 404, (path, response.text)


@pytest.mark.asyncio
async def test_removed_playback_socket_cannot_accept_a_connection() -> None:
    # Exercise routing: FastAPI may retain included routers rather than flatten
    # them into app.routes, so inspecting only top-level paths is insufficient.
    messages = []

    async def receive():
        return {"type": "websocket.connect"}

    async def send(message):
        assert message["type"] != "websocket.accept"
        messages.append(message)

    await app(
        {
            "type": "websocket",
            "asgi": {"version": "3.0"},
            "scheme": "ws",
            "path": "/api/users/me/playback-devices/live",
            "raw_path": b"/api/users/me/playback-devices/live",
            "root_path": "",
            "query_string": b"",
            "headers": [],
            "client": ("127.0.0.1", 12345),
            "server": ("test", 80),
            "subprotocols": [],
            "state": {},
        },
        receive,
        send,
    )
    assert messages[-1]["type"] == "websocket.close"


@pytest.mark.asyncio
async def test_same_account_sessions_remain_independent_and_share_library() -> None:
    username = "local-" + uuid4().hex[:12]
    password = "local-playback-regression-123"
    async with (
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as first,
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as second,
    ):
        registered = await first.post(
            "/api/auth/register",
            json={
                "username": username,
                "email": username + "@example.com",
                "password": password,
            },
        )
        assert registered.status_code == 201, registered.text
        sessions = []
        for client in (first, second):
            login = await client.post(
                "/api/auth/login",
                json={
                    "username": username,
                    "password": password,
                },
            )
            assert login.status_code == 200, login.text
            sessions.append({"Authorization": "Bearer " + login.json()["access_token"]})
        created = await first.post(
            "/api/playlists",
            headers=sessions[0],
            json={
                "title": "Shared library, local playback",
                "visibility": "private",
            },
        )
        assert created.status_code == 201, created.text
        listed = await second.get("/api/playlists/mine", headers=sessions[1])
        assert listed.status_code == 200, listed.text
        assert created.json()["id"] in [item["id"] for item in listed.json()]
        logged_out = await first.post("/api/auth/logout", headers=sessions[0])
        assert logged_out.status_code in (200, 204), logged_out.text
        assert (await first.get("/api/users/me", headers=sessions[0])).status_code == 401
        assert (await second.get("/api/users/me", headers=sessions[1])).status_code == 200
