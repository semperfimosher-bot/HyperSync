# HyperSync Performance and Reliability Audit

Target branch: `Shane` only. Do not merge into or modify `main`.

## Scope and method

Audit backend memory/CPU, request admission and retry behavior, database access, background jobs, on-demand playback/ingestion, HTTP client lifetimes, frontend polling and rendering, service-worker/offline storage, security boundaries, and test/load-test coverage. Separate source-confirmed issues from hypotheses that require production logs or profiling.

## Initial findings (source review; not all are confirmed runtime causes)

### P1 — Runtime stability and overload
- Northflank screenshots supplied for the Shane deployment show 254–256 MB / 256 MB memory, CPU reaching 100% of 0.1 vCPU, and widespread HTTP 503 responses. These are observed runtime symptoms, not source-code proof of a specific cause.
- Backend overload/admission middleware can return 503 when request admission is saturated.
- Frontend API requests now retry safe transient failures at most once (down from three retries) to reduce amplification during sustained overload. Backoff behavior still needs load validation.
- Next evidence: correlate backend logs and timestamps with 503s, process restarts/OOM events, admission wait/rejection metrics, and request latency.

### P1 — Process-local caches and retained state
- `backend/app/services/music_metadata.py` now bounds each of its four process-local metadata caches to 256 entries with oldest-inserted eviction; expiry checks remain in place. This bounds cardinality but is not yet validated against real hit rates or memory measurements.
- `backend/app/services/on_demand_ingestion.py` now bounds the process-local candidate map to 500 entries; durable storage remains the fallback. Session maps have TTL cleanup, but active resolving/ingesting sessions are intentionally retained and still need lifecycle/timeout review.
- Next evidence: cache sizes, hit/miss rates, object/cardinality snapshots, and repeated-load memory measurements.

### P1 — Background tasks and on-demand resolution
- Startup can resume catalog/ingestion work and media-identity backfill. The backfill's cooperative yield is not itself a throughput or memory bound.
- On-demand source resolution and catalog work should have explicit concurrency/time budgets and should not starve interactive API requests.
- Source-refresh exceptions in the on-demand stream route now log a warning with traceback instead of disappearing silently; inspect sanitized deployment logs to determine whether this explains playback failures.
- Next evidence: task inventory, cancellation/exception handling, batch size and duration, event-loop lag, and memory/CPU during cold starts.

### P2 — Database and network resources
- The configured SQLAlchemy pool defaults to five connections plus up to ten overflow connections; request admission is separately configured. Verify effective settings and peak concurrent DB sessions rather than assuming configured maxima are always reached.
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

- All changes and commits must target `Shane`.
- Do not edit, merge into, or force-update `main`.
- Do not run stress tests against production without an approved test window.
- Do not claim performance gains without measurements; source inspection alone cannot establish actual production memory attribution.
