from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Annotated

import pytest
from fastapi import FastAPI, File, Request, UploadFile
from httpx import ASGITransport, AsyncClient
from starlette.requests import ClientDisconnect
from starlette.types import Message, Receive, Scope, Send

from backend.app.config import Settings
from backend.app.middleware.request_limits import RequestBodyLimitMiddleware


def make_app(limit: int = 8) -> FastAPI:
    app = FastAPI()
    app.add_middleware(RequestBodyLimitMiddleware, max_body_bytes=limit)

    @app.post("/body")
    async def body(request: Request) -> dict[str, int]:
        return {"size": len(await request.body())}

    @app.post("/upload")
    async def upload(file: Annotated[UploadFile, File()]) -> dict[str, int]:
        return {"size": len(await file.read())}

    @app.post("/private", status_code=401)
    async def private() -> dict[str, str]:
        return {"detail": "Not authenticated"}

    return app


@pytest.mark.parametrize("size,status", [(0, 200), (8, 200), (9, 413)])
async def test_declared_body_boundary(size: int, status: int) -> None:
    async with AsyncClient(transport=ASGITransport(app=make_app()), base_url="http://test") as c:
        response = await c.post("/body", content=b"x" * size)
    assert response.status_code == status
    if status == 200:
        assert response.json() == {"size": size}
    else:
        assert response.json() == {"detail": "Request body too large."}


@pytest.mark.parametrize(
    "chunks,status", [([b"1234", b"5678"], 200), ([b"1234", b"5678", b"9"], 413)]
)
async def test_chunked_actual_body_boundary(chunks: list[bytes], status: int) -> None:
    async def stream() -> AsyncIterator[bytes]:
        for chunk in chunks:
            yield chunk

    async with AsyncClient(transport=ASGITransport(app=make_app()), base_url="http://test") as c:
        response = await c.post("/body", content=stream())
    assert response.status_code == status


@pytest.mark.parametrize("header", ["-1", "abc", "1.5", "+1", "", "1, 1", "９"])
async def test_malformed_content_length_is_400(header: str) -> None:
    messages, reads, called = await invoke([(b"content-length", header.encode("utf-8"))], [])
    assert messages[0]["status"] == 400
    assert reads == 0
    assert not called


async def test_duplicate_length_is_rejected() -> None:
    messages, _, called = await invoke([(b"content-length", b"1"), (b"content-length", b"1")], [])
    assert messages[0]["status"] == 400
    assert not called


async def test_declared_oversize_never_reads_or_calls_app() -> None:
    messages, reads, called = await invoke([(b"content-length", b"9")], [])
    assert messages[0]["status"] == 413
    assert reads == 0
    assert not called


async def test_actual_size_does_not_trust_underreported_length_or_drain_remainder() -> None:
    messages, reads, called = await invoke(
        [(b"content-length", b"1")],
        [
            {"type": "http.request", "body": b"12345678", "more_body": True},
            {"type": "http.request", "body": b"9", "more_body": True},
            {"type": "http.request", "body": b"unread", "more_body": False},
        ],
    )
    assert called
    assert reads == 2
    assert messages[0]["status"] == 413
    assert len([m for m in messages if m["type"] == "http.response.start"]) == 1


async def test_chunked_multipart_returns_413_instead_of_parser_400() -> None:
    boundary = b'--boundary\r\nContent-Disposition: form-data; name="file"; filename="x"\r\n\r\n'

    async def stream() -> AsyncIterator[bytes]:
        yield boundary
        yield b"x" * 32
        yield b"\r\n--boundary--\r\n"

    async with AsyncClient(
        transport=ASGITransport(app=make_app(len(boundary) + 16)), base_url="http://test"
    ) as c:
        response = await c.post(
            "/upload",
            content=stream(),
            headers={"content-type": "multipart/form-data; boundary=boundary"},
        )
    assert response.status_code == 413
    assert response.json() == {"detail": "Request body too large."}


async def test_normal_auth_response_is_preserved_without_reading_body() -> None:
    async def stream() -> AsyncIterator[bytes]:
        raise AssertionError("auth endpoint must not consume request body")
        yield b""

    async with AsyncClient(transport=ASGITransport(app=make_app()), base_url="http://test") as c:
        response = await c.post("/private", content=stream())
    assert response.status_code == 401
    assert response.json() == {"detail": "Not authenticated"}


async def test_disconnect_is_not_converted_to_413() -> None:
    with pytest.raises(ClientDisconnect):
        await invoke([], [{"type": "http.disconnect"}])


async def test_non_http_scope_passes_through() -> None:
    seen = []

    async def app(scope: Scope, receive: Receive, send: Send) -> None:
        seen.append(scope["type"])

    async def receive() -> Message:
        raise AssertionError("must not receive")

    async def send(message: Message) -> None:
        raise AssertionError("must not send")

    await RequestBodyLimitMiddleware(app, max_body_bytes=8)({"type": "websocket"}, receive, send)
    assert seen == ["websocket"]


@pytest.mark.parametrize("limit", [0, -1])
def test_limit_must_be_positive(limit: int) -> None:
    with pytest.raises(ValueError, match="REQUEST_MAX_BODY_BYTES"):
        Settings.model_validate(
            {
                "database_url": "postgresql://test:test@localhost/test",
                "request_max_body_bytes": limit,
            }
        )


