"""Bound HTTP request bodies without collecting or draining them in middleware."""

from starlette.formparsers import MultiPartException
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send


class _RequestBodyTooLarge(MultiPartException):
    # Starlette's multipart parser closes temporary upload files on this error.
    # FastAPI may translate it to a 400; the send guard restores the intended 413.
    pass


class RequestBodyLimitMiddleware:
    def __init__(self, app: ASGIApp, *, max_body_bytes: int) -> None:
        if max_body_bytes < 1:
            raise ValueError("max_body_bytes must be positive")
        self.app = app
        self.max_body_bytes = max_body_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        lengths = [
            value for name, value in scope.get("headers", []) if name.lower() == b"content-length"
        ]
        if lengths:
            value = lengths[0]
            if len(lengths) != 1 or not value or any(c < 48 or c > 57 for c in value):
                await JSONResponse({"detail": "Invalid Content-Length."}, status_code=400)(
                    scope, receive, send
                )
                return
            # Compare decimal strings: avoid int conversion limits on malicious headers.
            value = value.lstrip(b"0") or b"0"
            ceiling = str(self.max_body_bytes).encode("ascii")
            if len(value) > len(ceiling) or (len(value) == len(ceiling) and value > ceiling):
                await self._reject(scope, receive, send)
                return

        size = 0
        exceeded = False
        response_started = False
        response_finished = False
        rejection_sent = False

        async def guarded_receive() -> Message:
            nonlocal size, exceeded
            if exceeded:
                raise _RequestBodyTooLarge("Request body too large.")
            message = await receive()
            if message["type"] == "http.request":
                size += len(message.get("body", b""))
                if size > self.max_body_bytes:
                    exceeded = True
                    raise _RequestBodyTooLarge("Request body too large.")
            return message

        async def finish_rejection() -> None:
            nonlocal rejection_sent, response_finished
            if rejection_sent:
                return
            rejection_sent = True
            if not response_started:
                await self._reject(scope, receive, send)
            elif not response_finished:
                # HTTP status cannot be replaced once headers are sent. Close an
                # unusual response that reads the request after starting output.
                await send({"type": "http.response.body", "body": b"", "more_body": False})
            response_finished = True

        async def guarded_send(message: Message) -> None:
            nonlocal response_started, response_finished
            if exceeded:
                await finish_rejection()
                return
            await send(message)
            if message["type"] == "http.response.start":
                response_started = True
            elif message["type"] == "http.response.body" and not message.get("more_body", False):
                response_finished = True

        try:
            await self.app(scope, guarded_receive, guarded_send)
        except Exception:
            if not exceeded:
                raise
            # StreamingResponse may wrap a receive failure in an ExceptionGroup.
            # It is still the same rejected request; never emit a second status.
            await finish_rejection()
        if exceeded:
            await finish_rejection()

    @staticmethod
    async def _reject(scope: Scope, receive: Receive, send: Send) -> None:
        await JSONResponse({"detail": "Request body too large."}, status_code=413)(
            scope, receive, send
        )
