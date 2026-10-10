from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime
from uuid import uuid4

import pytest

from backend.app.config import Settings
from backend.app.database import get_engine, get_session_factory
from backend.app.models.account import (
    AccountType,
    PlaybackCommand,
    User,
    UserRole,
)
from backend.app.models.base import Base
from backend.app.services.playback import handle_playback_event
from backend.app.services.playback_events import (
    PLAYBACK_EVENT_CHANNEL,
    PLAYBACK_EVENT_ORIGIN_ID,
    PlaybackEvent,
    decode_playback_event,
    encode_playback_event,
    notify_playback_event,
)
from backend.app.services.playback_realtime import PlaybackRealtimeHub


class FakeSocket:
    def __init__(self) -> None:
        self.sent: list[dict] = []

    async def send_json(self, payload: dict) -> None:
        self.sent.append(payload)

    async def close(self, code: int = 1000, reason: str | None = None) -> None:
        return None


def test_playback_event_round_trip_is_small_and_versioned() -> None:
    event = PlaybackEvent(
        kind="command_ready",
        user_id=uuid4(),
        target_device_id="phone-1",
        source_device_id="desktop-1",
        command_id=uuid4(),
    )
    encoded = encode_playback_event(event)
    decoded = decode_playback_event(encoded)

    assert len(encoded.encode("utf-8")) < 7900
    assert decoded is not None
    assert decoded.version == 1
    assert decoded.kind == event.kind
    assert decoded.user_id == event.user_id
    assert decoded.target_device_id == event.target_device_id
    assert decoded.source_device_id == event.source_device_id
    assert decoded.command_id == event.command_id
    assert decoded.origin_id == PLAYBACK_EVENT_ORIGIN_ID
    assert PLAYBACK_EVENT_CHANNEL == "hypersync_playback_events"


@pytest.mark.parametrize(
    "payload",
    [
        "",
        "{",
        "[]",
        json.dumps({"version": 2, "kind": "presence_changed", "user_id": str(uuid4())}),
        json.dumps({"version": 1, "kind": "unknown", "user_id": str(uuid4())}),
        json.dumps({"version": 1, "kind": "command_ready", "user_id": str(uuid4())}),
        json.dumps({"version": 1, "kind": "presence_changed", "user_id": "not-a-uuid"}),
    ],
)
def test_malformed_or_future_playback_events_are_ignored(payload: str) -> None:
    assert decode_playback_event(payload) is None


def test_direct_listener_url_uses_asyncpg_scheme_and_removes_libpq_options() -> None:
    settings = Settings(
        database_url="postgresql://app:secret@db.example.test/app",
        playback_realtime_database_url=(
            "postgresql+asyncpg://listener:secret@db-direct.example.test/app"
            "?sslmode=require&channel_binding=require"
        ),
    )
    assert settings.asyncpg_playback_realtime_url == (
        "postgresql://listener:secret@db-direct.example.test/app"
    )


@pytest.mark.asyncio
async def test_notify_is_noop_when_bridge_is_not_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.app.services import playback_events

    class SessionThatMustNotExecute:
        async def execute(self, *args, **kwargs):
            raise AssertionError("Disabled bridge must not issue pg_notify.")

    monkeypatch.setattr(
        playback_events,
        "get_settings",
        lambda: type("SettingsStub", (), {"asyncpg_playback_realtime_url": ""})(),
    )
    await notify_playback_event(
        SessionThatMustNotExecute(),
        PlaybackEvent(kind="presence_changed", user_id=uuid4()),
    )


@pytest.mark.asyncio
async def test_command_event_is_delivered_only_by_replica_with_target_socket() -> None:
    async with get_engine().begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async with get_session_factory()() as session:
        username = "event-" + uuid4().hex[:10]
        user = User(
            username=username,
            username_normalized=username.lower(),
            email=uuid4().hex + "@example.test",
            password_hash="unused",
            role=UserRole.USER,
            account_type=AccountType.REGISTERED,
            is_active=True,
        )
        session.add(user)
        await session.flush()
        command = PlaybackCommand(
            user_id=user.id,
            target_device_id="target-device",
            source_device_id="controller",
            action="pause",
            value=None,
            consumed_at=None,
            created_at=datetime.now(UTC),
        )
        session.add(command)
        await session.commit()
        event = PlaybackEvent(
            kind="command_ready",
            user_id=user.id,
            target_device_id="target-device",
            source_device_id="controller",
            command_id=command.id,
        )
        user_id = user.id
        command_id = command.id

    replica_a = PlaybackRealtimeHub()
    replica_b = PlaybackRealtimeHub()
    socket = FakeSocket()
    await replica_b.connect(user_id, "target-device", socket)  # type: ignore[arg-type]

    await asyncio.wait_for(
        handle_playback_event(event, hub=replica_a),
        timeout=10,
    )
    async with get_session_factory()() as session:
        stored = await session.get(PlaybackCommand, command_id)
        assert stored is not None and stored.consumed_at is None

    await asyncio.wait_for(
        handle_playback_event(event, hub=replica_b),
        timeout=10,
    )
    assert len(socket.sent) == 1
    assert socket.sent[0]["type"] == "command"

    await asyncio.wait_for(
        handle_playback_event(event, hub=replica_b),
        timeout=10,
    )
    assert len(socket.sent) == 1

    async with get_session_factory()() as session:
        stored = await session.get(PlaybackCommand, command_id)
        assert stored is not None and stored.consumed_at is not None



@pytest.mark.asyncio
async def test_listener_connection_failure_retries_with_bounded_backoff(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.app.services import playback_events

    settings = Settings(
        database_url="postgresql://app:secret@db.example.test/app",
        playback_realtime_database_url=(
            "postgresql://listener:secret@db-direct.example.test/app"
        ),
    )
    monkeypatch.setattr(playback_events, "get_settings", lambda: settings)

    connect_attempts = 0

    async def fail_connect(*args, **kwargs):
        nonlocal connect_attempts
        connect_attempts += 1
        raise OSError("temporary database outage")

    monkeypatch.setattr(playback_events.asyncpg, "connect", fail_connect)

    delays: list[float] = []
    attempts: list[int] = []

    def reconnect_delay(attempt: int) -> float:
        attempts.append(attempt)
        return 1.25

    async def stop_after_first_retry(delay: float) -> None:
        delays.append(delay)
        raise asyncio.CancelledError

    monkeypatch.setattr(playback_events, "_reconnect_delay", reconnect_delay)
    monkeypatch.setattr(playback_events.asyncio, "sleep", stop_after_first_retry)

    with pytest.raises(asyncio.CancelledError):
        await playback_events.run_playback_event_listener(lambda _event: asyncio.sleep(0))

    assert connect_attempts == 1
    assert attempts == [1]
    assert delays == [1.25]


def test_listener_reconnect_delay_grows_exponentially_and_is_capped(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.app.services import playback_events

    monkeypatch.setattr(playback_events.random, "uniform", lambda low, high: low)
    assert playback_events._reconnect_delay(1) == 0.75
    assert playback_events._reconnect_delay(2) == 1.5
    assert playback_events._reconnect_delay(6) == 24.0
    assert playback_events._reconnect_delay(7) == 22.5

    monkeypatch.setattr(playback_events.random, "uniform", lambda low, high: high)
    assert playback_events._reconnect_delay(7) == 30.0
