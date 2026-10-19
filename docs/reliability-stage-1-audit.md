# Stage 1 — Deep Codebase Audit (Semifinals)

**Audit baseline:** `Semifinals` at `2171d049abee924e678ee326eef43acd80b68acb`  
**Audit date:** 2026-10-18 (latest GitHub CI runs are timestamped 2026-10-19 UTC)  
**Scope:** static architecture/source review, dependency manifests, verification workflows, historical reliability findings, integration conflicts, and current automated evidence. This is not a production penetration test, live-provider test, or runtime capacity certification.

## 1. Architecture map

The repository contains 535 tracked tree entries: 66 Python files under `backend/`, 204 JavaScript/JSX source files under `frontend/src/`, 32 Alembic migration files, 155 test files matching the repository's test-path patterns, 27 documentation files, two GitHub Actions workflows, and four load/recovery scripts.

- **Frontend:** React 19 + Vite 8. The application shell and playback UI live under `frontend/src/`; catalog/search, library and playlist caching, audio playback/queue state, lyrics synchronization, uploads, and profile/admin pages are separated into components, hooks, APIs, and utilities.
- **PWA/offline:** `frontend/src/serviceWorker.js`, app-shell cache/manifest helpers, media storage, IndexedDB-backed library snapshots, offline download ownership/chunk/range handling, and service-worker registration. Local playback and queues are intentionally same-device; cross-device playback control/Jam functionality is out of scope.
- **Backend/API:** FastAPI app under `backend/app/`; routes cover authentication, administration, catalog/search, audio/media, artists, playlists, users, and messaging. Shared layers provide auth dependencies, request diagnostics/body limits, admission control, rate limits, configuration, and database access.
- **Persistence and media:** async SQLAlchemy/PostgreSQL, Alembic forward migrations, durable maintenance work, and Backblaze B2-compatible object storage/direct uploads with backend fallback. LRCLIB supplies lyrics; audio metadata/compression and push/email integrations are optional provider paths.
- **Operations:** backend/frontend Dockerfiles, Nginx/security-header configuration, local PowerShell launch/update scripts, migration coordination, verification runners, operational rehearsal scripts, and staging-only k6 scenarios.

## 2. Dependency and build map

- Python runtime dependencies are pinned in `requirements.backend.txt`; development verification dependencies are pinned in `requirements.dev.txt` (pytest/pytest-asyncio, Ruff, Pyright, Bandit, pip-audit, and Pillow).
- Frontend direct dependencies are declared in `frontend/package.json` and locked by `frontend/package-lock.json`. React, React DOM, Vite, the React plugin, IndexedDB test support, and `music-metadata` are declared.
- **Dependency-management gap:** the Playwright browser suite is currently installed as a pinned CI-only runtime (`playwright@1.56.1`) with `--no-save --package-lock=false`; it is not a declared frontend development dependency in the manifest/lockfile. The CI test is reproducible at its pinned version, but dependency ownership should be normalized in a controlled lockfile change.
- Production frontend and backend images are built separately. CI explicitly checks that the backend image retains FFmpeg/migrations and excludes scraper runtimes, and validates frontend Nginx configuration.

## 3. Existing feature and safety baseline

The reviewed code/docs describe persistent account sessions, guest/authenticated catalog browsing and search, local playback/queues/seek, lyrics, artwork, libraries and playlists, authorized audio/artwork upload and streaming, admin catalog tools, user/profile/messaging notifications, offline media downloads, and recovery/maintenance jobs.

Existing safety controls include JWT issuer/audience/type/expiry validation and database-backed session checks; Argon2 password hashing support; database-backed rate limits; bounded request bodies (64 MiB default); bounded database pool/admission defaults; statement/lock/idle-transaction timeouts; upload/stream concurrency limits; restricted provider URL handling; request diagnostics that omit raw query strings, headers, bodies, signed URLs and exception messages; and explicit staging-only guards in the k6 scripts.

The media ownership policy limits ingestion/processing/streaming to media the owner owns, licenses, or is explicitly authorized to use. Historical migrations/data are retained; this branch does not authorize destructive schema cleanup.

## 4. Source-confirmed risks and known limitations

