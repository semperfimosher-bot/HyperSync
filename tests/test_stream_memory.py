import asyncio
import threading
from types import SimpleNamespace

import pytest

from backend.app.api.routes.audio import stream_b2_file


@pytest.mark.asyncio
async def test_disconnected_consumer_settles_blocked_producer_and_closes_source():
    stopped = threading.Event()
    closed = threading.Event()

    class Download:
        response = SimpleNamespace(close=closed.set)

        def save(self, output, allow_seeking=False):
            try:
                while True:
                    output.write(b"x" * 65536)
            finally:
                stopped.set()

    stream = stream_b2_file(Download())
    assert len(await anext(stream)) <= 1024 * 1024
    await asyncio.wait_for(stream.aclose(), timeout=3)
    assert stopped.is_set()
    assert closed.is_set()


@pytest.mark.asyncio
async def test_storage_interruption_closes_response_and_propagates_failure():
    closed = threading.Event()

    class Download:
        response = SimpleNamespace(close=closed.set)

        def save(self, output, allow_seeking=False):
            output.write(b"some audio")
            raise OSError("Fixture storage interruption")

    stream = stream_b2_file(Download())
    with pytest.raises(OSError, match="Fixture storage"):
        async for _ in stream:
            pass
    assert closed.is_set()


@pytest.mark.asyncio
async def test_cancelled_download_setup_settles_and_closes_created_response():
    from backend.app.services.thread_work import run_blocking_resource
    started, release, closed = threading.Event(), threading.Event(), threading.Event()
    def create():
        started.set()
        assert release.wait(3)
        return SimpleNamespace(close=closed.set)
    task = asyncio.create_task(run_blocking_resource(create, lambda value: value.close()))
    assert await asyncio.to_thread(started.wait, 3)
    task.cancel()
    await asyncio.sleep(0)
    assert not task.done()
    release.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert closed.is_set()


@pytest.mark.asyncio
async def test_response_cancelled_before_body_starts_closes_download():
    from backend.app.api.routes.audio import B2StreamingResponse
    closed = threading.Event()
    downloaded = SimpleNamespace(response=SimpleNamespace(close=closed.set))
    response = B2StreamingResponse(downloaded)
    async def send(message):
        raise asyncio.CancelledError()
    async def receive():
        return {"type": "http.disconnect"}
    with pytest.raises(asyncio.CancelledError):
        await response({"type": "http", "asgi": {"spec_version": "2.4"}}, receive, send)
    assert closed.is_set()
