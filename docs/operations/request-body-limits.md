# API request body ceiling

The API accepts at most 64 MiB (67,108,864 bytes) in one HTTP request body by default. `REQUEST_MAX_BODY_BYTES` configures the backend ceiling and must be positive. The frontend Nginx `/api/` proxy explicitly sets `client_max_body_size 64m`. Keep these values aligned when changing deployment configuration. A proxy rejection can have Nginx's HTML error body; a backend rejection has status 413 and `{"detail":"Request body too large."}`.

The ceiling includes multipart boundaries and other form fields, rather than only the uploaded file. Avatar content retains its separate 5 MiB limit. Larger trusted audio uploads should use the existing direct storage upload workflow, which bypasses this API body path.

The ASGI guard rejects a declared oversized Content-Length before entering the application or reading body bytes. Malformed or repeated Content-Length headers receive 400. Actual received chunks are counted independently, including chunked requests and bodies with an underreported length. A chunk that crosses the ceiling is not passed to the application. The guard neither collects the body nor drains the remaining input; its memory overhead does not grow with total body size. The server has already allocated each received chunk, so server/proxy transport buffering remains part of the process memory budget. Multipart parser aborts close temporary files. Client disconnects and unrelated application failures retain their usual behavior.

Endpoints that reject authentication without reading a body retain their normal response for undeclared lengths; the guard does not consume arbitrary input just to replace an early authentication error. A custom endpoint must finish validating its request before sending response headers if it needs a reliable 413 status. HTTP cannot change an already-sent status: if an endpoint starts a streaming response and subsequently reads oversized request input, the middleware ends that response without a second response header block. Standard body/form-consuming endpoints validate before starting their response.

## Integration

Register `RequestBodyLimitMiddleware` from `backend.app.middleware.request_limits` with `max_body_bytes=settings.request_max_body_bytes` on the FastAPI app. Keep CORS outside this guard if browser clients need CORS headers on rejected requests. This middleware counts HTTP input only; WebSocket and lifespan scopes pass through unchanged.

## Focused verification

`python -m pytest --noconftest tests/test_request_limits.py -q` runs isolated ASGI/HTTPX tests without contacting PostgreSQL or storage. Coverage includes the actual 64 MiB streaming boundary, malformed/duplicate/underreported lengths, chunked multipart cleanup, disconnection, early authentication responses, and single-response handling after output has started. These tests establish application behavior, not deployment throughput or proxy capacity.
