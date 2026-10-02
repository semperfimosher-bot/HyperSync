from __future__ import annotations

import asyncio
import json

from sqlalchemy.exc import TimeoutError as SQLAlchemyTimeoutError
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

OVERLOAD_DETAIL = "The service is busy. Please retry shortly."
RETRY_AFTER_SECONDS = "1"
HEALTH_PATHS = {
    # Liveness must remain available during DB outages. Readiness probes
    # execute SELECT 1, so they must pass through admission control rather
    # than allowing an unbounded probe storm to consume DB connections.
    "/health/live",
}


class DatabaseAdmissionMiddleware:
    """Bound request work, without counting long-lived response streams."""

    def __init__(
        self,
        app: ASGIApp,
        *,
        max_concurrent_requests: int,
        admission_timeout_seconds: float,
    ) -> None:
        self.app = app
        self.max_concurrent_requests = max(
            1,
            max_concurrent_requests,
        )
        self.admission_timeout_seconds = max(
            0.0,
            admission_timeout_seconds,
        )
        self._semaphore = asyncio.Semaphore(
            self.max_concurrent_requests,
        )

    async def __call__(
        self,
        scope: Scope,
        receive: Receive,
        send: Send,
    ) -> None:
        scope_type = scope["type"]
        if scope_type not in {"http", "websocket"} or (
            scope_type == "http" and scope.get("path") in HEALTH_PATHS
        ):
            await self.app(
                scope,
                receive,
                send,
            )
            return

        try:
            await asyncio.wait_for(
                self._semaphore.acquire(),
                timeout=self.admission_timeout_seconds,
            )
        except TimeoutError:
            if scope_type == "websocket":
                await send(
                    {
                        "type": "websocket.close",
                        "code": 1013,
                        "reason": OVERLOAD_DETAIL,
                    }
                )
            else:
                body = json.dumps(
                    {
                        "detail": OVERLOAD_DETAIL,
                    }
                ).encode("utf-8")
                headers = [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode("ascii")),
                    (b"retry-after", RETRY_AFTER_SECONDS.encode("ascii")),
                ]
                await send(
                    {
                        "type": "http.response.start",
                        "status": 503,
                        "headers": headers,
                    }
                )
                await send(
                    {
                        "type": "http.response.body",
                        "body": body,
                    }
                )
            return

        release_after_response_start = scope_type == "http"
        release_after_websocket_accept = scope_type == "websocket"
        permit_released = False

        async def guarded_send(message: Message) -> None:
            nonlocal permit_released
            should_release = (
                (
                    release_after_response_start
                    and message["type"] == "http.response.start"
                )
                or (
                    release_after_websocket_accept
                    and message["type"] == "websocket.accept"
                )
            )
            if not permit_released and should_release:
                # The endpoint has finished its request-time work. Do not let
                # a StreamingResponse (audio/artwork/avatar) hold an API slot
                # for the entire time the client downloads the response.
                self._semaphore.release()
                permit_released = True
            await send(message)

        try:
            await self.app(
                scope,
                receive,
                guarded_send,
            )
        finally:
            if not permit_released:
                self._semaphore.release()


async def database_pool_timeout_handler(
    _request: Request,
    _exc: SQLAlchemyTimeoutError,
) -> JSONResponse:
    return JSONResponse(
        status_code=503,
        content={
            "detail": OVERLOAD_DETAIL,
        },
        headers={
            "Retry-After": RETRY_AFTER_SECONDS,
        },
    )