def test_default_is_64_mib_and_proxy_matches() -> None:
    from pathlib import Path

    settings = Settings.model_validate({"database_url": "postgresql://test:test@localhost/test"})
    assert settings.request_max_body_bytes == 64 * 1024 * 1024
    assert "client_max_body_size 64m;" in Path("frontend/nginx.conf").read_text()


async def invoke(headers: list[tuple[bytes, bytes]], chunks: list[Message]):
    messages: list[Message] = []
    reads = 0
    called = False

    async def app(scope: Scope, receive: Receive, send: Send) -> None:
        nonlocal called
        called = True
        await Request(scope, receive).body()
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"ok"})

    async def receive() -> Message:
        nonlocal reads
        message = chunks[reads]
        reads += 1
        return message

    async def send(message: Message) -> None:
        messages.append(message)

    scope: Scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/",
        "query_string": b"",
        "headers": headers,
    }
    await RequestBodyLimitMiddleware(app, max_body_bytes=8)(scope, receive, send)
    return messages, reads, called


@pytest.mark.parametrize("extra_byte,status", [(False, 200), (True, 413)])
async def test_real_64_mib_ceiling_streams_without_prebuffering(extra_byte: bool, status: int):
    limit = 64 * 1024 * 1024
    seen = 0
    chunk = b"x" * (1024 * 1024)
    messages = []

    async def app(scope: Scope, receive: Receive, send: Send) -> None:
        nonlocal seen
        async for part in Request(scope, receive).stream():
            seen += len(part)
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"ok"})

    count = 0

    async def receive() -> Message:
        nonlocal count
        # Each previous chunk must reach the app before we receive the next.
        assert seen == min(count, 64) * len(chunk)
        count += 1
        if count <= 64:
            return {"type": "http.request", "body": chunk, "more_body": True}
        return {"type": "http.request", "body": b"x" if extra_byte else b"", "more_body": False}

    async def send(message: Message) -> None:
        messages.append(message)

    await RequestBodyLimitMiddleware(app, max_body_bytes=limit)(
        {"type": "http", "headers": []}, receive, send
    )
    assert messages[0]["status"] == status
    assert seen == limit


async def test_late_overflow_finishes_started_response_without_second_headers():
    messages = []

    async def app(scope: Scope, receive: Receive, send: Send) -> None:
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"prefix", "more_body": True})
        await receive()
        raise AssertionError("oversized chunk must not reach the app")

    async def receive() -> Message:
        return {"type": "http.request", "body": b"123456789", "more_body": False}

    async def send(message: Message) -> None:
        messages.append(message)

    await RequestBodyLimitMiddleware(app, max_body_bytes=8)(
        {"type": "http", "headers": []}, receive, send
    )
    assert len([m for m in messages if m["type"] == "http.response.start"]) == 1
    assert messages[-1] == {"type": "http.response.body", "body": b"", "more_body": False}


async def test_unrelated_application_exception_propagates():
    async def app(scope: Scope, receive: Receive, send: Send) -> None:
        raise RuntimeError("application bug")

    async def receive() -> Message:
        raise AssertionError("must not receive")

    async def send(message: Message) -> None:
        raise AssertionError("must not send")

    with pytest.raises(RuntimeError, match="application bug"):
        await RequestBodyLimitMiddleware(app, max_body_bytes=8)(
            {"type": "http", "headers": []}, receive, send
        )


async def test_multipart_abort_closes_temporary_files(monkeypatch):
    import tempfile

    import starlette.formparsers

    files = []

    def tracked_file(*args, **kwargs):
        file = tempfile.SpooledTemporaryFile(*args, **kwargs)
        files.append(file)
        return file

    monkeypatch.setattr(starlette.formparsers, "SpooledTemporaryFile", tracked_file)
    header = b'--b\r\nContent-Disposition: form-data; name="file"; filename="x"\r\n\r\n'

    async def stream() -> AsyncIterator[bytes]:
        yield header
        yield b"x" * 32
        yield b"overflow"

    async with AsyncClient(
        transport=ASGITransport(app=make_app(len(header) + 32)), base_url="http://test"
    ) as client:
        response = await client.post(
            "/upload", content=stream(), headers={"content-type": "multipart/form-data; boundary=b"}
        )
    assert response.status_code == 413
    assert files
    assert all(file.closed for file in files)


@pytest.mark.asyncio
async def test_actual_application_limit_keeps_cors_and_authentication():
    import httpx

    from backend.app.config import get_settings
    from backend.app.main import app

    settings = get_settings()
    origin = settings.cors_origins[0]
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        oversized = await client.post(
            "/api/admin/tracks/upload",
            headers={
                "Content-Length": str(settings.request_max_body_bytes + 1),
                "Origin": origin,
            },
        )
        assert oversized.status_code == 413
        assert oversized.headers["access-control-allow-origin"] == origin
        assert oversized.headers["x-content-type-options"] == "nosniff"
        unauthorized = await client.post("/api/admin/tracks/upload")
        assert unauthorized.status_code == 401
