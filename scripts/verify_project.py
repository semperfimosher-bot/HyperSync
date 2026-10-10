"""Cross-platform verification entry point; reports survive individual check failures."""

import argparse
import os
import platform
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.verification.checks import base_checks  # noqa: E402
from scripts.verification.models import CheckResult, aggregate_exit_code  # noqa: E402
from scripts.verification.processes import run_check  # noqa: E402
from scripts.verification.reporting import write_report  # noqa: E402


def positive_minutes(value: str) -> float:
    number = float(value)
    if not 0 < number <= 24 * 60:
        raise argparse.ArgumentTypeError("duration must be between 0 and 1440 minutes")
    return number


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--suite", choices=["quick", "full", "endurance", "production-smoke"], default="quick"
    )
    parser.add_argument("--duration-minutes", type=positive_minutes, default=30)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "verification-results")
    parser.add_argument("--headed", action="store_true")
    parser.add_argument("--list", action="store_true")
    parser.add_argument("--target", help="Explicit HTTPS origin for read-only production smoke")
    args = parser.parse_args(argv)
    if args.suite == "production-smoke":
        from scripts.verification.smoke import smoke_targets

        try:
            smoke_targets(args.target or "")
        except ValueError as error:
            parser.error(str(error))
        if args.list:
            print("GET / and GET /health/ready only; no redirects or credentials")
            return 0
    elif args.target:
        parser.error("--target is only valid for production-smoke")
    checks = base_checks(ROOT, args.suite)
    if args.list:
        for name, _, _, timeout in checks:
            print(f"{name}: timeout {timeout}s")
        print("browser-journeys: isolated app and installed Playwright browsers required")
        if args.suite == "full":
            print("postgres: disposable local PostgreSQL required")
        return 0
    return execute_suite(args)


