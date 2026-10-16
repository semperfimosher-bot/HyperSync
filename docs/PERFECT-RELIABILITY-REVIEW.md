# PERFECT reliability review — 2026-10-16

## Assessment

**A credible development beta, suitable for controlled staging; not yet verified for production.** The local-player baseline is substantially simpler, with useful unit coverage and thoughtful authentication, database admission, and offline-storage safeguards. The largest remaining reliability risks are the upload pipeline, missing database-backed verification in this environment, and operational behavior under real load or replica restarts. A source review cannot establish an uptime percentage or a safe concurrent-user count.

Reviewed from PERFECT commit `8b057f09c8ee88c7f091604bc1d45c3bc0a4cf6e`, plus this cleanup. Scope: app shell, local playback/queues/lyrics, authentication/session boundaries, catalog/search, uploads/B2, playlists/library, messaging, offline/PWA storage, schema history, verification tooling, and container/proxy configuration. This is an architecture-wide source review with automated checks, not a production load test or exhaustive security certification.

## Cleanup delivered

- Removed device selection/control props, account playback synchronization, polling, reconnect timers, remote command dispatch, live WebSocket handling, and PostgreSQL playback event listener/bridge.
- Removed backend live playback-state/device/command endpoints and their feature-specific schemas/services.
- Removed the unused Jam track-ended callback and stale Jam tests/imports. Updated PostgreSQL verification to exercise concurrent same-account playlist creation instead of the deleted Jam service.
- Kept local audio, seek, volume, pause, next/previous, natural queue progression, local persistence, lyrics, offline downloads, authentication, and library APIs.
- Added regression coverage for local player behavior, unavailable live endpoints/socket, and independent same-account sessions sharing playlists. The last scenario requires PostgreSQL and has not been executed here.
- Fixed pre-existing Ruff/Pyright failures in `scripts/verify_project.py` (unused import, formatting, and smoke-report metadata annotation).
- Historical migrations, database tables/data, and legacy playback ORM mappings remain intact. The mappings are retained for database compatibility/admin cleanup, with no live-control runtime services. No destructive schema migration was added.
- No production settings, secrets, routing, deployment, or main-branch merge was performed. Generic reverse-proxy/CSP WebSocket compatibility remains; PERFECT opens no playback socket.

## Verification evidence

| Check | Result | Limits |
|---|---|---|
| Original frontend baseline | 261 tests passed; production build passed | Includes tests for features removed by this change |
| Updated frontend suite | **241 tests passed** | Node tests; not a real mobile browser journey |
| Local player regression | Plays queue, advances on ended, previous/next, seek/volume/pause, no remote API/controller | Uses an Audio stand-in; does not decode or output real sound |
| Backend collection | **299 tests collected**, no missing Jam/playback imports | `--noconftest --collect-only`; does not initialize a database |
| Backend checks not requiring live PostgreSQL | **99 passed, 2 explicitly deselected** | `--noconftest` with a dummy loopback database URL; omits the shared DB fixture; excluded metadata-write and same-account integration tests |
| Verification runner/report/process suite | **19 passed** | Normal pytest fixture path; these files are explicitly database-free |
| Ruff | **Passed** for `backend scripts tests` | This is the configured runner scope; historical migrations have existing import-order warnings if separately included |
| Pyright | **0 errors** | Explicit installed Python interpreter supplied; local `.venv` path notice is environmental |
| Bandit | **No medium/high findings** | Static scan with `-ll`; not proof of complete security |
| Python dependency audit | **No known vulnerabilities found** | `pip-audit -r requirements.backend.txt` with dependencies resolved on this date |
| Frontend production dependency audit | **1 moderate dependency finding, 0 high/critical** | `music-metadata` has two advisories; see below |
| Alembic graph | **Single head: `6a4d9e8b1c2f`** | No migration was applied; preservation/concurrency execution still required |
| Full verification runner | **Blocked, exit code 2** | Disposable local PostgreSQL is unavailable |
| Docker image, Windows runner, real-browser/device journeys | **Not verified here** | No Docker engine; browser binary download failed; Windows needs Windows CI |
| B2/SMTP/LRCLIB/metadata providers/push delivery | **No live certification** | Unit tests use controlled responses; no credentials or production traffic used |

An initial broader backend subset produced 98 passes and six environment-related failures: `test_metadata_enrichment_survives_playlist_refresh_failure`, all four tests in `test_verification_environment.py`, and `test_fixture_audio_and_accounts_are_distinct_and_local`. They require the missing local PostgreSQL service. They are not hidden or counted as passing. A subsequent explicitly limited subset produced the 99-pass result above.

The standard full pytest command refuses to start without `HYPERSYNC_TEST_POSTGRES_URL`; the full verification runner also correctly records BLOCKED rather than success. Host package installation/user-switch restrictions prevented starting PostgreSQL. Browser installation returned truncated archives. Neither obstacle justifies using a live database or claiming the checks passed.

The main JS bundle changed from 560.31 kB / 154.15 kB gzip to approximately 533.36 kB / 146.38 kB gzip. It still exceeds Vite's 500 kB warning threshold. This is a measured bundle-size reduction, not a measured latency, memory, or uptime improvement.

## Remaining findings, in priority order

### P1 — Upload processing can outlive its database transaction timeout

**Source-confirmed mechanism; impact under load has not been measured.** In `backend/app/api/routes/admin.py::upload_track`, the request reads the whole file into bytes, extracts metadata, takes the PostgreSQL transaction advisory lock through `lock_track_identity`, and then compresses and uploads to B2 before committing. Defaults in `backend/app/config.py` permit compression to run for 180 seconds while PostgreSQL's idle-in-transaction timeout is 30 seconds. A slow encode/network step can therefore leave the database transaction idle long enough to be killed, followed by a failed catalog write. The connection/advisory lock also stays occupied during external work. Whole-file copies and compression add memory pressure.

