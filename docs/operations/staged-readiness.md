# Staged readiness evidence — 2026-10-18

## Scope and isolation

Continue from `e64f1c70b47fb2c8c9f7eda45c50291d536383b9` on
`codex/staged-readiness`, isolated from the existing draft PR #47 branch,
`PERFECT`, and `main`. No merge, deployment, Northflank change, production
database access, provider mutation, or production load test is authorized.
Direct B2 upload remains primary; server upload remains fallback. Preserve
temporary-file cleanup, local playback, playlists, lyrics, and account isolation.

The user approved closing stages 1–5 gaps before advancing through stages 6–10.
Passing a unit suite is evidence for its tested behavior, not a whole-stage pass.

## Evidence ledger

| Stage | Existing evidence | Remaining acceptance work |
| --- | --- | --- |
| 1. Architecture audit | `PERFECT-RELIABILITY-REVIEW.md`, baseline scope, backend operations and memory reports | Reconcile historical findings with current code; keep new findings reproducible and scoped |
| 2. Stability | Base commit has successful Project verification and Offline PWA workflows; local base frontend suite: 261/261 | Verify this follow-up on its own commit; offline shell defects reproduced and fixed below |
| 3. Security | Base workflows cover backend lint/types/security/dependency scans, auth/privacy tests; current frontend production audit: zero known vulnerabilities | Preserve account/cache isolation in review; repeat applicable security checks on final revision |
| 4. Frontend performance | Existing request deduplication, Activity page preservation, bounded backend catalog pages | Main bundle 535.88 kB (147.28 kB gzip); profile instances now capped at eight; admin catalog still retains all pages in memory; measure and resolve remaining limits |
| 5. PWA/offline | Existing media chunk/range/ownership unit tests; earlier CI has no browser automation; new worker event-handler tests | Build-aware shell cache lifecycle, real browser update/partition/storage-pressure journeys, device playback/seek recovery remain to verify |
| 6. Library/playback | Local playback, queues, lyrics and offline media baseline exists | 100,000-song catalog/search measurements, playlist/download continuity and lyrics behavior; do not equate a backend 10k allocation fixture with this gate |
| 7. Backend efficiency | Bounded uploads/catalog serialization, durable jobs, migration locks, provider bounds | Measure remaining duplicate requests/query costs and ranking CPU; add caching/SSE only where justified by a concrete flow |
| 8. Scale/recovery | Disposable PostgreSQL restore and killed-worker CI rehearsals | Realistic 100-user mixed workload and constrained memory/CPU; existing HTTP probe caps concurrency at 64 and is not a 100-user certification |
| 9. Regression/release | Base workflows green | Full checks on final code; feature journeys, builds, audits, failure recovery; list skipped/blocked checks explicitly |
| 10. Readiness | Draft-only workflow | Review every acceptance item and limitation; user approval before merge/deploy |

## Confirmed stability defects and changes

The previous `serviceWorker.test.js` exercises media behavior; it does not
exercise the app-shell fetch/install/message handlers. The new
`serviceWorkerShell.test.js` dispatches those actual registered handlers.

1. An upstream 503 returned an error page even with a cached application.
   Navigation now falls back to cached HTML for unsuccessful responses.
2. Aborting the network fetch did not settle a stalled preload promise.
   The existing 3.5-second deadline now races the entire preload/fetch operation.
3. Cache open/write failures could replace successful online HTML with stale
   content or reject working static assets. Cache storage is optional for online
   delivery; failed cache operations do not discard successful network responses.
4. The worker did not call the existing, tested Origin-only Vary matching helper.
   Static assets now use that helper without bypassing Cookie/Authorization Vary.
5. Precache saved HTML before its scripts/styles and ignored failed assets.
   Required asset failure now rejects install/preparation, preserves old HTML,
   and produces a correlated `ok: false` preparation acknowledgement.
6. Successful navigation similarly saved new HTML before its bundles. It now
   prepares the new entry point in worker-lifetime background work, publishes
   only after required assets are stored, and reuses cached content-hashed bundles.

No audio/database schema/upload behavior is changed. These are stability fixes
to offline flows; they do not imply stage 5 is accepted.

## Validation and limits

- Base frontend suite: 261 passed, zero failed.
- Initial six handler reproductions all failed on the base implementation.
- Three install/publication reproductions failed before their fix.
- Navigation publication regression failed before its fix.
- Review requested acknowledgement and storage-failure coverage; both added.
- Independent review of the final worker changes found no blocking issue.
- Frontend production build passes; its existing large-chunk warning remains.
- Production frontend dependency audit reports zero known vulnerabilities.
- Current frontend suite: 273 passed, zero failed.
- Remote workflow results must be recorded on the final commit before closing
  this checkpoint.

Node handler tests use real Request/Response and the actual worker handlers,
with controlled cache/network/browser boundaries. They do not establish mobile
device behavior, real browser scheduling, storage eviction, production uptime,
or 100-user capacity. The cache name remains v3, and old hashed assets are not
pruned by this change; build-specific lifecycle work remains in stage 5.

## Next gated work

1. Finish current-commit stability verification and reconcile stages 1–3.
2. Address stage 4 with measured startup and retained-state budgets. Check admin
   catalog consumers before changing its full-array contract: only the admin
   upload/catalog pages currently use `useCatalogTracks`; do not assume ordinary
   Home/Search eagerly load this entire store.
3. Complete stage 5 browser update/offline/storage recovery checks. Preserve
   offline navigation if bundle splitting is introduced in stage 4.
4. Only then execute stage 6 library scale/playback, stage 7 backend efficiency,
   stage 8 mixed-workload recovery, and stages 9–10 final regression/review.

## Browser evidence correction and new check

On source inspection, `scripts/verify_project.py` explicitly excludes browser
automation. The CI job named `journeys` is not evidence of browser journeys.
Earlier PR/review wording asserting browser journeys passed was inaccurate;
retain its unit, PostgreSQL, build, and security evidence only.

A new `browser-shell` CI job installs pinned Playwright Chromium and executes
`npm run test:browser` against the production build on an ephemeral loopback
server. It checks real service-worker control, offline reload/network recovery,
upstream 503 fallback, and failed-bundle preparation preserving a runnable
offline shell. The fixture has no real backend, credentials, or live providers.
It does not certify authenticated user journeys, audio playback, mobile Safari,
quota exhaustion, large catalogs, or capacity.

Local execution is blocked: the Chromium archive download is truncated, and
all three browser tests fail at browser launch because the executable is absent.
This is recorded as BLOCKED, not passing; CI must supply actual browser evidence.
The initial shell-fix commit `1e8ed4f` passed Offline PWA workflow 39095358203.
Project verification workflow 39095358204 also passed that commit. The added
browser check requires its own result; earlier green checks do not cover it.

## Stage 4 bounded profile retention

A 1,000-distinct-profile visit fixture retained 1,000 warm page instances before
the fix. It now retains eight recent public-profile instances, plus any ordinary
app tabs. The active profile is never evicted by the cap; same-timestamp visits
use touch order. Revisiting a retained profile preserves its instance key.
Account boundaries, the twelve-hour TTL, and upload/main-tab state remain intact.
An older evicted profile reloads its view when revisited. This is a measured
retained-instance bound, not a measured browser heap reduction.

Four new regressions failed before the relevant fixes. All 277 frontend unit
tests pass, production build passes (535.88 kB main chunk, existing warning),
and independent review found no blocker. Current-commit CI must still pass.

The new real Chromium browser-shell job passed on `4673a11` in workflow
39096454894. It provides the three specifically described shell checks, not
full authenticated/music/device acceptance. Stages 4–5 remain open.
