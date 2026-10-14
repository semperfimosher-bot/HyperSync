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
