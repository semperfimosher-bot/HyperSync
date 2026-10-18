# HyperSync Stage 8 — Scalability and reliability testing

## Purpose

Validate the system against realistic workload, resource limits, network failures, and recovery behavior for the target of approximately 100 users and a large library (up to 100,000 tracks). Stage 8 is evidence-driven: no capacity or reliability claim is accepted without measured results from an isolated environment.

## Guardrails

- This branch is stacked on Stage 7; it does not merge Stage 7 into any production branch.
- Do not merge, deploy, alter Northflank, change accounts, access production data, or run load tests against production.
- All load and fault tests require an isolated staging frontend, API, database, and test-only media bucket.
- Verify staging origins, credentials, test accounts, and storage targets before starting a test.
- Start with 40 concurrent virtual users. Run 100 only after the 40-user run passes and the environment recovers.
- The existing 500-user script is a legacy scenario, not part of Stage 8 acceptance; it must not be run without a separate capacity plan and explicit approval.
- Do not introduce SSE/WebSockets solely as a guess. Use request/event measurements from staging to identify polling hotspots first.
- Preserve same-device playback restore; do not add cross-device playback or controls.

## Work packages

### 8.1 — Workload model and safe test harness

- Review existing staging-load-test tooling before creating duplicate scripts.
- Define reproducible scenarios for sign-in/session refresh, library page navigation/search, playlist snapshots, artwork fetch/fallback, audio range requests, uploads/retries (test media only), offline launch, and same-device playback restore.
- Keep credentials out of logs and test artifacts. Do not emit signed URLs, authorization headers, cookies, or user-specific response bodies.
- Require an explicit staging base URL and a safety guard that rejects known production hostnames/configuration.
- Record test version, environment resource limits, dataset size, run duration, concurrency, and scenario mix.
- Ensure all existing k6 scenarios (40, 100, and legacy 500 users) enforce the same staging-only host/URL confirmation checks.

**Acceptance:** script syntax checks pass; each k6 scenario refuses to run without explicit staging configuration and refuses known production targets. Host checks do not prove a custom DNS alias is staging, so operators must independently verify routing, database, and storage.

### 8.2 — Baseline at 40 concurrent users

- Run a warm-up, steady-state, and cool-down period against isolated staging only.
- Capture p50/p95/p99 latency, throughput, HTTP status/error rate, 503/admission rejections, CPU, memory/RSS, database pool saturation/waits, and recovery time.
- Include the target library shape (large catalog) without copying production user data.
- Save sanitized results as artifacts.

**Acceptance:** no unexplained errors, no leak/monotonic memory growth, and recovery to baseline after the run. Thresholds must be documented before execution rather than chosen after seeing results.

### 8.3 — Escalate to 100 users

- Run only after 8.2 passes and the staging service is stable.
- Compare metrics against the 40-user baseline and known resource ceilings.
- Stop immediately on sustained error spikes, runaway memory, repeated process restarts, or service instability.
- Never interpret a passing CI test as proof of 100-user capacity.

**Acceptance:** measured results and a capacity/risk statement tied to the exact environment and commit.

### 8.4 — Fault injection and recovery

Staging-only, one fault at a time:
- temporary network loss and reconnect;
- database/provider interruption and recovery;
- expired session/auth refresh;
- upload interruption, retry, and duplicate-safety;
- artwork miss/fallback;
- audio byte-range request interruption;
- offline launch and restore of the same song/position on the same device.

Capture recovery time and confirm no corrupted/duplicated uploads, stuck tasks, leaked permits/connections, or cross-device playback behavior.

**Acceptance:** each fault has expected behavior, actual outcome, and a regression test for every reproducible code defect.

### 8.5 — Query/event efficiency review

- Use request diagnostics and staging traffic to rank repeated endpoints by volume, latency, and aggregate backend/database cost.
- Identify client polling that can be reduced or consolidated without weakening correctness.
- Consider SSE/WebSockets only when a measured event stream, reconnect strategy, per-connection memory, proxy timeouts, and multi-replica delivery model are specified.
- Do not change transport as part of the test setup merely to reduce a request count.

**Acceptance:** evidence-based decision record listing measured hotspots and changes proposed or explicitly deferred.

### 8.6 — Gate and handoff

- Re-run all CI workflows on the final Stage 8 head.
- Publish exact environment, dataset shape, concurrency, duration, thresholds, raw/sanitized result artifact locations, faults exercised, and remaining blockers.
- Separate CI verification from staging evidence and manual browser/device acceptance.

**Acceptance:** all required checks pass, staging evidence is attached, and unresolved risks are explicitly documented. If staging is unavailable, mark Stage 8 blocked rather than claiming success.

## Status

- Stage 8 branch is based on Stage 7 head `26eaf3e8293719018eb573fd8c303d2efa375801`.
- Reused existing 40-user and 100-user k6 scripts and operator guidance rather than duplicating them.
- Found and fixed a safety gap in the legacy 500-user script: it now requires explicit staging confirmation and exact expected-host matching, rejects known production hosts and non-origin URLs, and has a bounded request timeout.
- CI now syntax-checks all three k6 scripts.
- No load tests have been run because an isolated staging destination has not been confirmed.
- The scripts currently exercise API catalog/search and optional library/playlist requests only; browser flows, uploads, audio streaming, offline startup, and fault injection remain separate work packages.
- Initial thresholds are HTTP failure rate below 1%, overall p95 below 750 ms, p99 below 1,500 ms, and catalog/search p95 below 750 ms. Confirm these are suitable for the measured staging hardware before treating them as release gates.
- This document and passing CI do not establish 100-user capacity or production readiness.
