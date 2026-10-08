from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import WebSocketDisconnect

import backend.app.api.routes.users as users_routes
from backend.app.models.account import AccountType
from backend.app.services.playback_realtime import PlaybackRealtimeHub


class FakeWebSocket:
    def __init__(self, *messages: object) -> None:
        self.messages = list(messages)
        self.sent: list[dict] = []
        self.closed: list[tuple[int, str | None]] = []
        self.accepted = False

    async def accept(self) -> None:
        self.accepted = True

    async def receive_json(self) -> object:
        if not self.messages:
            raise WebSocketDisconnect()

        return self.messages.pop(0)

    async def send_json(self, payload: dict) -> None:
        self.sent.append(payload)

    async def close(
        self,
        code: int = 1000,
        reason: str | None = None,
    ) -> None:
        self.closed.append((code, reason))


class FakeSession:
    async def __aenter__(self) -> FakeSession:
        return self

    async def __aexit__(
        self,
        exc_type: object,
        exc: object,
        traceback: object,
    ) -> None:
        return None

    async def commit(self) -> None:
        return None


class FakeSessionFactory:
    def __call__(self) -> FakeSession:
        return FakeSession()


class FakeHub:
    def __init__(self) -> None:
        self.connections: dict[tuple[object, str], object] = {}
        self.events: list[tuple[str, dict]] = []

    async def connect(
        self,
        user_id: object,
        device_id: str,
        websocket: object,
    ) -> None:
        self.connections[(user_id, device_id)] = websocket

    async def disconnect(
        self,
        user_id: object,
        device_id: str,
        websocket: object,
    ) -> bool:
        key = (user_id, device_id)
        if self.connections.get(key) is not websocket:
            return False

        self.connections.pop(key, None)
        return True

    async def broadcast(
        self,
        user_id: object,
        payload: dict,
        *,
        exclude_device_id: str | None = None,
    ) -> None:
        self.events.append(("broadcast", payload))

    async def is_connected(
        self,
        user_id: object,
        device_id: str,
    ) -> bool:
        return (user_id, device_id) in self.connections


@pytest.mark.asyncio
async def test_realtime_hub_stale_disconnect_cannot_remove_replacement() -> None:
    hub = PlaybackRealtimeHub()
    user_id = uuid4()

    first = FakeWebSocket()
    second = FakeWebSocket()

    await hub.connect(user_id, "desktop-1", first)  # type: ignore[arg-type]
    await hub.connect(user_id, "desktop-1", second)  # type: ignore[arg-type]

    assert await hub.is_connected(user_id, "desktop-1")

    assert not await hub.disconnect(
        user_id,
        "desktop-1",
        first,  # type: ignore[arg-type]
    )

    assert await hub.is_connected(
        user_id,
        "desktop-1",
    )

    assert await hub.disconnect(
        user_id,
        "desktop-1",
        second,  # type: ignore[arg-type]
    )

    assert not await hub.is_connected(
        user_id,
        "desktop-1",
    )


@pytest.mark.asyncio
async def test_realtime_hub_failed_send_removes_dead_socket() -> None:
    hub = PlaybackRealtimeHub()
    user_id = uuid4()

    class FailingWebSocket:
        async def send_json(self, payload: dict) -> None:
            raise RuntimeError("socket closed")

        async def close(
            self,
            code: int = 1000,
            reason: str | None = None,
        ) -> None:
            return None

    socket = FailingWebSocket()

    await hub.connect(
        user_id,
        "desktop-1",
        socket,  # type: ignore[arg-type]
    )

    assert not await hub.send_to(
        user_id,
        "desktop-1",
        {"type": "ping"},
    )

    assert not await hub.is_connected(
        user_id,
        "desktop-1",
    )


