# Automated Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run isolated command-line and browser checks with trustworthy, durable failure evidence while preserving all existing HyperSynced behavior.

**Architecture:** A standard-library Python runner coordinates existing checks and a test-only app launcher. Playwright exercises the built frontend against disposable fixtures; PostgreSQL, endurance, and CI extend the same runner and report schema.

**Tech Stack:** Python 3.12+, pytest, existing Node 24/Vite frontend, Playwright Test with Chromium/Firefox/WebKit, disposable PostgreSQL, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-30-automated-verification-design.md`

## Global Constraints

- The user explicitly requires preservation of every existing feature.
- No public test-seeding or authentication-bypass endpoint is added.
- Quick browser journeys use a fresh SQLite database and local generated audio.
- Full database checks use a disposable local/CI PostgreSQL service.
- No Neon production project is used.
- Delete only paths/databases verified as owned by the current run.
- Skipped checks never satisfy a required release gate.
- CI artifacts expire after 14 days.
- This first milestone is not a general load generator or proof of production-scale capacity.
- Production secrets are not required by PR jobs or isolated fixtures.

## Review Focus

- Paths with spaces/non-ASCII and arguments containing shell metacharacters must remain literal (Task 1).
- A parent environment or backend/.env containing production credentials must not affect test configuration (Task 2).
- Interruption or a child process spawning descendants must leave evidence and stop only owned processes (Task 2).
- A browser retry succeeding after its first failure must be visible and must fail critical journey gates (Tasks 1 and 3).
- Stale download caches or account state must not leak across browser contexts or runs (Tasks 3 and 4).

## File map

- `scripts/verify_project.py`: public CLI, suite selection, dependency ordering, exit codes.
- `scripts/verification/{__init__,models,reporting,processes,checks}.py`: result schema, report writing, managed processes, command definitions.
- `scripts/verification/{environment,fixtures,serve}.py`: isolated settings, fixture seeding, app/static server lifecycle.
- `scripts/verification/postgres.py`: disposable PostgreSQL migration verification.
- `tests/test_verification_{runner,reporting,environment,processes,fixtures,postgres}.py`: infrastructure regression coverage.
- `frontend/playwright.config.js`: browser projects, reporter/artifact configuration.
- `frontend/e2e/{fixtures,helpers}.js`: disposable identities, media assertions, browser contexts.
- `frontend/e2e/*.spec.js`: complete user journeys and endurance behavior.
- `frontend/package.json`, `frontend/package-lock.json`: pinned Playwright development dependency and test scripts.
- `.github/workflows/offline-pwa-tests.yml`: preserve current checks, add PR/main Chromium and Windows runner smoke coverage.
- `.github/workflows/verification-full.yml`: manual full/endurance operations and PostgreSQL service.
- `.gitignore`: ignore owned run directories and generated reports.
- `docs/verification.md`: prerequisites, commands, coverage map, reports, physical-device checklist.

## Task 1: A runner that reports real outcomes

**Interfaces:** `CheckResult(name: str, status: str, duration_seconds: float, exit_code: int | None, log_path: str | None, detail: str)`. Status is one of passed/failed/skipped/blocked/interrupted. `run_check(argv: list[str], *, cwd: Path, env: dict[str, str], timeout_seconds: float, log_path: Path, secrets: tuple[str, ...]) -> CheckResult`. `write_report(run_dir: Path, metadata: dict[str, object], results: list[CheckResult]) -> None`. `aggregate_exit_code(results: list[CheckResult]) -> int`.

- [ ] Write `test_verification_runner.py`: a successful child passes; exit 7 fails; a missing executable blocks; a timeout fails; literal metacharacters and a spaced/non-ASCII path arrive unchanged. Assert exit 0 only for all required passes, 1 for failures, 2 for blocked prerequisites, and nonzero for interruption.
- [ ] Write `test_verification_reporting.py`: JSON and readable summary survive a failed child; secret values do not occur in captured logs; HTML special characters are escaped; recovered critical retries remain failure/flaky evidence rather than success.
- [ ] Run `python -m pytest tests/test_verification_runner.py tests/test_verification_reporting.py -q`; confirm missing implementation causes failures.
- [ ] Implement models, streamed redacted logs, atomic JSON/Markdown/HTML report writes, and sequential check execution without shell=True. Avoid holding unlimited output in memory. Record original attempts as well as retries.
- [ ] Implement CLI `main(argv: list[str] | None = None) -> int` with quick/full/endurance, --duration-minutes (positive, default 30), --output-dir, --headed, and --list. Metadata includes commit/dirty status, platform, versions, run ID, timing, and selected checks. --list performs no setup or network access.
- [ ] Define existing test/lint/type/build commands in checks.py. Resolve Python from the active interpreter and npm through platform-appropriate executable lookup. Keep old verification entry points intact.
- [ ] Run the task tests and `python scripts/verify_project.py --suite quick --list`; verify a readable ordered check list and exit 0 without server startup.
- [ ] Commit runner/reporting and ignore rules with `test: add verification runner and evidence reports`.

## Task 2: Isolated application, generated fixtures, owned cleanup

**Interfaces:** `RunEnvironment(run_id: str, root: Path, database_url: str, api_port: int, web_port: int, manifest_path: Path)`. `create_environment(run_dir: Path) -> RunEnvironment`; `load_test_settings(environment: RunEnvironment) -> Settings`; `seed_fixtures(environment: RunEnvironment) -> dict[str, object]`; `start_app(environment: RunEnvironment) -> ManagedApp`; `ManagedApp.close() -> None`.

- [ ] Write isolation tests with deliberately dangerous dummy parent DATABASE_URL/B2/SMTP credentials and a fake backend/.env. Assert effective test settings use owned database/storage, generated JWT secret, local origins, and disabled outbound services. Assert no fake secret is copied into the manifest/report.
- [ ] Write fixture tests for three distinct non-silent valid audio files (at least 30 seconds), one short ended fixture, test accounts, deterministic track identities, and valid catalog media references. Assert a second run has separate storage and identities.
- [ ] Write process tests: occupied port blocks without killing its owner; normal shutdown terminates owned descendants; KeyboardInterrupt still flushes a report; invalid/missing ownership marker prevents cleanup; external symlink paths cannot broaden deletion.
- [ ] Run `python -m pytest tests/test_verification_environment.py tests/test_verification_fixtures.py tests/test_verification_processes.py -q` and confirm red.
- [ ] Implement test-only settings loading with `_env_file=None` and explicit test values before importing app modules. Install the resulting settings provider only inside the test launcher process. Do not change normal production settings behavior.
- [ ] Implement generated fixtures via model/session APIs and a manifest containing only test identities and local URLs. Use generated credentials solely for disposable accounts. Start the app with normal routes and a local frontend server serving the production build and proxying /api; preserve service-worker scope and content types.
- [ ] Implement process groups and bounded readiness/cleanup for Windows and Linux. Own ports and PIDs explicitly. Never clean generic repo storage, arbitrary configured databases, or user files.
- [ ] Run the isolation/process tests and start/stop the real isolated app. Verify /api/health/ready, frontend HTML, and range access to a fixture return expected responses.
- [ ] Commit with `test: isolate application fixtures and managed test processes`.

## Task 3: Browser startup, login, playback, and live history

**Interfaces:** manifest consumed through `HYPERSYNC_TEST_MANIFEST`; `login(page, identity)`, `startTrack(page, track)`, and `expectPlaybackAdvancing(page, track)` from e2e/helpers.js. Projects named chromium, firefox, webkit; a separate touch Chromium project checks touch interactions. Tests use accessible roles/names; stable test IDs only where no suitable user-facing locator exists.

- [ ] Pin a compatible stable @playwright/test version and update the lockfile through npm. Add test:e2e and test:e2e:headed scripts; do not alter the existing offline test command.
- [ ] Add startup/auth/playback/history specifications for journeys 1–5 in the spec. Each checks outcomes: remembered-session protected access, logout isolation, actual currentTime progress, paused-time tolerance, track identity across navigation, seek position, single natural advancement, and history update without reload.
- [ ] Include delayed out-of-order profile responses and latest user action winning during rapid track selection. Use bounded eventual assertions and media-event state instead of arbitrary multi-second sleeps.
- [ ] Run the new tests against the real isolated app; confirm failing assertions are visible before correcting harness details or any reproduced product defect. Do not intentionally damage unrelated product code to manufacture a red run.
- [ ] Configure JSON/HTML reports, screenshots and traces for failures, and fail on relevant unexpected page errors. Classify expected injected network errors explicitly rather than globally suppressing errors. Make a passing retry on a critical test fail the aggregate release check.
- [ ] Test recording a controlled failure: nonzero exit, screenshot/trace links, original error, and sanitized test identity. Remove the intentional failure fixture from normal suites afterward.
- [ ] Run Chromium journeys and the existing frontend suite. Verify fresh contexts do not inherit another account's caches or local storage.
- [ ] Commit with `test: exercise authentication playback and live history in browsers`.

## Task 4: Playlists, Home menu, Jam, offline, and recovery

**Files:** frontend/e2e/playlists.spec.js, home-jam.spec.js, jam-session.spec.js, offline.spec.js, recovery.spec.js; extend helpers only for shared operations.

- [ ] Add playlist assertions for UI creation/add/reorder, persisted server order, and expected playback queue.
- [ ] Add desktop right-click, touch long-press, and keyboard Home menu assertions. Verify Jam entry absence on other pages, preserved track menus, and session continuity when leaving Home.
- [ ] Add two-context Jam assertions: invite join, concurrent queue edits, reconnect convergence, rejected unauthorized mutations, and removed member loss of access. Assert bounded requests and revisions rather than exact timing between polls.
- [ ] Add offline journey: completed download, disconnected reload, advancing cached playback, and interrupted download remaining incomplete. Use service-worker-controlled contexts and clean caches per run.
- [ ] Add failure injection for one unavailable track and delayed API responses; verify bounded visible failure/recovery with navigable UI and stable queue. Mock provider behavior only at explicitly identified network boundaries and label it simulated.
- [ ] Run each new spec against isolated fixtures. Fix test-discovered product defects only with a reproduction and a small separately reviewable change; retain existing features.
- [ ] Run all initial journeys under Chromium and supported Firefox/WebKit projects. Report browser limitations as blocked/skipped with reasons; do not silently reduce full-suite requirements.
- [ ] Commit with `test: cover playlists Jam offline playback and recovery`.

## Task 5: Real PostgreSQL migration and concurrency verification

**Interfaces:** `verify_postgres(database_url: str, run_id: str, report_dir: Path) -> list[CheckResult]`. Accept only an explicitly disposable local/CI database endpoint; create a uniquely named owned test database where privileges permit, or require a dedicated disposable service instance created for this run. Never interpret an uploaded production URL as disposable.

- [ ] Add tests rejecting non-disposable/remote targets, invalid ownership, and cleanup against a different run. Ensure subprocess migration settings cannot inherit production credentials.
- [ ] Implement fresh Alembic upgrade, fixture seed, and representative query/constraint checks on PostgreSQL. Verify upgrade from head's predecessor using data valid at that revision and assert fixture data survives.
- [ ] Run relevant auth-connection lifetime and Jam concurrent mutation scenarios against PostgreSQL rather than claiming SQLite coverage proves PostgreSQL behavior. Preserve existing fast tests.
- [ ] Make full suite block clearly when PostgreSQL prerequisites are missing. Provision a local container only with explicit owned configuration; manage cleanup by run identifier.
- [ ] Run task tests and real disposable PostgreSQL integration. Capture server/driver versions and migration heads without connection credentials.
- [ ] Commit with `test: verify PostgreSQL migrations and concurrent operations`.

## Task 6: Bounded endurance and restricted production smoke

**Files:** frontend/e2e/endurance.spec.js; scripts/verification/checks.py; scripts/verification/reporting.py; tests/test_verification_runner.py.

- [ ] Add duration validation tests (zero, negative, non-number rejected) and interruption/report checkpoint tests. Add production-smoke target tests rejecting non-HTTPS remote URLs, credentials embedded in URLs, redirects to unapproved targets, and non-allowlisted paths/methods.
- [ ] Implement a time-bounded loop over playback, navigation, queue changes, and controlled reconnects. Record cycles, elapsed time, errors, request counts, browser-observable resource data when supported, and periodic checkpoints. Do not label browser memory proxies as OS process-memory measurements.
- [ ] Add explicit production-smoke CLI mode limited to GET health and frontend assets/version evidence. Keep it separate from mutation suites, disable sensitive trace capture, and report a missing verifiable build identifier as a limitation rather than inventing one.
- [ ] Run a short development endurance smoke, then the required 30-minute isolated endurance run with checkpoints and final report. Preserve evidence on interruption and rerun only to resolve the interruption or a concrete failure.
- [ ] Commit with `test: add bounded endurance runs and restricted smoke checks`.

## Task 7: CI, usage documentation, and release review

**Interfaces:** runner exit status controls CI outcome; verification-results directory is uploaded with always() and retention-days: 14. Test jobs use contents: read and no production secrets.

- [ ] Preserve existing CI checks; add main branch triggering and a Chromium journey job. Use a Windows job for the runner's portability/process tests and Linux for full browser integration.
- [ ] Create manual full/endurance workflow inputs with explicit suite/duration. Provision PostgreSQL service for full runs and install Playwright browser system dependencies using supported commands. Cancel obsolete branch PR runs without cancelling explicitly requested endurance jobs unexpectedly.
- [ ] Upload available reports on success/failure. Do not add automatic merging or alter branch protection/Northflank settings as a side effect.
- [ ] Write docs/verification.md with actual commands, environment setup, external-access limitations, report examples, feature coverage mapped to named tests, and uncovered features. Include manual device/OS/browser/build evidence template for lock screen, Bluetooth, calls, and audio output.
- [ ] Run infrastructure tests, existing required checks, quick and full suites with their prerequisites. Validate missing-prerequisite and controlled-failure reports. Run the production container build and applicable security checks through existing CI.
- [ ] Request independent whole-branch review focused on feature preservation, database/environment isolation, trustworthy reports, and owned cleanup. Correct concrete findings and rerun affected checks.
- [ ] Commit documentation/CI, publish the branch and PR, wait for required checks, and integrate under the user's existing authorization only after passing gates. Report deployed-version verification separately from merge success.

## Self-review record

All spec sections map to Tasks 1–7. Runner/reporting, isolation, browser assertions,
PostgreSQL checks, bounded endurance, CI, coverage documentation, and hardware
limitations are explicit. Review Focus inputs have tests in their owning tasks.
The optional environment upload is not a prerequisite for isolated verification;
any later use requires endpoint classification and separate secret-safe handling.
No test suite is allowed to turn missing tooling, unexecuted cases, or recovered
critical flakes into a claim that the whole application passed.
