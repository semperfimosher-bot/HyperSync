# HyperSync Stage 7 — Operational observability and recovery

## Purpose

Stages 1–6 established substantial code-level reliability and performance improvements, but CI does not prove the running system can explain or recover from real failures. Stage 7 makes failures diagnosable and recovery measurable before any production rollout.

## Safety boundaries

- Branch: `stage7-observability-recovery-20261018`, based on the verified Stage 6 head.
- Do not merge, deploy, change Northflank services/settings, modify accounts, access production data, or run load tests against production.
- Do not add a new paid monitoring service or persistent event stream without evidence it is needed.
- Do not log authorization headers, access/refresh tokens, cookies, signed media URLs, request bodies, private user data, or raw query strings.
- Keep same-device playback restore. Do not introduce cross-device playback/control.

## Work packages (finish and verify in order)

### 7.1 — Failure diagnosis without sensitive logging
- Inspect existing request, overload/admission, database-pool timeout, upload, artwork, and background-task logs.
- Add or refine request correlation and duration/status diagnostics only where they can be added safely and tested; avoid high-cardinality metric labels and logging raw query parameters.
- Ensure rejected/overloaded requests remain distinguishable from upstream/provider, database, and application failures.
- Confirm diagnostic failures never turn a successful user operation into a failed request.

**Acceptance:** regression tests cover correlation headers, error/timeout paths, privacy-safe output, and cleanup. No secrets or signed URLs appear in captured logs.

### 7.2 — Bounded resource and background-task lifecycle
- Audit task creation/cancellation, request admission, database pool waits, HTTP client reuse/timeouts, upload/media stream permits, and process-local cache bounds.
- Fix only source-confirmed defects, with targeted tests; document any hypotheses that require staging measurements.
- Ensure shutdown cancels or drains tasks and releases permits/connections within bounded time.

**Acceptance:** focused tests cover cancellation, timeout, and permit release; backend suite, lint, types, dependency/security checks pass.

### 7.3 — Safe staging verification and recovery drills
- Use a separate staging frontend, API, database, and test-only media bucket; confirm all origins and credentials are staging-only before testing.
- Run the 40-user k6 test first. Run 100 users only after the lower tier passes and the service recovers.
- Exercise controlled staging-only database/provider interruption, reconnect, authentication refresh, upload completion/retry safety, artwork fallback, audio range requests, offline launch, and playback restore.
- Capture p95/p99 latency, error/503 rate, memory/CPU, database pool waits, and recovery time. Do not claim a performance improvement without before/after measurements.

**Acceptance:** results and environment details recorded; all thresholds pass or a clearly scoped blocker is filed. No production load test.

### 7.4 — Stage gate and handoff
- Review findings from 7.1–7.3 and add regression coverage for every reproduced defect.
- Re-run all CI workflows on the final Stage 7 head.
- Produce a concise readiness report with passed checks, open risks, staging evidence, and items requiring user/device verification.

**Acceptance:** CI green on the exact final commit, no unresolved critical/high-severity reproduced defect, and staging/device gaps clearly identified. Stage 7 is not complete if required staging access is unavailable.

## Explicit non-goals

- No forced move to SSE/WebSockets. First instrument repeated requests and identify the event source, connection lifecycle, reconnect policy, and memory cost; introduce push only if measurements justify it.
- No unapproved deployment, merge, production stress test, database migration, account mutation, or infrastructure changes.
- No promise of “100% perfect”; the goal is measured reliability with known residual risks.

## Starting evidence

- Stage 6 CI passed on commit `70a99287e0fd13537153ac46f3b2d42ca606002a` for the Offline PWA checks workflow, including frontend tests/build/audit, backend regression/lint/type/security checks, and both production image builds.
- Project verification jobs passed on run `39110755525`.
- The Stage 6 verification record still lists real-browser/device and isolated-staging checks as outstanding. Stage 7 must close or explicitly document those gaps rather than treating CI as deployment evidence.


## Implementation and verification record

### 7.1 — Implemented; CI verification pending on final head

- Added `RequestDiagnosticsMiddleware` and registered it with the API application.
- Successful, slow, and handled 5xx responses receive a generated `X-Request-ID`. Diagnostic records include request ID, HTTP method, route template (never the raw path), status/exception type, and duration.
- Unhandled exceptions that occur before response headers now return a generic JSON 500 with the same request ID. Exception messages, raw URL paths, query strings, headers, and bodies are not included in these diagnostics.
- Added regression coverage for successful/slow requests, handled 503s, and unhandled exceptions, including assertions that private path/query values and exception messages do not appear in diagnostic records.
- Known limitation: if an exception occurs after response headers have already been sent, the response cannot be replaced safely; it is logged and re-raised.

### 7.2 — Source audit findings

- **Admission control:** `DatabaseAdmissionMiddleware` uses a bounded semaphore and timeout; HTTP permits are released at response start and WebSocket permits at acceptance. This intentionally bounds request setup, not the lifetime of streams or WebSocket database work. Database access must continue to be bounded by the SQLAlchemy pool.
- **Database pool:** engine configuration sets pool size, max overflow, pool timeout, pre-ping/recycle, command timeout, statement timeout, lock timeout, and idle-in-transaction timeout from settings. Actual production values and pool wait behavior require staging telemetry.
- **Background tasks:** the bot runtime tracks spawned tasks and cancels/gathers them on shutdown. API lifespan cancels its maintenance/listener tasks and closes the database after task cleanup. Cancellation-resistant tasks could still delay shutdown because some drains are awaited without a deadline; changing this safely requires targeted lifecycle tests and is recorded as an open risk rather than changing shutdown ordering blindly.
- **On-demand ingestion:** source resolution and download/publication have process-local semaphores; durable ingest coordination uses PostgreSQL advisory locks. Throughput, queueing, and memory/disk behavior across replicas must be measured in staging before changing concurrency.
- **No push transport redesign:** there is not yet measurement proving SSE/WebSockets would improve the repeated-request workload, so no transport change was made.

### 7.3 — Blocked pending isolated staging access

No isolated staging environment credentials/configuration or staging-only media bucket were available in this work session. Therefore no 40-user or 100-user load test, provider/database interruption drill, real browser/device offline test, or production-like recovery measurement was run. Do not treat CI or image builds as substitutes for these checks. Before running them, an operator must confirm the frontend/API origins, database, storage bucket, credentials, and test accounts are all staging-only.

### 7.4 — Current gate

- Latest pre-fix workflow runs passed on commit `e835aebfea5f19f0164dfc30d92a8688bf7bb6ed`.
- The final-head workflows must pass after the request-ID regression fix before code-level completion can be declared.
- **Stage 7 remains gated** until the final-head CI passes and the isolated staging/device checks above are completed or explicitly accepted as a release blocker by the project owner. No merge or deployment is authorized by this report.
