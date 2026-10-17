"""Keep expensive uploads, exports and slow media consumers within fixed budgets."""

import asyncio
from urllib.parse import parse_qs

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send


class MemoryAdmissionMiddleware:
    def __init__(
        self, app: ASGIApp, *, upload_limit: int = 1, stream_limit: int = 4, catalog_limit: int = 1
    ) -> None:
        if min(upload_limit, stream_limit, catalog_limit) < 1:
            raise ValueError("Memory admission limits must be positive")
        self.app = app
        self._uploads = asyncio.Semaphore(upload_limit)
        self._streams = asyncio.Semaphore(stream_limit)
        self._catalog = asyncio.Semaphore(catalog_limit)

    def _permit(self, scope: Scope) -> asyncio.Semaphore | None:
        path = scope.get("path", "")
        method = scope.get("method", "")
        if method == "POST" and path.rstrip("/") in {
            "/api/admin/tracks/upload",
            "/api/admin/tracks/upload/finalize",
            "/api/admin/tracks/backfill-metadata",
        }:
            return self._uploads
        if method in {"GET", "HEAD"}:
            if path.startswith("/api/audio/") or (
                path.startswith("/api/catalog/tracks/") and path.endswith("/artwork")
            ):
                return self._streams
            if path.rstrip("/") == "/api/catalog/tracks":
                query = parse_qs(scope.get("query_string", b""), keep_blank_values=True)
                if b"page_size" not in query and b"cursor" not in query:
                    return self._catalog
        return None

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        permit = self._permit(scope) if scope["type"] == "http" else None
        if permit is None:
            await self.app(scope, receive, send)
            return
        # Fail before reading/parsing another multipart body. No waiting queue of
        # spooled uploads or media downloads; clients can retry with backoff.
        if permit.locked():
            await JSONResponse(
                {"detail": "Media processing is busy. Please retry shortly."},
                status_code=503,
                headers={"Retry-After": "1"},
            )(scope, receive, send)
            return
        await permit.acquire()
        try:
            # Unlike DB admission, hold until streaming/cleanup has finished.
            await self.app(scope, receive, send)
        finally:
            permit.release()
