# HyperSync reliability stages 1–6: verification record

This record separates automated checks from environment-dependent acceptance tests.
A green CI run is necessary, but it is not proof of production readiness.

## Current branch and safety boundary

- Work branch: `stage6/library-performance-20261017`
- Proposed base: `Shane`
- Scope: isolated reliability and library-performance work
- Production: no merge, deployment, Northflank change, or production load test is authorized by this branch.

## Stage-by-stage status

| Stage | What is verified in this branch | Remaining acceptance gap | Status |
| --- | --- | --- | --- |
| 1. Deep codebase audit | Relevant catalog, playlist/library, PWA, security-check, and verification paths were inspected; CI exercises backend/frontend regression suites and image/config builds. | A full human-reviewed inventory of every subsystem, dependency, known bug, and operational risk has not been independently signed off in this record. | Partial |
| 2. Stability and critical bug fixes | The full backend regression suite, frontend offline regression suite, project verification journeys, Python compile, lint, and type checks are covered by CI. | No live staging smoke test of authentication, uploads, playback, lyrics, and recovery was run as part of this branch verification. | Automated gates pass; staging pending |
| 3. Security hardening | CI runs backend dependency audit and security scan, plus frontend production dependency audit. | These automated scanners are not a penetration test, authorization review of every route, or secret/configuration audit of the deployed environment. | Automated gates pass; manual/staging review pending |
| 4. Frontend performance | Library and playlist reads use bounded API pages; single-track resolution uses the direct catalog endpoint; library rendering is capped to 100 visible items with a load-more control; quiet refreshes avoid refetching the complete cached track list. | The page still aggregates all library pages into browser memory on a cold load, so this is not yet fully lazy-loaded. Full library snapshots are now persisted in IndexedDB rather than duplicating the full track array into localStorage; a 100,000-track round-trip and per-user cache isolation regression test was added. Large playlist snapshots still use the existing playlist-cache path and need separate quota validation. | Partial |
| 5. PWA/offline reliability | Offline regression tests, frontend build, production frontend image/Nginx checks, backend regression tests, and project verification journeys are included in passing CI runs. | Real browser/device offline launch, reconnect, storage-quota, and playback-interruption tests have not been run against staging in this verification. | Automated gates pass; device/staging pending |
| 6. Library/playback optimization | Backend catalog and library pagination support bounded pages; playlist reads can aggregate pages without changing returned ordering/metadata; tests cover single-track lookup, offset-only pagination, and a 1,001-track two-page case. The 100-user k6 scenario is checked into `load/k6-100-users.js`. | The k6 test has not been executed against an isolated staging deployment with a representative 100,000-published-track dataset. The client still downloads all library pages for features that depend on full-library local filtering/grouping. This change makes the offline library snapshot storage quota-safer with IndexedDB but does not yet remove the cold-load in-memory aggregation. | Code/CI verified; load test pending |

## Automated evidence

Use the PR's latest commit and completed workflow conclusions as the authoritative status. The IndexedDB snapshot and privacy-isolation regression tests are newly added and require their own completed CI run:

- Offline PWA checks: frontend offline tests/build/dependency audit; backend regression, lint, type-check, dependency/security checks; production backend and frontend image/config checks.
- Project verification: Windows verification tests and isolated application journeys.

Do not mark a workflow green until its run has completed successfully on the latest commit.

## Remaining staging acceptance checklist

1. Run `load/k6-40-users.js` against the isolated staging API and test database; require all documented thresholds to pass and confirm the service recovers.
2. Only after step 1 passes, run `load/k6-100-users.js` against staging with a representative 100,000-published-track catalog. Use a dedicated staging account token only if testing private endpoints; never use an admin or production token.
3. Record the actual k6 summary, API p95/p99, error rate, database pool metrics, instance memory/CPU, and any 429/503 responses.
4. In a real browser, verify sign-in/session refresh, library and playlist reads, audio seeking/range requests, lyrics timing, offline launch, reconnect, and playback restore without unexpected autoplay.
5. Specifically verify the 100,000-track cold-library path and offline cache/storage behavior. Current DOM capping is not sufficient evidence that these paths are memory- or quota-safe.
6. Review and resolve any failures before proposing merge or deployment.

## Pass criteria

Stages 1–6 must not be described as completely finished until the automated checks are green on the latest commit, the remaining code-level limitations above are resolved or explicitly accepted, and the applicable isolated-staging tests pass. Production remains untouched until separately authorized.
