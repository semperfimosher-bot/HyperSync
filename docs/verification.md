# Automated verification

Use Python 3.12 and Node 24. The verification runner creates disposable accounts,
SQLite data, generated audible WAV tracks, and temporary local storage. It does
not load `backend/.env`, send mail, use B2 credentials, or migrate a hosted Neon
database. Keep your development credentials in your existing ignored environment
file; no production secrets belong in CI or reports.

```sh
python -m pip install -r requirements.dev.txt
npm ci --prefix frontend
cd frontend
npx playwright install --with-deps chromium firefox webkit
cd ..
python scripts/verify_project.py --suite quick
python scripts/verify_project.py --suite full
python scripts/verify_project.py --suite endurance --duration-minutes 30
```

Run these from an activated virtual environment. On Windows use the same Python
commands; browser system dependencies are installed by Playwright on supported
systems. `--headed` shows the browser. `--list` lists checks without starting the
application. Each run allocates its own ports and owned directories. Do not run a
frontend build concurrently with an active browser suite against the same checkout.

Quick includes backend tests, Python lint/types, frontend regression tests/build,
and Chromium desktop/touch journeys. Full adds Firefox/WebKit, dependency and
security scans, a Docker backend build, and disposable PostgreSQL verification.
Missing required tools or services produce nonzero results, not a passing release.
CI runs full verification on pull requests and main; manual workflow
runs offer full and endurance. Existing security/container CI remains in place.

## PostgreSQL

Full requires an explicitly disposable **local** PostgreSQL service with database
creation privileges. Set `HYPERSYNC_TEST_POSTGRES_URL` to its admin connection URL.
Only `localhost`, `127.0.0.1`, and `::1` endpoints without query overrides are
accepted. Do not use a tunnel to a live database. The runner creates a random
`hs_verify_...` database, records an ownership marker, exercises migrations and
concurrent writes, and removes only that database. Parent-side cleanup also runs
when a child is interrupted. A hard host shutdown can still prevent cleanup; inspect
the last report and ownership marker before removing any abandoned resource.

The checks upgrade the migration predecessor, seed representative data, upgrade to
head, verify data preservation, confirm authentication releases its transaction,
and race two Jam revision writes. Hosted Neon connectivity is separate evidence.

## Results

Each run writes `verification-results/<timestamp-run-id>/index.html`, `summary.md`,
`results.json`, command logs, and a Playwright HTML/JSON report. Failed journeys
retain screenshots and traces. Endurance periodically writes a checkpoint with
cycles, requests, elapsed time, and browser-exposed JS heap when available; this is
not an operating-system memory measurement. CI artifacts expire after 14 days.

Exit codes: **0** all required checks passed; **1** failure/interruption; **2**
blocked/incomplete. Reports marked `state: running` are incomplete even if individual
checks passed. Critical browser journeys use zero retries; skipped/flaky outcomes
cannot silently become a passing suite. Browser fixtures contain generated test
identities only. Runtime fixture directories are removed after the suite.

## Read-only deployed smoke

```sh
python scripts/verify_project.py --suite production-smoke --target https://hypersynced.app
```

This explicitly requests GET `/` and GET `/health/ready` on the supplied HTTPS
origin. It sends no account credentials, follows no redirects, performs no
mutations, and retains no response bodies. The health route must be exposed on
that origin; a different deployment layout is a failed probe, not proof that its
database is broken. HTTP success does not prove the deployed commit or playback.

## Feature evidence and limits

| Area | Automated evidence |
| --- | --- |
| Authentication | Guest access, remembered login/reload, logout isolation |
| Playback | Actual audio time, pause/resume, seek, navigation continuity, natural completion |
| History/navigation | Live Recently Played ordering; delayed saved-view response cannot overwrite navigation |
| Playlists | UI create/add, persisted collection playback, API reorder persistence |
| Jam | Home mouse/keyboard/touch menu, join, queue convergence, reconnect, removal/access rejection |
| Offline | Download completion, disconnected reload, actual cached audio playback |
| Recovery | Simulated unavailable audio and delayed earlier selection |
| PostgreSQL | Real migration/data retention, auth connection lifetime, concurrent revision conflict |
| Infrastructure | Exit codes, redaction, timeouts, interruption, path/ownership guards, process descendants |

The touch project emulates pointer/layout behavior; it is not a physical phone.
Playlist reorder currently has an API check because there is no dedicated visible
reorder control. Generated audio tests do not certify B2, SMTP, lyrics, metadata,
upload providers, push delivery, or internet streaming. Test-only audio observation
wraps the real `Audio` constructor without replacing playback. An optional
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` selects a locally installed Chromium; record its
actual version and do not equate it with bundled-browser CI.

## Manual device release record

For each supported iOS Safari/PWA and Android Chrome/PWA device, record device,
OS/browser version, installed/browser mode, commit/deployed build, timestamp,
steps, expected/actual result, and recording/log reference. Verify lock/unlock,
background audio for 30 minutes, lock-screen metadata and controls, next/previous,
seek, headphones/Bluetooth reconnect, incoming calls, output changes, offline
restart, and low-memory recovery. Browser automation cannot certify OS lock-screen
or terminated-app playback. Do not claim Spotify-level reliability from a single
passing run.

## Local environment alignment

The existing `go` development setup defaults to frontend port **4153** and backend
port **8000**. Align `FRONTEND_PUBLIC_URL=http://localhost:4153` and
`FRONTEND_ORIGINS=http://localhost:4153,http://127.0.0.1:4153`. Keep the pooled Neon
URL in `DATABASE_URL` and direct URL in `MIGRATION_DATABASE_URL` for your ordinary
development setup. Verification does not consume either value. SMTP/B2/private
push keys remain backend-only; never copy them into `VITE_` variables.
