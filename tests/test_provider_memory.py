import gzip
import json

import httpx
import pytest

from backend.app.services.bounded_http import get_json


@pytest.mark.asyncio
@pytest.mark.parametrize("headers", [{}, {"content-length": "1"}])
async def test_provider_json_actual_decompressed_body_has_a_ceiling(headers):
    payload = b'{"data":"' + b"x" * 100_000 + b'"}'
    async with httpx.AsyncClient(transport=httpx.MockTransport(
        lambda request: httpx.Response(200, content=payload, headers=headers)
    )) as client:
        with pytest.raises(ValueError, match="response is too large"):
            await get_json(client, "https://provider.test", params={}, max_bytes=1024)


@pytest.mark.asyncio
async def test_compressed_provider_reply_rejected_before_decompression():
    async with httpx.AsyncClient(transport=httpx.MockTransport(
        lambda request: httpx.Response(200, stream=httpx.ByteStream(gzip.compress(b"x" * 100_000)),
                                      headers={"content-encoding": "gzip"})
    )) as client:
        with pytest.raises(ValueError, match="Compressed provider"):
            await get_json(client, "https://provider.test", params={}, max_bytes=1024)


@pytest.mark.asyncio
async def test_provider_json_success_and_invalid_types():
    for value in [{"ok": True}, []]:
        async with httpx.AsyncClient(transport=httpx.MockTransport(
            lambda request, value=value: httpx.Response(200, content=json.dumps(value).encode())
        )) as client:
            if isinstance(value, dict):
                assert await get_json(client, "https://provider.test", params={}) == value
            else:
                with pytest.raises(ValueError, match="JSON object"):
                    await get_json(client, "https://provider.test", params={})


@pytest.mark.asyncio
async def test_bounded_response_preserves_error_status_headers_and_search_arrays():
    from backend.app.services.bounded_http import get_response

    async with httpx.AsyncClient(transport=httpx.MockTransport(
        lambda request: httpx.Response(404, headers={"Retry-After": "2"}, content=b"x" * 100_000)
    )) as client:
        response = await get_response(client, "https://provider.test", params={}, max_bytes=32)
        assert response.status_code == 404
        assert response.headers["Retry-After"] == "2"
        assert response.request.url.host == "provider.test"
    async with httpx.AsyncClient(transport=httpx.MockTransport(
        lambda request: httpx.Response(200, json=[{"id": 1}])
    )) as client:
        response = await get_response(client, "https://provider.test", params={})
        assert response.json() == [{"id": 1}]


@pytest.mark.asyncio
async def test_lrclib_retries_provider_status_and_preserves_404(monkeypatch):
    from types import SimpleNamespace

    from backend.app.services import lrclib

    monkeypatch.setattr(lrclib, "get_settings", lambda: SimpleNamespace(
        lrclib_retry_attempts=3, lrclib_retry_base_delay_seconds=0,
        lrclib_retry_max_delay_seconds=1,
    ))
    replies = iter([httpx.Response(429, headers={"Retry-After": "0"}),
                    httpx.Response(503), httpx.Response(404)])
    transport = httpx.MockTransport(lambda request: next(replies))
    async with httpx.AsyncClient(transport=transport) as client:
        result = await lrclib._request_with_retry(client, path="https://provider.test", params={})
        assert result.status_code == 404


@pytest.mark.asyncio
async def test_lrclib_provider_body_has_actual_size_cap():
    from backend.app.services import lrclib

    async with httpx.AsyncClient(transport=httpx.MockTransport(
        lambda request: httpx.Response(200, content=b"x" * (2 * 1024 * 1024 + 1))
    )) as client:
        with pytest.raises(ValueError, match="response is too large"):
            await lrclib._request_with_retry(client, path="https://provider.test", params={})
