"""Small provider JSON responses with a measured, decoded allocation ceiling."""

import json
from collections.abc import Mapping

import httpx


async def get_response(client: httpx.AsyncClient, path: str, *,
                   params: Mapping[str, str | int | float | bool],
                   max_bytes: int = 2 * 1024 * 1024) -> httpx.Response:
    if max_bytes < 1:
        raise ValueError("max_bytes must be positive")
    # Do not invoke an unbounded automatic decompressor before checking size.
    # Providers are asked for identity; unexpected compressed replies fail soft
    # through the caller's existing provider-error/retry behavior.
    async with client.stream("GET", path, params=params,
                             headers={"Accept-Encoding": "identity"}) as response:
        # Error bodies are never used by these providers. Preserve their status
        # and headers without allocating an arbitrary error payload, so callers
        # can still handle 404, Retry-After and retryable 5xx responses.
        if not response.is_success:
            return httpx.Response(response.status_code, headers=response.headers,
                                  content=b"", request=response.request)
        if response.headers.get("content-encoding", "identity").strip().lower() not in {
            "", "identity",
        }:
            raise ValueError("Compressed provider responses are not supported")
        content = bytearray()
        async for chunk in response.aiter_bytes(chunk_size=64 * 1024):
            if len(content) + len(chunk) > max_bytes:
                raise ValueError("Provider response is too large")
            content.extend(chunk)
        return httpx.Response(response.status_code, headers=response.headers,
                              content=bytes(content), request=response.request)


async def get_json(client: httpx.AsyncClient, path: str, *,
                   params: Mapping[str, str | int | float | bool],
                   max_bytes: int = 2 * 1024 * 1024) -> dict[str, object]:
    response = await get_response(client, path, params=params, max_bytes=max_bytes)
    response.raise_for_status()
    payload = json.loads(response.content)
    if not isinstance(payload, dict):
        raise ValueError("Provider response must be a JSON object")
    return payload
