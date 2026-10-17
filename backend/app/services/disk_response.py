"""Bound response memory while preparing a legacy JSON array before headers."""

from typing import BinaryIO

from starlette.responses import StreamingResponse
from starlette.types import Receive, Scope, Send

from .thread_work import run_blocking


class DiskJSONResponse(StreamingResponse):
    def __init__(self, source: BinaryIO, *, headers: dict[str, str] | None = None):
        self.source = source
        size = source.tell()
        source.seek(0)
        response_headers = {
            k: v for k, v in (headers or {}).items() if k.lower() != "content-length"
        }
        response_headers["Content-Length"] = str(size)
        super().__init__(self._chunks(), media_type="application/json", headers=response_headers)

    async def _chunks(self):
        while chunk := await run_blocking(self.source.read, 64 * 1024):
            yield chunk

    async def close(self) -> None:
        await run_blocking(self.source.close)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        try:
            await super().__call__(scope, receive, send)
        finally:
            # BackgroundTask alone would miss cancellation and failed sends.
            await self.close()
