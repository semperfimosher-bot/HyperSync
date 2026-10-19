# Stages 1–8 integration status for Semifinals

Updated: 2026-10-18

## Purpose

This branch is an isolated integration candidate for the HyperSync reliability plan. It must not be treated as production-ready solely because code or CI checks pass. Production Northflank services, production databases, and production media storage are outside this work.

## Integrated in this pass

This commit applies changes from the Stage 7/8 reliability branch and the staged-readiness branch only where the changed file can be applied without overwriting a different Semifinals edit. This includes:
- privacy-safe request diagnostics middleware and its tests;
- Stage 7/8 verification and staging-only load-test guidance;
- guarded 40/100-user load scripts and bounded legacy 500-user script;
- catalog pagination test and supporting pagination/bounded-response helpers and tests;
- page warm-cache implementation/tests and admin catalog/upload pagination pages;
- shell/build-manifest checks and Stage 4–5 plan/readiness documentation.

## Conflicts intentionally not overwritten

The branches independently changed overlapping implementation files. This pass preserves Semifinals' current versions for those files rather than replacing them wholesale and potentially regressing its newer behavior. These paths still need a real three-way code-level reconciliation:
- `.github/workflows/offline-pwa-tests.yml`
- `frontend/package.json`, `frontend/package-lock.json`
- `frontend/src/App.jsx`
- `frontend/src/audioPlayer.js`
- `frontend/src/components/ui/TrackArtwork.jsx`
- `frontend/src/components/pages/LibraryPage.jsx`
- `frontend/src/mediaStore.js`
- `frontend/src/offlineDownloads.js`
- `frontend/src/serviceWorker.js`
- `frontend/src/serviceWorker.test.js`
- `frontend/src/libraryCache.js`, `frontend/src/libraryCache.test.js`
- `frontend/vite.config.js`
- `backend/app/api/routes/catalog.py`, `backend/app/api/routes/playlists.py`, `backend/app/main.py`
- `tests/test_catalog_pagination.py`
- E2E files whose diffs include line-ending/formatting noise.

## Current verification record

Both CI workflows passed on implementation commit `9ef6119d6f3631f7587c5f88b8554a7bdee7f540`:

- [Project verification run 39189853215](https://github.com/semperfimosher-bot/HyperSync/actions/runs/39189853215): isolated application verification, bounded fixture memory check, operational rehearsal, safety-contract tests, and Windows verification tests passed.
- [Offline PWA checks run 39189853228](https://github.com/semperfimosher-bot/HyperSync/actions/runs/39189853228): frontend unit/regression tests, build, staging-load-script syntax checks, Playwright browser tests, backend regression tests, Ruff lint, Pyright type checks, dependency audit, Bandit scan, and both production container-image checks passed.

The Playwright run exposed a missing app-shell manifest plugin registration and two nondeterministic offline fixtures. The plugin is now registered in Vite; the browser fixtures explicitly stall the local server when testing offline fallback. All 10 browser scenarios passed on this implementation head.

Playwright is currently installed as a pinned CI-only runtime (`1.56.1`) because it is not yet a declared frontend dev dependency. Promote it into `frontend/package.json` and regenerate the lockfile with the project package manager when a normal dependency update can be performed. These are CI results, not isolated staging or physical-device acceptance. Any subsequent commit must be verified independently; a green earlier SHA does not certify a later SHA.

## Release acceptance still required

1. Reconcile the overlapping files above with a real three-way diff and targeted tests; do not replace whole files blindly.
2. Keep the Playwright browser suite green and make its dependency management conventional: the suite now runs in CI and all 10 browser scenarios passed, but Playwright is still installed as a pinned CI-only runtime rather than a declared dev dependency with a lockfile entry.
3. Run staging-only smoke, offline launch, upload/retry and duplicate-safety, artwork fallback, audio range, same-device song/position restore, and recovery checks using an isolated staging hostname, development database, and separate test media storage.
4. Run staged load tests only after verifying that the target hostname routes exclusively to the isolated staging environment. Begin at 40 users, then 100; do not run production load tests.
5. Confirm no Jam/cross-device playback-control behavior has been reintroduced, and preserve same-device playback restoration.

No staging load test or production deployment has been performed. Stage completion is not certified until the acceptance checks above have evidence.
