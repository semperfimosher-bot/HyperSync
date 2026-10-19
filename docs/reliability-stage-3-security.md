# Stage 3 — Security hardening and data protection

**Verification code commit:** `60001c5ab8ad66d22b9dda561b3135e7d2c0d24d` on `Semifinals`  
**Status:** source-level hardening and automated security gates passed; live-environment verification remains outside this branch-only stage.

## Confirmed gap fixed

The direct-to-Backblaze-B2 upload path did not enforce an explicit maximum audio-file size. Its signed URL could be issued for an arbitrarily large client-declared file, and the legacy backend-processing upload path did not enforce a separate audio-size ceiling.

- Added `AUDIO_MAX_UPLOAD_BYTES`, defaulting to 512 MiB, with configuration validation from 1 byte to 5,000,000,000 bytes (the single-request B2 upload ceiling).
- Oversized or non-positive sizes are rejected before a direct upload URL is issued and before duplicate-detection/database work.
- Direct-upload finalization validates the client-declared size and the actual B2 `ContentLength`; rejected direct objects are sent through the existing version-cleanup path.
- The backend-processing upload path checks the actual disk-spooled size before metadata parsing, compression, or storage. The existing 64 MiB HTTP request-body cap remains in force, independently of the direct-B2 cap.
- Added regression tests for invalid configuration, the exact boundary, oversized prepare requests, oversized declared sizes, a client that understates the actual B2 object size, cleanup after rejection, and the backend-processing path.

## Authentication, authorization, secrets, and data protection reviewed

- JWT algorithms are allowlisted; issuer and audience are required. Staging/production reject missing, short, and known-placeholder JWT secrets and reject weak optional admin/recovery secrets.
- Access tokens stay in JavaScript memory. Refresh tokens are random, stored server-side as hashes, and sent in an HttpOnly cookie with SameSite=Lax, path scoping, and Secure enabled in production or for HTTPS requests. Refresh is session-bound and has concurrency/rotation tests.
- Administrative routes use the admin dependency; user-owned endpoints use authenticated-user dependencies. Public profile routes gate private music-activity fields, and following-list access uses the documented privacy policy.
- Database-backed rate limiting uses the ASGI client address, not untrusted forwarded headers. Request diagnostics avoid raw query strings, headers, bodies, signed media URLs, and exception messages.
- Upload request bodies are bounded (64 MiB default); artwork reads are capped at 5 MiB; upload/stream concurrency and database admission are bounded.
- The B2 S3 client accepts only an HTTPS Backblaze S3 endpoint origin with no credentials/path/query/fragment. Web-push delivery validates HTTPS, disallows credentials and non-443 ports, and restricts hosts to configured push-service suffixes.
- The production proxy config sets HSTS, nosniff, frame denial, referrer and permissions policies, and a restrictive CSP. The current tracked tree contains `.env.example` rather than an actual `.env`, and no PEM/private-key files were present in the path inventory.

## Exact-head automated evidence

Both GitHub Actions workflows passed on `60001c5ab8ad66d22b9dda561b3135e7d2c0d24d`:

- [Offline PWA checks — run 39193052888](https://github.com/semperfimosher-bot/HyperSync/actions/runs/39193052888): **549 backend tests passed, 2 skipped**, 37 tooling tests passed, frontend regression/build/audit, browser-shell checks, Ruff, Pyright, backend dependency audit, Bandit, and production image/config checks passed.
- [Project verification — run 39193052845](https://github.com/semperfimosher-bot/HyperSync/actions/runs/39193052845): isolated PostgreSQL application verification, bounded fixture-memory check, disposable backup-restore/killed-worker recovery rehearsal, safety-contract tests, and Windows verification-runner tests passed.

## Security limitations and required follow-up

- This is source review plus automated scanning, not an external penetration test or a complete secret scan over every historical commit.
- Real Northflank environment variables, database routing, proxy trust, B2 bucket ACL/CORS, and provider credentials were not accessed or changed. No production or staging data was used.
- CI fixture recovery does not establish real deployment backup recoverability. Real B2 upload/CORS/interruption and the staged 100-user/100,000-track workload remain later-stage gates.
- No merge, deployment, destructive migration, Northflank change, or production load test was performed.
