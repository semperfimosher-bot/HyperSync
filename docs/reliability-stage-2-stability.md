# Stage 2 — Stability and critical bug fixes

**Branch:** `Semifinals`  
**Evidence baseline:** `4e417ba63c4321388ec73371b5cb2e3cf6102ab8`  
**Status:** Automated code gate passes; operational acceptance remains open.

## Scope and guardrails

Stage 2 covers confirmed defects that can cause crashes, broken core workflows, unsafe recovery, or regressions in authentication, uploads, playback, and lyrics. Preserve existing user-visible behavior unless a fix requires a documented change. Do not merge, deploy, alter Northflank, access production data, or run production load tests as part of this stage.

A green CI run demonstrates the checks that CI actually ran; it does not demonstrate live provider integration or deployed-environment readiness.

## Verified code and automated regression coverage

The latest recorded CI runs for the evidence baseline both passed:

- [Offline PWA checks — run 39243608779](https://github.com/semperfimosher-bot/HyperSync/actions/runs/39243608779)
- [Project verification — run 39243608772](https://github.com/semperfimosher-bot/HyperSync/actions/runs/39243608772)

Recorded evidence includes **557 backend tests passed and 2 skipped**, frontend production build and browser regressions, Ruff, Pyright, dependency/security checks, production image/config checks, isolated PostgreSQL application journeys, backup/restore and killed-worker recovery rehearsal, and Windows verification tests.

Relevant regression coverage in the repository includes:

- `tests/test_auth_session_lifecycle.py`: registration/session lifecycle, refresh behavior, and session-row handling.
- `tests/test_upload_recovery.py`, `tests/test_audio_upload_limits.py`, and upload cleanup/duplicate-prevention tests: upload recovery, size enforcement, CORS planning, cleanup, and duplicate prevention.
- `tests/test_track_lyrics.py` and `tests/test_lrclib_service.py`: lyrics endpoint/cache behavior and provider-service behavior under controlled tests.
- `frontend/src/localPlayback.test.js`: local queue/seek/pause/next/previous behavior and the regression that automatic media-retention timing begins on the audio element's `playing` event, not merely after selecting a track.
- `tests/test_backend_load_recovery.py` and the isolated project-verification journey: bounded overload behavior and controlled recovery.
- The browser regression suite: offline reload/navigation, failed updates/install, cache quota failure, and local IndexedDB media playback/seek.

These are automated test results, not a claim that live B2, a real browser session against staging, or a physical device was exercised.

## Remaining acceptance gates

Stage 2 cannot be called fully complete until the following checks run against a **confirmed isolated staging deployment and staging-only accounts/data**:

1. **Authentication:** browser sign-in, refresh, expired/invalid session behavior, and recovery after reconnect.
2. **Uploads:** a small test-media upload through the configured provider path; confirm preflight/CORS, upload completion, retry/failure handling, final object-size validation, and cleanup of abandoned uploads.
3. **Playback and lyrics:** authenticated browser playback, seeking/range requests, lyrics fetch and synchronized-line progression, and recovery after a temporary network interruption.
4. **Service recovery:** confirm staging health/readiness before and after a controlled staging-only restart or worker interruption; retain the actual verification report.
5. **Evidence:** record the staging build/commit identity, pass/fail results, relevant sanitized errors, and unresolved defects. Do not record tokens, cookies, signed URLs, or other secrets.

Do not run destructive upload or recovery checks against production. Do not run load tests under Stage 2; scale testing belongs to its separately gated stage and must remain staging-only.

## Current conclusion

The code-level regression gate is green on the evidence baseline. The operational gates above are **not yet evidenced as passed**, so Stage 2 remains open rather than being falsely signed off. The repository's staging guide uses placeholders and does not establish that a staging deployment is currently available. A staging origin and a dedicated test account/provider configuration are required to execute the remaining real-environment checks. Credentials should be entered through the approved secret mechanism, never pasted into source files or committed.