@pytest.mark.asyncio
async def test_live_playback_socket_auth_command_heartbeat_and_cleanup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid4()
    device_id = "desktop-test"
    user = SimpleNamespace(
        id=user_id,
        account_type=AccountType.REGISTERED,
    )
    playback_state = SimpleNamespace(
        device_id=device_id,
        model_dump=lambda mode="json": {
            "device_id": device_id,
        },
    )
    command_response = SimpleNamespace(
        model_dump=lambda mode="json": {
            "id": "command-1",
            "target_device_id": device_id,
        },
    )
    playback_state_response = SimpleNamespace(
        model_dump=lambda mode="json": {
            "device_id": device_id,
            "track": None,
            "position_seconds": 4,
            "paused": False,
            "queue": [],
            "queue_index": None,
            "updated_at": "2026-10-08T00:00:00Z",
        },
    )
    playback_mutation = SimpleNamespace(
        state=playback_state_response,
        changed=True,
    )

    socket = FakeWebSocket(
        {
            "type": "authenticate",
            "access_token": "test-token",
            "device_id": device_id,
            "name": "Test Browser",
            "device_type": "desktop",
        },
        {
            "type": "command",
            "request_id": "request-1",
            "target_device_id": device_id,
            "action": "play",
        },
        {
            "type": "playback_state",
            "position_seconds": 4,
            "paused": False,
            "queue_track_ids": [],
            "queue_index": None,
        },
        {
            "type": "heartbeat",
        },
    )

    hub = FakeHub()

    async def fake_authenticate(
        session: object,
        token: str,
    ) -> object:
        assert token == "test-token"
        return user

    async def fake_command(
        target_device_id: str,
        payload: object,
        user_value: object,
        session: object,
    ) -> object:
        assert target_device_id == device_id
        return command_response

    update_calls = 0

    async def fake_update(
        payload: object,
        user_value: object,
        session: object,
    ) -> object:
        nonlocal update_calls
        update_calls += 1
        assert getattr(payload, "device_id") == device_id
        return playback_mutation

    async def noop(*args: object, **kwargs: object) -> None:
        return None

    async def fake_build_state(
        session: object,
        user_value: object,
    ) -> object:
        return playback_state

    async def fake_list_devices(
        session: object,
        user_value: object,
        *,
        active_device_id: str | None,
        now: object,
    ) -> list[object]:
        return []

    monkeypatch.setattr(
        users_routes,
        "get_session_factory",
        lambda: FakeSessionFactory(),
    )
    monkeypatch.setattr(
        users_routes,
        "authenticate_access_token",
        fake_authenticate,
    )
    monkeypatch.setattr(
        users_routes,
        "touch_playback_device",
        noop,
    )
    monkeypatch.setattr(
        users_routes,
        "prune_offline_playback_devices",
        noop,
    )
    monkeypatch.setattr(
        users_routes,
        "build_playback_state",
        fake_build_state,
    )
    monkeypatch.setattr(
        users_routes,
        "list_playback_devices",
        fake_list_devices,
    )
    monkeypatch.setattr(
        users_routes,
        "send_playback_device_command",
        fake_command,
    )
    monkeypatch.setattr(
        users_routes,
        "update_playback_state",
        fake_update,
    )
    monkeypatch.setattr(
        users_routes,
        "playback_realtime_hub",
        hub,
    )

    await users_routes.live_playback_device(socket)  # type: ignore[arg-type]  # type: ignore[arg-type]

    assert socket.accepted

    message_types = [
        payload.get("type")
        for payload in socket.sent
    ]

    assert message_types[:2] == [
        "ready",
        "command_ack",
    ]
    assert update_calls == 1
    assert any(
        payload.get("type") == "playback_state"
        for _, payload in hub.events
    )

    assert not hub.connections
    assert hub.events


@pytest.mark.asyncio
async def test_live_playback_socket_rejects_invalid_auth(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    socket = FakeWebSocket(
        {
            "type": "not-authenticate",
        },
    )

    await users_routes.live_playback_device(socket)  # type: ignore[arg-type]

    assert socket.closed == [(4401, None)]
