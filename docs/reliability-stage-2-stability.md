# Stage 2 — Stability and critical bug fixes

**Code verification commit:** `87e60402f1856843476aa35ff4376b6e7208a16d` on `Semifinals`  
**Scope:** confirmed playback/offline-retention correctness issue; preserve local playback and existing cache policy.

## Confirmed issue and fix

Automatic media-cache retention was recorded immediately after the `audio.play()` promise resolved. That is earlier than the media element's explicit `playing` event and can start the retention window before confirmed playback. The retention update now occurs from the actual `playing` event and uses the active track metadata. It is non-blocking and errors remain isolated from playback.

A new `localPlayback.test.js` regression verifies that selecting a track alone does not create a played/retained record, and that the retention timestamp/expiry are set after the audio element emits `playing`. The existing local queue, seek, pause, next/previous, and no-remote-control checks remain in the same suite.

## Exact-head automated evidence

[Offline PWA checks — run 39191644456](https://github.com/semperfimosher-bot/HyperSync/actions/runs/39191644456) passed on the code verification commit, including:

- Frontend offline regression tests and production build.
- Ten real Chromium browser-shell scenarios: offline reload/control, 503 fallback, navigation deadline, failed bundle update/install safety, deferred Search offline navigation, admin paging DOM bounds, build retention, quota failure, and IndexedDB offline media range/playback/seek.
- Backend regression suite: **540 passed, 2 skipped**.
- Operational tooling tests: **37 passed**.
- Ruff, Pyright (0 errors), backend dependency audit (no known vulnerabilities), Bandit scan, frontend production dependency audit, and both production image/config checks.

The additional Project verification workflow on this same SHA was still running when this record was prepared. It must complete successfully before using the SHA as the combined two-workflow checkpoint; any failure must be investigated.

## Stage 2 gate and limitations

**Code-level stability gate:** targeted fix and regression test are implemented; the complete Offline PWA workflow passed. The remaining external-provider and device checks are not represented as passed here: real B2 upload/retry/CORS, authenticated browser playback/lyrics, offline storage pressure, and isolated staging recovery/load tests remain gated for the appropriate later stages.

No merge, deployment, Northflank change, production-data access, or production load test was performed.
