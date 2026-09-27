from __future__ import annotations

import asyncio
from collections import defaultdict
from uuid import UUID

from fastapi import WebSocket


class PlaybackRealtimeHub:
    def __init__(self) -> None:
        self._connections: dict[
            UUID,
            dict[str, WebSocket],
        ] = defaultdict(dict)

        self._lock = asyncio.Lock()

    async def connect(
        self,
        user_id: UUID,
        device_id: str,
        websocket: WebSocket,
    ) -> None:
        previous: WebSocket | None = None

        async with self._lock:
            previous = (
                self._connections[
                    user_id
                ].get(
                    device_id,
                )
            )

            self._connections[
                user_id
            ][device_id] = websocket

        if (
            previous is not None
            and previous is not websocket
        ):
            try:
                await previous.close(
                    code=4001,
                )
            except Exception:
                pass

    async def disconnect(
        self,
        user_id: UUID,
        device_id: str,
        websocket: WebSocket,
    ) -> bool:
        async with self._lock:
            devices = (
                self._connections.get(
                    user_id,
                )
            )

            if (
                not devices
                or devices.get(
                    device_id,
                )
                is not websocket
            ):
                return False

            devices.pop(
                device_id,
                None,
            )

            if not devices:
                self._connections.pop(
                    user_id,
                    None,
                )

            return True

    async def connected_device_ids(
        self,
        user_id: UUID,
    ) -> set[str]:
        async with self._lock:
            return set(
                self._connections
                .get(
                    user_id,
                    {},
                )
                .keys()
            )


    async def is_connected(
        self,
        user_id: UUID,
        device_id: str,
    ) -> bool:
        async with self._lock:
            return (
                device_id
                in self._connections
                .get(
                    user_id,
                    {},
                )
            )


    async def send_to(
        self,
        user_id: UUID,
        device_id: str,
        payload: dict,
    ) -> bool:
        async with self._lock:
            websocket = (
                self._connections
                .get(
                    user_id,
                    {},
                )
                .get(
                    device_id,
                )
            )

        if websocket is None:
            return False

        try:
            await websocket.send_json(
                payload,
            )

            return True
        except Exception:
            await self.disconnect(
                user_id,
                device_id,
                websocket,
            )

            return False

    async def broadcast(
        self,
        user_id: UUID,
        payload: dict,
        *,
        exclude_device_id: str | None = None,
    ) -> None:
        async with self._lock:
            targets = list(
                self._connections
                .get(
                    user_id,
                    {},
                )
                .items()
            )

        for (
            device_id,
            websocket,
        ) in targets:
            if (
                exclude_device_id
                and device_id
                == exclude_device_id
            ):
                continue

            try:
                await websocket.send_json(
                    payload,
                )
            except Exception:
                await self.disconnect(
                    user_id,
                    device_id,
                    websocket,
                )


playback_realtime_hub = (
    PlaybackRealtimeHub()
)