### Critical release gates, not asserted code defects

1. **No isolated staging load/fault run:** neither the 40-user prerequisite nor the 100-user/100,000-track scenario has been run. k6 host checks reduce accidental risk but cannot prove that a custom hostname routes only to isolated staging.
2. **Real media/provider behavior remains unverified:** B2 bucket CORS still requires an authorized operator to apply/confirm the previewed policy; actual B2 interruption, upload retry/duplicate safety, audio range, artwork fallback, and cleanup/reconciliation require isolated-provider tests.
3. **Browser/device acceptance is incomplete:** the browser-shell CI tests exercise service-worker control, offline reload/network recovery, upstream 503 fallback, and failed-bundle preparation. They do not verify authenticated music journeys, actual audio/lyrics timing, mobile Safari, quota eviction, or playback restore on a physical device.
4. **Integration overlaps remain:** `docs/reliability-stages-1-8-integration.md` lists independently edited files needing three-way reconciliation, including app/player/artwork/library/media-store/offline-download/service-worker files, Vite/lockfiles, backend catalog/playlists/main, tests, and workflow files. Preserve the Semifinals version until each overlap is reviewed against both source branches and targeted tests; do not wholesale-merge either draft PR.
5. **Capacity claims are not supported by CI alone:** API/database concurrency defaults are intentionally conservative (API admission 3; DB pool 3 + overflow 2 per process), which bounds resource use but can queue/reject traffic. Measure against the actual staging resource limits before changing them.

### Performance/maintainability findings

- The staged-readiness record reports a 535.88 kB main frontend chunk (147.28 kB gzip) and an existing build warning; profile instances are capped at eight, but the admin catalog can still retain all fetched pages in memory.
- Catalog paging and page-level IndexedDB caches exist, but full 100,000-track cold-load/search behavior, artist/album grouping over partial pages, storage pressure, large-playlist restoration, and ranking CPU have not been demonstrated with representative staging data.
- Metadata caches have cardinality bounds, but production hit rate, eviction behavior, and memory contribution are not measured.
- Request correlation/slow-failure diagnostics are in place; any polling reduction, new shared cache, SSE, or WebSocket transport change must be justified by request/event measurements rather than assumption.

### Security and data protection limitations

- CI includes backend dependency audit, Bandit, lint/type checks, frontend production dependency audit, and targeted auth/privacy tests. These do not equal a route-by-route authorization audit, penetration test, secret scanning review of all history, or deployed-environment configuration review.
- The sample environment file documents minimum secret requirements, trusted proxy IP restrictions, CORS origins, direct migration URL requirements, and server-only admin secrets. Real staging credentials, bucket policy, proxy trust, database routing, and storage isolation still require environment-owner verification.
- Do not log tokens/cookies, raw query strings, request bodies, signed media URLs, or provider secrets. Do not test against production or mutate Northflank under this plan.

## 5. Test and CI coverage inventory

On current head `2171d049abee924e678ee326eef43acd80b68acb`, both required GitHub Actions workflows completed successfully:

- [Offline PWA checks — run 39190246940](https://github.com/semperfimosher-bot/HyperSync/actions/runs/39190246940): frontend regression suite, production dependency audit/build, staging k6 syntax checks, Playwright browser-shell scenarios, backend regression tests, Python compile, Ruff, Pyright, dependency/security scans, and backend/frontend image checks passed.
- [Project verification — run 39190247030](https://github.com/semperfimosher-bot/HyperSync/actions/runs/39190247030): isolated PostgreSQL application verification, bounded fixture-memory check, disposable backup restore/killed-worker recovery rehearsal, safety-contract tests, and Windows verification-runner tests passed.

These runs establish automated evidence for this exact SHA. They do not establish production capacity or external-provider/device acceptance. A later code commit must be checked again.

## 6. Stage 1 outcome

**Static architecture/dependency/test map: completed for this integration checkpoint.** Existing reliability documents were reconciled with the current Semifinals tree and exact-head CI. The highest-priority unresolved items are explicitly listed above and will be carried into the appropriate later stage gates; no source behavior was changed as part of this audit.

**No merge, deployment, Northflank change, production-data access, production load test, or destructive migration was performed or authorized.**
