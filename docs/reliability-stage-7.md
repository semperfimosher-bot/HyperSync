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