def execute_suite(args: argparse.Namespace) -> int:
    import asyncio
    import json
    import tempfile
    import time
    from contextlib import ExitStack

    run_id = uuid4().hex
    run_dir = args.output_dir.resolve() / (
        datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ-") + run_id[:8]
    )

    def git(*arguments: str) -> str:
        try:
            return subprocess.check_output(["git", *arguments], cwd=ROOT, text=True).strip()
        except (OSError, subprocess.CalledProcessError):
            return "unavailable"

    metadata: dict[str, object] = {
        "run_id": run_id,
        "state": "running",
        "commit": git("rev-parse", "HEAD"),
        "dirty": bool(git("status", "--porcelain")),
        "suite": args.suite,
        "platform": platform.platform(),
        "python": platform.python_version(),
        "duration_minutes": args.duration_minutes,
    }
    if args.suite == "production-smoke":
        from scripts.verification.smoke import verify_smoke

        run_dir.mkdir(parents=True, exist_ok=True)
        smoke_results = verify_smoke(args.target, run_dir)
        metadata["state"] = "completed"
        write_report(run_dir, metadata, smoke_results)
        print(f"Report: {run_dir / 'index.html'}", flush=True)
        return aggregate_exit_code(smoke_results)
    results: list[CheckResult] = []
    write_report(run_dir, metadata, results)
    started = time.monotonic()
    with ExitStack() as stack:
        try:
            from scripts.verification.application import start_app
            from scripts.verification.environment import (
                child_environment,
                create_environment,
                load_test_settings,
                owned_cleanup,
            )
            from scripts.verification.fixtures import seed_fixtures

            temporary = stack.enter_context(tempfile.TemporaryDirectory(prefix="hypersync-verify-"))
            environment = create_environment(Path(temporary) / "runtime")
            stack.callback(owned_cleanup, environment)
            env = child_environment(environment)
            settings = load_test_settings(environment)
            secrets = (settings.jwt_secret,)
            checks = base_checks(ROOT, args.suite)
            if args.suite == "endurance":
                checks = [item for item in checks if item[0] == "frontend-build"]
            metadata["commands"] = {name: command for name, command, _, _ in checks}
            interrupted = False
            for name, command, cwd, timeout in checks:
                print(f"Running {name}", flush=True)
                result = run_check(
                    command,
                    cwd=cwd,
                    env=env,
                    timeout_seconds=timeout,
                    log_path=run_dir / f"{name}.log",
                    secrets=secrets,
                )
                results.append(result)
                write_report(run_dir, metadata, results)
                print(f"{name}: {result.status}", flush=True)
                if result.status in {"failed", "blocked", "interrupted"}:
                    if result.detail:
                        print(f"{name} detail: {result.detail}", flush=True)
                    log_path = run_dir / f"{name}.log"
                    if log_path.is_file():
                        # Keep CI logs actionable when the full report is
                        # retained as an artifact. The runner redacts secrets
                        # before writing this log; redact again at the point
                        # of display as a defense in depth.
                        excerpt = log_path.read_text(
                            encoding="utf-8",
                            errors="replace",
                        ).splitlines()[-80:]
                        for line in excerpt:
                            for secret in secrets:
                                line = line.replace(secret, "[REDACTED]")
                            print(f"{name} log: {line}", flush=True)
                if result.status == "interrupted":
                    interrupted = True
                    break
            build_ok = any(r.name == "frontend-build" and r.status == "passed" for r in results)
            if interrupted or not build_ok:
                results.append(
                    CheckResult(
                        "browser-journeys",
                        "blocked",
                        0,
                        None,
                        None,
                        "Required frontend build did not complete successfully",
                    )
                )
            else:
                asyncio.run(seed_fixtures(environment))
                app = start_app(environment)
                stack.callback(app.close)
                env["HYPERSYNC_REPORT_DIR"] = str(run_dir)
                env["HYPERSYNC_ENDURANCE_MINUTES"] = str(args.duration_minutes)
                command = ["node", "node_modules/@playwright/test/cli.js", "test"]
                if args.suite == "endurance":
                    command += ["--project=endurance"]
                else:
                    command += ["--project=chromium", "--project=touch"]
                    if args.suite == "full":
                        command += ["--project=firefox", "--project=webkit"]
                if args.headed:
                    command.append("--headed")
                metadata["browser_command"] = command
                timeout = args.duration_minutes * 60 + 180 if args.suite == "endurance" else 1200
                result = run_check(
                    command,
                    cwd=ROOT / "frontend",
                    env=env,
                    timeout_seconds=timeout,
                    log_path=run_dir / "browser-journeys.log",
                    secrets=secrets,
                )
                results.append(result)
                raw = run_dir / "browser-results.json"
                if raw.exists():
                    browser_data = json.loads(raw.read_text())
                    browser_errors = [
                        error
                        for suite in browser_data.get("suites", [])
                        for nested in [suite, *suite.get("suites", [])]
                        for spec in nested.get("specs", [])
                        for test in spec.get("tests", [])
                        for attempt in test.get("results", [])
                        for error in attempt.get("errors", [])
                    ]
                    def report_browser_failures(suite: dict) -> None:
                        for spec in suite.get("specs", []):
                            for test in spec.get("tests", []):
                                for attempt in test.get("results", []):
                                    errors = attempt.get("errors", [])
                                    if not errors:
                                        continue
                                    project = test.get("projectName", "browser")
                                    title = spec.get("title", "journey")
                                    print(
                                        f"browser failure [{project}] {title}",
                                        flush=True,
                                    )
                                    for error in errors:
                                        message = str(error.get("message", ""))
                                        for secret in secrets:
                                            message = message.replace(secret, "[REDACTED]")
                                        print(message[:3000], flush=True)
                        for child in suite.get("suites", []):
                            report_browser_failures(child)

                    for suite in browser_data.get("suites", []):
                        report_browser_failures(suite)
                    missing_browser = any(
                        "Executable doesn't exist" in str(error.get("message", ""))
                        for error in browser_errors
                    )
                    if missing_browser:
                        results.append(CheckResult(
                            "browser-prerequisites", "blocked", 0, None, None,
                            "Required Playwright browser is not installed",
                        ))
                        if all("Executable doesn't exist" in str(error.get("message", ""))
                               for error in browser_errors) and not browser_data.get("errors"):
                            result.status = "blocked"
                            result.detail = "Required Playwright browser is not installed"
                    metadata["browser_stats"] = browser_data.get("stats", {})
                    stats = browser_data.get("stats", {})
                    if (stats.get("flaky", 0) or stats.get("skipped", 0)) and not missing_browser:
                        result.status = "failed"
                        result.detail = "Required browser journeys include flaky or skipped cases"
                    if not stats.get("expected", 0) and result.status == "passed":
                        result.status, result.detail = "failed", "No browser journeys executed"
                elif result.status == "passed":
                    result.status, result.detail = "failed", "Missing browser result evidence"
                print(f"browser-journeys: {result.status}", flush=True)
                if result.detail:
                    print(f"browser-journeys detail: {result.detail}", flush=True)
                browser_log = run_dir / "browser-journeys.log"
                if result.status != "passed" and browser_log.is_file():
                    excerpt = browser_log.read_text(
                        encoding="utf-8",
                        errors="replace",
                    ).splitlines()[-100:]
                    for line in excerpt:
                        for secret in secrets:
                            line = line.replace(secret, "[REDACTED]")
                        print(f"browser-journeys log: {line}", flush=True)
                app.close()
                for log in environment.root.glob("server-*.log"):
                    text = log.read_text(errors="replace")
                    for secret in secrets:
                        text = text.replace(secret, "[REDACTED]")
                    (run_dir / log.name).write_text(text, encoding="utf-8")
        except KeyboardInterrupt:
            results.append(
                CheckResult("runner", "interrupted", 0, None, None, "Interrupted by user")
            )
        except (ImportError, FileNotFoundError) as exc:
            results.append(
                CheckResult(
                    "prerequisites",
                    "blocked",
                    0,
                    None,
                    None,
                    f"Missing prerequisite: {type(exc).__name__}",
                )
            )
        except Exception as exc:
            results.append(
                CheckResult(
                    "runner",
                    "failed",
                    0,
                    None,
                    None,
                    f"Verification infrastructure failed: {type(exc).__name__}",
                )
            )
        finally:
            if args.suite == "full" and any(r.status == "interrupted" for r in results):
                results.append(CheckResult("postgres", "blocked", 0, None, None,
                                           "Suite interrupted before PostgreSQL stage"))
            elif args.suite == "full":
                try:
                    from scripts.verification.postgres import verify_postgres

                    results.extend(verify_postgres(
                        os.environ.get("HYPERSYNC_TEST_POSTGRES_URL", ""), run_id, run_dir
                    ))
                except (Exception, KeyboardInterrupt) as error:
                    results.append(CheckResult(
                        "postgres", "failed", 0, None, None,
                        f"PostgreSQL stage interrupted or failed: {type(error).__name__}",
                    ))
            try:
                stack.close()
            except Exception as exc:
                results.append(
                    CheckResult(
                        "cleanup",
                        "failed",
                        0,
                        None,
                        None,
                        f"Owned cleanup failed: {type(exc).__name__}",
                    )
                )
            metadata["state"] = "completed"
            metadata["elapsed_seconds"] = round(time.monotonic() - started, 2)
            write_report(run_dir, metadata, results)
    print(f"Report: {run_dir / 'index.html'}", flush=True)
    return aggregate_exit_code(results)


if __name__ == "__main__":
    raise SystemExit(main())
