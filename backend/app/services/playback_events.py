"""Best-effort PostgreSQL LISTEN/NOTIFY bridge for playback hints."""

from __future__ import annotations

import asyncio
import json
import logging
import random
from collections.abc import Awaitable, Callable
from contextlib import suppress
from dataclasses import dataclass
from typing import Literal
from uuid import UUID, uuid4

import asyncpg
from sqlalchemy import text

from ..config import get_settings
from ..database import database_ssl_context

logger = logging.getLogger(__name__)

PLAYBACK_EVENT_CHANNEL = "hypersync_playback_events"
PLAYBACK_EVENT_VERSION = 1
PLAYBACK_EVENT_RECONNECT_BASE_SECONDS = 1.0
PLAYBACK_EVENT_RECONNECT_MAX_SECONDS = 30.0
PLAYBACK_EVENT_ORIGIN_ID = uuid4().hex
PlaybackEventKind = Literal[
    "command_ready",
    "playback_state_changed",
    "presence_changed",
]
_ALLOWED_KINDS = {
    "command_ready",
    "playback_state_changed",
    "presence_changed",
}


@dataclass(frozen=True)
class PlaybackEvent:
    kind: PlaybackEventKind
    user_id: UUID
    target_device_id: str | None = None
    source_device_id: str | None = None
    command_id: UUID | None = None
    version: int = PLAYBACK_EVENT_VERSION
    origin_id: str | None = None


def encode_playback_event(event: PlaybackEvent) -> str:
    if event.version != PLAYBACK_EVENT_VERSION or event.kind not in _ALLOWED_KINDS:
        raise ValueError("Unsupported playback event format.")
    if event.origin_id is not None and len(event.origin_id) > 64:
        raise ValueError("Invalid playback event origin.")

    payload = {
        "version": event.version,
        "kind": event.kind,
        "user_id": str(event.user_id),
        "target_device_id": event.target_device_id,
        "source_device_id": event.source_device_id,
        "command_id": str(event.command_id) if event.command_id else None,
        "origin_id": event.origin_id or PLAYBACK_EVENT_ORIGIN_ID,
    }
    encoded = json.dumps(payload, separators=(",", ":"), ensure_ascii=True)
    if len(encoded.encode("utf-8")) >= 7900:
        raise ValueError("Playback event payload is too large.")
    return encoded


def decode_playback_event(payload: str) -> PlaybackEvent | None:
    try:
        value = json.loads(payload)
        if not isinstance(value, dict):
            return None
        version = value.get("version")
        kind = value.get("kind")
        if type(version) is not int or version != PLAYBACK_EVENT_VERSION:
            return None
        if kind not in _ALLOWED_KINDS:
            return None

        user_id = UUID(str(value["user_id"]))
        command_id = UUID(str(value["command_id"])) if value.get("command_id") else None
        target_device_id = value.get("target_device_id")
        source_device_id = value.get("source_device_id")
        origin_id = value.get("origin_id")

        for device_id in (target_device_id, source_device_id):
            if device_id is not None and (
                not isinstance(device_id, str) or len(device_id) > 64
            ):
                return None
        if origin_id is not None and (
            not isinstance(origin_id, str) or len(origin_id) > 64
        ):
            return None
        if kind == "command_ready" and (
            command_id is None or not target_device_id
        ):
            return None

        return PlaybackEvent(
            kind=kind,
            user_id=user_id,
            target_device_id=target_device_id,
            source_device_id=source_device_id,
            command_id=command_id,
            version=version,
            origin_id=origin_id,
        )
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        return None


async def notify_playback_event(session, event: PlaybackEvent) -> None:
    """Queue a hint in the same transaction as its durable state change."""
    if not get_settings().asyncpg_playback_realtime_url:
        return
    await session.execute(
        text("SELECT pg_notify(:channel, :payload)"),
        {
            "channel": PLAYBACK_EVENT_CHANNEL,
            "payload": encode_playback_event(event),
        },
    )


def _reconnect_delay(attempt: int) -> float:
    base = min(
        PLAYBACK_EVENT_RECONNECT_MAX_SECONDS,
        PLAYBACK_EVENT_RECONNECT_BASE_SECONDS * (2 ** max(attempt - 1, 0)),
    )
    return base * random.uniform(0.75, 1.25)


async def run_playback_event_listener(
    handler: Callable[[PlaybackEvent], Awaitable[None]],
) -> None:
    """Listen on one dedicated direct asyncpg connection; failures are non-fatal."""
    settings = get_settings()
    dsn = settings.asyncpg_playback_realtime_url
    if not dsn:
        logger.info("Playback cross-replica bridge disabled; polling remains enabled.")
        return

    queue: asyncio.Queue[PlaybackEvent] = asyncio.Queue(maxsize=512)

    def on_notification(
        _connection: asyncpg.Connection,
        _pid: int,
        _channel: str,
        payload: str,
    ) -> None:
        event = decode_playback_event(payload)
        if event is None:
            logger.debug("Ignoring malformed or unsupported playback event.")
            return
        if event.origin_id == PLAYBACK_EVENT_ORIGIN_ID:
            return
        try:
            queue.put_nowait(event)
        except asyncio.QueueFull:
            logger.warning("Playback event queue full; dropping a best-effort hint.")

    async def consume() -> None:
        while True:
            event = await queue.get()
            try:
                await handler(event)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Playback event dispatch failed.")
            finally:
                queue.task_done()

    consumer_task = asyncio.create_task(consume(), name="playback-event-dispatch")
    attempt = 0
    try:
        while True:
            connection: asyncpg.Connection | None = None
            error: Exception | None = None
            try:
                connection = await asyncpg.connect(
                    dsn,
                    ssl=database_ssl_context(),
                    timeout=10,
                    command_timeout=10,
                )
                connection_terminated = asyncio.Event()

                def on_termination(_connection: asyncpg.Connection) -> None:
                    connection_terminated.set()

                connection.add_termination_listener(on_termination)
                await connection.add_listener(PLAYBACK_EVENT_CHANNEL, on_notification)
                logger.info("Playback cross-replica listener connected.")

                try:
                    await asyncio.wait_for(
                        connection_terminated.wait(),
                        timeout=30,
                    )
                except TimeoutError:
                    # Reset exponential backoff only after a stable connection;
                    # short connect/disconnect flaps must not retry every second.
                    attempt = 0
                    await connection_terminated.wait()

                error = ConnectionError("Playback listener connection closed.")
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                error = exc
            finally:
                if connection is not None and not connection.is_closed():
                    with suppress(Exception):
                        await connection.close()

            attempt += 1
            delay = _reconnect_delay(attempt)
            logger.warning(
                "Playback listener unavailable; retrying in %.1fs (%s).",
                delay,
                type(error).__name__ if error else "connection closed",
            )
            await asyncio.sleep(delay)
    finally:
        consumer_task.cancel()
        with suppress(asyncio.CancelledError):
            await consumer_task