The request's exception path rolls back the database but does not compensate for already-uploaded audio/artwork objects, unlike parts of the direct-upload/ingestion flows. A failure after B2 upload can leave orphaned storage objects.

**Next fix:** move CPU/network work outside a short final database transaction; enforce upload size/concurrency limits; use a durable job or explicit upload-state record and compensating object cleanup. Verify slow encoding, B2 timeouts, duplicate uploads, and database failure after upload. Merely increasing pool/timeouts will not solve the ownership problem.

### P1 — Production readiness remains unproven by integration tests

The 299-test suite now collects, but actual PostgreSQL-backed account/session, shared library, permissions, reset, migration-preservation, and concurrency behavior still needs to pass. The new same-account regression is written but unexecuted here. Unit tests cannot certify that two real browsers retain independent sessions, that B2 uploads survive interruptions, or that offline audio resumes correctly on iOS/Android.

**Next gate:** run `python scripts/verify_project.py --suite full` with an explicitly disposable local PostgreSQL service, then perform login/logout on two devices, upload/artwork/lyrics, playlist actions, and playback/seek/queue/offline journeys in staging. Run the configured Windows check and backend image build. Do not merge/deploy on the strength of this report alone.

### P2 — Synchronous storage setup can block the API event loop

`backend/app/services/b2.py::get_b2_client` authorizes synchronously on a cold cache. `get_b2_bucket` can perform a synchronous bucket lookup on a cache miss. Async routes in audio/catalog/users/admin invoke it directly before their later `asyncio.to_thread` calls. The installed B2 SDK checks its bucket cache first, so this is specifically cold/cache-miss exposure, not proof that every request performs the network lookup.

**Next fix:** initialize/offload storage setup with explicit deadlines; test a slow cold B2 authorization while liveness and unrelated requests run concurrently.

### P2 — Catalog loading grows with the entire published catalog

`backend/app/api/routes/catalog.py::list_tracks` loads every matching published Track with `.all()`, serializes the complete response, and disables HTTP caching. `frontend/src/catalogStore.js::loadCatalog` retains the full list and requests it with `no-store`. The in-flight request deduplication helps repeated concurrent calls, but response size, serialization, frontend memory, and database egress still grow with catalog size.

**Next fix:** use pagination/cursors and selective fields, separate small home/library summaries from full catalog management, and measure representative 1k/10k/100k catalogs. Do not guess a safe catalog/user ceiling from the current tests.

### P2 — Scaling/restarts need an explicit operational plan

`Dockerfile.backend` runs Alembic on each application start. Multiple replicas starting together can attempt the migration step concurrently; retrying does not provide a deployment-wide migration lease. `backend/app/main.py` also starts maintenance tasks per process. SQLAlchemy pools and request admission are process-local, so replicas multiply their resource footprint.

`.env.example` still specifies pool size 5 + overflow 10, while current code defaults are 3 + 2. Copying the example overrides the conservative defaults, and each additional process can open up to 15 connections. The previous reliability audit discusses small-container overload, but this review has no current production telemetry to attribute it to a specific source.

**Next fix:** run migrations once per release, validate replica/worker/pool budgets, coordinate maintenance as needed, and load/soak-test the actual container limits. Collect memory, CPU, pool waits, admission 503s, p95 latency, and external-service error rates. Verify backup restoration and rollback procedures separately; they were not demonstrated here.

### P2 — Audio metadata parser has known moderate advisories

`frontend/package.json` pins `music-metadata` 11.15.0. The audit reports [GHSA-f94x-6692-553q](https://github.com/advisories/GHSA-f94x-6692-553q) and [GHSA-5gfj-9q3v-qfp3](https://github.com/advisories/GHSA-5gfj-9q3v-qfp3), involving crafted MP4/EBML parsing and resource exhaustion. This parser is used for browser-side upload metadata, so the practical exposure is the upload interface parsing a supplied file, not evidence of a remotely exploitable guest playback outage. The audit offers 11.16.1 as a compatible fix.

**Next fix:** update the pinned dependency and lockfile, run metadata extraction regressions, and test malformed files. Consider parsing in a cancellable worker with file limits. This cleanup intentionally leaves dependency versions unchanged and records the issue rather than silently calling the audit clean.

### P3 — Maintainability and documentation remain uneven

The cleanup removes substantial orchestration from `App.jsx`, but the app shell, local player, offline downloader, search page/API, and admin routes remain large. Several tests assert source strings rather than user-visible behavior. The README combines implemented behavior and future architecture, including old worker/WebSocket goals. Large modules and roadmap drift are review/maintenance costs; they do not independently prove a runtime defect.

**Next fix:** extract modules only around demonstrated ownership boundaries; add browser journeys for cross-layer flows; keep the baseline behavior contract distinct from future plans. Avoid a broad rewrite before the integration gates pass.

## What would change the verdict

1. Full PostgreSQL, migration-preservation/concurrency, Docker, and Windows checks pass on this exact change.
2. Upload transaction/memory/cleanup risks are fixed and fault-tested; moderate parser advisories are patched.
3. Two-device independent login/library and real browser/mobile offline playback journeys pass in staging.
4. A soak/load test at intended deployment limits establishes a measured capacity budget and recovery behavior.
5. Monitoring, a tested database/object-storage recovery plan, and a controlled release/rollback procedure are demonstrated.

After those gates, a small production beta would be a reasonable next step. Larger multi-replica use still needs capacity evidence. The present verdict is deliberately conditional: the code is simpler and checks are healthier, but production reliability has not been established.
