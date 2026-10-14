# HyperSync Performance and Reliability Audit

Target branch for this feature-removal work: `Bot-Deletion`. Do not merge into or modify `main`.

## Scope and method

Audit backend memory/CPU, request admission and retry behavior, database access, background jobs, HTTP client lifetimes, frontend polling and rendering, service-worker/offline storage, security boundaries, and test/load-test coverage. Separate source-confirmed issues from hypotheses that require production logs or profiling.

## Initial findings (source review; not all are confirmed runtime causes)

### P1 — Runtime stability and overload
- Northflank screenshots supplied for the Shane deployment show 254–256 MB / 256 MB memory, CPU reaching 100% of 0.1 vCPU, and widespread HTTP 503 responses. These are observed runtime symptoms, not source-code proof of a specific cause.
- Backend overload/admission middleware can return 503 when request admission is saturated.
- Frontend API requests now retry safe transient failures at most once (down from three retries) to reduce amplification during sustained overload. Backoff behavior still needs load validation.
- Next evidence: correlate backend logs and timestamps with 503s, process restarts/OOM events, admission wait/rejection metrics, and request latency.

### P1 — Process-local caches and retained state
- `backend/app/services/music_metadata.py` now bounds each of its four process-local metadata caches to 256 entries with oldest-inserted eviction; expiry checks remain in place. This bounds cardinality but is not yet validated against real hit rates or memory measurements.

- Next evidence: cache sizes, hit/miss rates, object/cardinality snapshots, and repeated-load memory measurements.

### P2 — Database and network resources
- The default SQLAlchemy pool is now reduced from five connections plus ten overflow connections to three plus two; default API admission concurrency is reduced from 12 to 3 to better fit the small container. This caps the default pool at five connections and lowers simultaneous request pressure, but may increase queueing under traffic. Explicit Northflank environment variables override these defaults, so verify the deployed `DB_POOL_SIZE`, `DB_MAX_OVERFLOW`, and `API_MAX_CONCURRENT_REQUESTS` values before expecting this change to affect production. Tune with observed request volume and pool wait/error metrics.
- Audit long-lived/reused HTTP clients versus per-call client creation, timeouts, connection limits, transaction boundaries, slow queries, N+1 patterns, and index use.

### P2 — Frontend request volume and maintainability
- `frontend/src/App.jsx` and `frontend/src/components/pages/SearchPage.jsx` are large modules. Size alone does not prove runtime inefficiency, but increases the cost of reviewing effects, state ownership, and duplicate work.
- Playback uses live updates plus polling/synchronization logic. Preserve existing safeguards and verify lifecycle cleanup, hidden-tab behavior, request deduplication, and fallback behavior before altering it.
- Audit bundle size, expensive render paths, request payloads, service-worker caching, and offline media storage.

## Safe implementation sequence

1. Capture a baseline: current Shane commit, CI checks, current test results, bundle/build output, and staging load-test behavior.
2. Fix high-confidence resource-retention and retry/concurrency defects with focused regression tests.
3. Fix measured slow queries and unnecessary request/render work.
4. Run backend tests, lint/type checks, frontend tests/build, security checks, and approved staging load tests.
5. Report before/after evidence, unresolved risks, and recommended Northflank resource sizing.

## Guardrails

- Changes for this removal task must target `Bot-Deletion`.
- Do not edit, merge into, or force-update `main`.
- Do not run stress tests against production without an approved test window.
- Do not claim performance gains without measurements; source inspection alone cannot establish actual production memory attribution.


## Repository-wide dead-code and duplication audit (in progress)

### Verified references — preserve these
- `rclone_remote` appears in backend settings, `.env.example`, and README configuration documentation. A text search alone does not prove it is unused at runtime; do not remove until all bot/integration entry points and environment contracts are traced.
- `local_log_root` is present in settings and verification environment setup. Keep until logging and test fixture behavior are traced.
- `demo_audio_path` is consumed by `backend/app/api/routes/audio.py` and used by verification setup. It is not dead configuration.
- `boto3` and `b2sdk` are both imported by `backend/app/services/b2.py`; both have plausible distinct runtime roles and must not be removed based on dependency-name searches alone.
- `mutagen` is used by audio metadata, compression, and admin route code and corresponding tests. Preserve it.

### Confirmed safe Docker change
- `Dockerfile.backend` uses `pip install --no-cache-dir --no-compile -r requirements.backend.txt`. This avoids generating installed bytecode during the build; `PYTHONDONTWRITEBYTECODE=1` is already set for runtime. This is a conservative build-layer optimization and is not claimed to fix runtime OOMs.

