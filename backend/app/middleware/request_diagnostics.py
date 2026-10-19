from __future__ import annotations

import logging
import time
from uuid import uuid4

from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = logging.getLogger(__name__)


class RequestDiagnosticsMiddleware:
    """Attach a server-generated request ID and log only slow/failed requests.

    Logs deliberately omit raw URLs, query strings, headers, bodies, and exception
    messages because they may contain credentials, signed media URLs, or user data.
    """

    def __init__(
        self,
        app: ASGIApp,
        *,
        slow_request_ms: float = 1000.0,
    ) -> None:
        self.app = app
        self.slow_request_ms = max(0.0, slow_request_ms)

    async def __call__(
        self,
        scope: Scope,
        receive: Receive,
        send: Send,
    ) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_id = uuid4().hex
        started_at = time.perf_counter()
        status_code: int | None = None
        response_started = False

        async def diagnostic_send(message: Message) -> None:
            nonlocal status_code, response_started
            if message["type"] == "http.response.start":
                status_code = int(message["status"])
                response_started = True
                # Never pass through a caller- or handler-supplied ID: it could
                # be duplicated or spoof the identifier used to correlate logs.
                headers = [
                    (name, value)
                    for name, value in message.get("headers", [])
                    if name.lower() != b"x-request-id"
                ]
                headers.append((b"x-request-id", request_id.encode("ascii")))
                message = {**message, "headers": headers}
            await send(message)

        try:
            await self.app(scope, receive, diagnostic_send)
        except Exception as exc:
            duration_ms = (time.perf_counter() - started_at) * 1000
            route = _route_template(scope)
            logger.error(
                "http_request_exception request_id=%s method=%s route=%s "
                "exception_type=%s duration_ms=%.1f",
                request_id,
                scope.get("method", "UNKNOWN"),
                route,
                type(exc).__name__,
                duration_ms,
            )
            if not response_started:
                # Starlette's outer ServerErrorMiddleware normally creates
                # unhandled 500 responses outside user middleware. Emit a
                # minimal response here so the same request ID reaches the
                # client and can be matched to this privacy-safe log entry.
                await diagnostic_send(
                    {
                        "type": "http.response.start",
                        "status": 500,
                        "headers": [
                            (b"content-type", b"application/json"),
                            (b"cache-control", b"no-store"),
                        ],
                    }
                )
                await diagnostic_send(
                    {
                        "type": "http.response.body",
                        "body": b'{"detail":"Internal Server Error"}',
                    }
                )
            else:
                # A response has already started; it cannot safely be replaced.
                raise
        finally:
            if response_started and status_code is not None:
                duration_ms = (time.perf_counter() - started_at) * 1000
                if status_code >= 500:
                    logger.warning(
                        "http_request_failed request_id=%s method=%s route=%s "
                        "status=%d duration_ms=%.1f",
                        request_id,
                        scope.get("method", "UNKNOWN"),
                        _route_template(scope),
                        status_code,
                        duration_ms,
                    )
                elif duration_ms >= self.slow_request_ms:
                    logger.info(
                        "http_request_slow request_id=%s method=%s route=%s "
                        "status=%d duration_ms=%.1f",
                        request_id,
                        scope.get("method", "UNKNOWN"),
                        _route_template(scope),
                        status_code,
                        duration_ms,
                    )


def _route_template(scope: Scope) -> str:
    route = scope.get("route")
    template = getattr(route, "path", None)
    return template if isinstance(template, str) else "unmatched"
