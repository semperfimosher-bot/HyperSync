import asyncio

import pytest

from backend.app.middleware.memory_admission import MemoryAdmissionMiddleware


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "path,method",
    [
        ("/api/admin/tracks/upload", "POST"),
        ("/api/admin/tracks/upload/finalize", "POST"),
        ("/api/admin/tracks/backfill-metadata", "POST"),
        ("/api/audio/song", "GET"),
        ("/api/catalog/tracks/song/artwork", "GET"),
        ("/api/catalog/tracks", "GET"),
    ],
)
async def test_memory_permit_lasts_through_body_and_rejects_before_read(path, method):
    started, finish = asyncio.Event(), asyncio.Event()
    reads = 0

    async def app(scope, receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": []})
        started.set()
        await finish.wait()
        await send({"type": "http.response.body", "body": b"done"})

    async def receive():
        nonlocal reads
        reads += 1
        return {"type": "http.request", "body": b"not consumed"}

    first_messages, rejected = [], []

    async def send_first(message):
        first_messages.append(message)

    async def send_rejected(message):
        rejected.append(message)

    middleware = MemoryAdmissionMiddleware(app, upload_limit=1, stream_limit=1, catalog_limit=1)
    scope = {"type": "http", "path": path, "method": method, "query_string": b""}
    task = asyncio.create_task(middleware(scope, receive, send_first))
    await started.wait()
    await middleware(scope, receive, send_rejected)
    assert rejected[0]["status"] == 503
    assert (b"retry-after", b"1") in rejected[0]["headers"]
    assert reads == 0
    finish.set()
    await task
    rejected.clear()
    await middleware(scope, receive, send_rejected)
    assert rejected[0]["status"] == 200


@pytest.mark.asyncio
async def test_cancel_releases_permit_and_paged_catalog_does_not_use_export_slot():
    entered = asyncio.Event()

    async def app(scope, receive, send):
        entered.set()
        await asyncio.Event().wait()

    async def receive():
        raise AssertionError("No body read expected")

    async def send(message):
        raise AssertionError("No rejection expected")

    middleware = MemoryAdmissionMiddleware(app, upload_limit=1, stream_limit=1, catalog_limit=1)
    scope = {"type": "http", "path": "/api/catalog/tracks", "method": "GET", "query_string": b""}
    task = asyncio.create_task(middleware(scope, receive, send))
    await entered.wait()
    assert middleware._catalog.locked()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert not middleware._catalog.locked()
    for query in [b"page_size=250", b"cursor=abc", b"page%5fsize=250"]:
        assert middleware._permit({**scope, "query_string": query}) is None


@pytest.mark.parametrize("limit", [0, -1])
def test_invalid_limit_rejected(limit):
    async def app(scope, receive, send):
        pass
    with pytest.raises(ValueError):
        MemoryAdmissionMiddleware(app, upload_limit=limit)