### Validation update
- GitHub Actions run `38644275625` completed successfully for both `journeys` and `windows-runner` on this branch's initial optimization commit.
- No dependencies or application features have been removed.
- The dead-code/duplicate audit is not complete. Search results are candidate evidence only; before deletion, trace dynamic imports, entry points, environment contracts, migrations, tests, CI, and Docker copy/build behavior. Runtime-only usage may not be discoverable by text search.
- No live load test or before/after memory measurement has been run. Do not attribute the production OOM to any single code path without correlated logs or profiling.


### Additional source review — startup and background work

- `backend/app/main.py` starts database keepalive, message-retention cleanup, rate-limit cleanup, and media/artist identity backfill tasks inside the API process. These are active maintenance responsibilities, not dead code. Do not remove them as cleanup. Their database workload and shutdown behavior should be measured; if the backend and bot are later split onto the VPS, keep the maintenance ownership explicit to avoid duplicate jobs across replicas.
- `run_media_identity_backfill()` repeatedly processes batches of up to 250, yields with `asyncio.sleep(0)`, and runs until both media identity and artist profile backfills report no work. It is a potential startup/ongoing database-load hotspot, but source inspection alone does not establish it as the OOM cause. Next safe improvement is instrumentation and a controlled batch/load test before changing batch size or scheduling.
- The database pool defaults and API admission limits are intentionally bounded for small containers. Avoid raising concurrency simply because the VPS has more cores; first measure database capacity, request latency, and per-process memory.
- `Dockerfile.backend` installs FFmpeg and copies backend code plus Alembic migrations/configuration. FFmpeg and migrations are required by current runtime/build behavior; do not remove them based on image-size goals. CI explicitly builds this Dockerfile and verifies production image contents.
- `requirements.dev.txt` includes backend requirements, test/lint/type/security tools, and Pillow. It is not copied by `Dockerfile.backend`; don't move dev tooling into or remove runtime dependencies from the production requirements without tracing actual imports and image/CI use.
- The repository search found real uses for HTTPX, SQLAlchemy engine creation, background tasks, B2 SDKs, Mutagen, and FFmpeg-related code. Search excerpts are not a complete static call graph, so no dependency removals are justified by the current evidence.

### Next deletion gate
Before any deletion, require all of:
1. Repository-wide reference search across backend, frontend, bot, scripts, migrations, tests, workflows, docs, and deployment configuration.
2. Check dynamic imports, entry points, environment variables, CLI/script references, and external API contracts.
3. A focused test or explicit rationale demonstrating the candidate is not required.
4. Full CI on the exact candidate commit.
5. A reviewable diff with the candidate and evidence recorded here.

No dead code or duplicate implementation has yet met this deletion gate. That is intentional: the current evidence supports preserving the reviewed items.


### Latest recheck — 2026-10-14

- Latest commit before instrumentation, `5c9592a00b66fa6b17cf1984c79ae8505848dd04`, passed both PR workflows: Project verification (run `38655230853`) and Offline PWA checks (run `38655230859`). The project workflow passed its `journeys` and `windows-runner` jobs; offline checks passed backend image build/content verification, backend syntax/regression/lint/type/dependency/security checks, and frontend image/build/tests.
- Separate PR #44, `fix/profile-picture-upload`, also has successful latest workflow runs on head `614768986df68ddb8b0821784c5a0862bd19c01a` (Project verification `38519155817`, Offline PWA checks `38519155795`). It remains a separate draft PR and has not been merged.
- Added timing diagnostics to `run_media_identity_backfill()` on the optimization branch. Debug logs now include per-batch row counts and elapsed time; an info log records total rows, batches, and elapsed time at completion. Batch size, scheduling, query behavior, and task lifecycle were not changed. This gives us evidence for a later controlled test without prematurely tuning or removing maintenance.
- This diagnostics commit still requires its own CI run. Do not treat the prior passing workflow runs as validation of the new commit.
- Still outstanding: capture real runtime memory/CPU/request-error baselines; inspect effective deployment environment overrides without changing them; run a representative non-production workload; compare Docker image size/build time against a recorded baseline; and finish reference tracing before considering any code/dependency deletion.
- No production workload or Northflank/VPS service was accessed or modified as part of this recheck. No deployment, merge, account change, or production stress test was performed.
