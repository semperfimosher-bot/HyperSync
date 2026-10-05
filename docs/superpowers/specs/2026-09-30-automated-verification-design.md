# HyperSynced automated verification design

Status: written specification approved by the user on 2026-09-30 UTC.
Date: 2026-09-30 UTC (2026-09-29 America/New_York).
Reference production commit: 4b81c827f4791c1121130edda972d3f3917c4a31.
Implementation branch: test/automated-verification.

## Goal and preservation contract

Provide one repeatable command that runs existing checks, starts an isolated app,
exercises real browser journeys, and saves evidence that the user and assistant
can inspect. Run the same checks in GitHub Actions without an active chat session.

The user explicitly requires preservation of every existing feature. This work
adds verification infrastructure; it does not redesign the player, replace the
launch scripts, remove features, or change production settings. Test-discovered
product defects receive a reproducing test and a small, separately reviewable fix.
No claim of zero bugs or Spotify-equivalent reliability follows from a green run.

## Existing foundations

- Frontend Node tests and Vite production build.
- Backend pytest, Ruff, Pyright, dependency audit, and Bandit checks.
- Production backend container build and migration SQL checks.
- scripts/verify-project.ps1 and scripts/verify_backend.py.
- Health/live and health/ready API endpoints.
- Local SQLite bootstrap with a two-second silent demo track.
- No Playwright dependency or complete browser journey suite in the inspected tree.

Preserve these entry points and checks. The new runner coordinates reusable
commands rather than replacing existing verification logic. The two-second demo
track is insufficient for race, seek, and endurance tests, so dedicated fixtures
are required.

## Architecture

1. scripts/verify_project.py: Python-standard-library coordinator, suitable for
   Windows and Linux. Resolves the repository root independently of working
   directory; invokes argument arrays without shell interpolation.
2. frontend/playwright.config.* and frontend/e2e/: browser projects, assertions,
   isolated user contexts, fixtures, and evidence capture.
3. Test-only support scripts: database creation, generated audio, deterministic
   catalog/account fixtures, and app lifecycle management outside public routes.
4. Verification reports: timestamped, commit-associated HTML/Markdown summary,
   JSON results, per-check logs, and Playwright failure artifacts.
5. GitHub Actions integration: required PR checks and manual full/endurance runs,
   with report upload even when tests fail.

The runner manages only processes it starts. Browser tests exercise the normal
HTTP API and UI. No public test-seeding or authentication-bypass endpoint is added.

## Commands and suite definitions

Proposed interface:

    python scripts/verify_project.py --suite quick
    python scripts/verify_project.py --suite full
    python scripts/verify_project.py --suite endurance --duration-minutes 30

Shared options include --output-dir, --headed, and --list. The last lists planned
checks and prerequisites without launching servers or changing databases.

Quick: existing frontend/backend regression tests, Python lint/type checks,
frontend production build, and critical Chromium browser journeys. Security audit
and container checks retain their existing CI jobs rather than silently vanishing
from the release gate.

Full: quick checks plus Firefox/WebKit journey projects, PostgreSQL integration
and migration checks, dependency/security audits, and production container
verification. A required missing browser, Docker engine, or test database marks
that suite blocked and returns a nonzero exit code.

Endurance: a bounded playback/navigation/queue/reconnect loop against the isolated
app. Default duration is 30 minutes; an explicit duration supports longer runs.
It produces intermediate evidence so interruption still leaves a useful report.
Duration, workload, browser, and environment are always recorded. This first
milestone is not a general load generator or proof of production-scale capacity.

A separate explicit production-smoke mode may perform allowlisted read-only
version, health, and asset checks. It must never inherit mutation journeys or
endurance/load workloads. Authenticated live playback checks require a dedicated
configured account and a separately specified scope; they are not part of this
first milestone.

## Isolation and fixtures

- Create a unique run directory with an ownership marker and run identifier.
- Give child processes explicit test configuration, test JWT secret, database,
  storage, and ports. Do not inherit a developer's production DATABASE_URL or
  backend environment file into the isolated app.
- Verify how the existing settings loader reads environment files; configure the
  test launcher so explicit settings win and missing values cannot fall through
  to production credentials. Tests must assert this isolation behavior.
- Quick browser journeys use a fresh SQLite database and local generated audio.
- Full database checks use a disposable local/CI PostgreSQL service. CI provisions
  the service; local full runs require a disposable database configuration or
  managed local container. No Neon production project is used.
- Migrate PostgreSQL through Alembic before seeding. Test fresh schema creation and
  forward upgrade from the immediately previous migration revision using owned
  fixtures; extend historical migration coverage later.
- Generate at least three distinct, non-silent, valid audio fixtures long enough
  for seeking and queue tests; use a short fixture for natural-ended behavior.
- Seed ordinary test accounts and memberships without modifying real accounts.
- Route external media-provider behavior through controlled test fixtures for
  deterministic failure scenarios. Label simulated provider checks clearly.
- Preserve the production artifact and API paths where practical, including the
  built frontend and service worker for offline/update-related journeys.
- Delete only paths/databases verified as owned by the current run. Never clean a
  generic storage directory or drop an arbitrary configured database.

## Initial browser journeys and assertions

1. Guest startup: page renders, catalog fixture is visible, no unhandled startup
   exceptions, and ordinary navigation works.
2. Authentication: sign in through the UI, reload with a remembered session,
   verify protected behavior, sign out, and verify private state is cleared.
3. Playback across navigation: start a known track, verify HTMLMediaElement time
   advances, navigate between pages, and verify track identity and continuity.
4. Playback controls: pause freezes time within tolerance; resume advances time;
   seek updates position; next/previous selects the expected identity; a natural
   end advances once. Use conditions and tolerances rather than fixed sleeps.
5. Recently Played: play distinct tracks, observe updated history without reload,
   delay overlapping profile responses, and verify the newest state survives.
6. Playlist/queue: create a test playlist, add/reorder tracks through available UI,
   play it, and verify queue order; clean up only test-owned records.
7. Home Jam entry: desktop context menu and touch long press open Jam from Home;
   other pages lack that entry; existing track menus still work. Navigation does
   not tear down an active Jam controller.
8. Multi-user Jam: independent browser contexts join through an invite, update the
   queue, reconnect, and converge. Verify unauthorized/non-member mutation fails
   and a removed participant cannot continue controlling the session.
9. Offline: download a fixture, verify completion, disconnect, reload, and play
   from local storage. Confirm an interrupted download is not reported complete.
10. Recovery: controlled failed/delayed requests produce a bounded error or recovery
    path without blanking the app or creating an unbounded request loop.

Do not weaken assertions or add blanket exception suppression to make tests pass.
Document browser-specific exclusions with a reason and an explicit status. Touch
emulation and WebKit on Linux are not reported as real iPhone verification.

## Runner lifecycle and reliability

Run independent checks after an unrelated failure when doing so is safe; block
only checks whose prerequisites failed. Always write the aggregate report.
Record command, sanitized output, duration, exit status, and failure category.
Use bounded subprocess and readiness timeouts. Probe the selected ports before
launch, fail clearly on conflicts, and do not terminate unrelated services.
On completion, failure, or interruption, stop owned browser/server processes and
release owned temporary resources. Exercise cleanup on Windows and Linux.

Exit codes: 0 only when all checks required by the selected suite passed; 1 for
failed checks; 2 for blocked configuration/prerequisites; interrupted runs use a
nonzero interrupted status. A mixed failed/blocked run retains both categories in
its report and returns failure.

## Reports and data handling

Default output: verification-results/<timestamp>-<short-commit>-<run-id>/.
Add report directories to ignore rules; do not commit generated media or traces.
Each report records commit, dirty-tree status, suite, platform, tool versions,
browser versions, timing, executed/skipped/blocked counts, and artifact links.
A check has one of passed, failed, skipped, blocked, or interrupted states.
Skipped checks never satisfy a required release gate. Retries preserve the first
failure and mark a recovered test flaky; critical flaky journeys fail the gate
until investigated rather than becoming silently green.

Save stdout/stderr per check, a machine-readable JSON summary, a human-readable
summary, browser screenshots on failure, and retained traces for failed journeys.
Run browser traces only with disposable identities and generated data. Do not
assume traces can be perfectly redacted; exclude production-authenticated runs
from trace collection by default. Redact secret values from command logs and
never log complete inherited environments. CI artifacts expire after 14 days.

## GitHub Actions integration

Keep current regression, security, and container checks. Add Chromium journey
coverage to PR validation and relevant main-branch validation. Full browser and
endurance workloads are workflow_dispatch operations in this milestone; no paid
service or recurring high-cost workload is introduced automatically.
Use least-privilege read permissions for test jobs. PR jobs need no production
secrets. Always upload reports when available, including on failure. Cancellation
still preserves already-written evidence where the runner permits it. CI job
concurrency prevents obsolete branch runs consuming unbounded resources.

Do not automatically enable branch protection or change Northflank configuration
as an incidental side effect. Report any required external release setting as a
separate actionable configuration item.

## Feature coverage and physical-device checks

Maintain docs/verification.md with commands, prerequisites, report interpretation,
and a feature-to-test inventory. Mark uncovered features honestly rather than
claiming whole-project coverage. Include a manual-results template for OS lock
screen controls, Bluetooth, phone-call interruptions, background suspension, and
speaker output. Record device/OS/browser/build, steps, result, and evidence.

Device automation services, broad performance/load testing, external-provider live
checks, backup restoration drills, and production telemetry are later milestones.
This infrastructure makes those additions possible but does not claim them done.

## Acceptance criteria

- Existing verification commands and all existing feature behavior are preserved.
- Quick suite executes locally and in CI with real browser outcome assertions.
- Full suite genuinely executes PostgreSQL and configured browser projects, or
  fails blocked when required prerequisites are missing.
- Initial journey list is implemented with meaningful assertions; any unsupported
  case is visibly recorded and is not counted as completed coverage.
- Intentionally introduced assertion failure produces nonzero exit and readable
  failure evidence; timeout and missing prerequisite paths also produce reports.
- Fixture isolation, process cleanup, and log-redaction behavior are exercised.
- CI artifacts are available after a failed run as well as after success.
- A real bounded endurance run is performed and its duration/results reported.
- No test or cleanup operation touches production accounts, data, or storage.
- Independent review and passing applicable existing CI checks precede integration.

## Implementation handoff

After written-spec review, prepare a file-level implementation plan with testable
increments: runner/reporting, isolated app fixtures, browser journeys, PostgreSQL
and endurance extensions, CI integration, documentation, and independent review.
Use small commits and preserve failure evidence. Report measured results and
remaining hardware/access limitations at completion.
