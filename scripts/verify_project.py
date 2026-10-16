"""Small, cross-platform verification runner without browser automation."""

import argparse
import os
import platform
import subprocess
import sys
import tempfile
import time
from contextlib import ExitStack
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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--suite", choices=["quick", "full", "production-smoke"], default="quick")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "verification-results")
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
        return run_smoke(args.target, args.output_dir)
    if args.target:
        parser.error("--target is only valid for production-smoke")
    checks = base_checks(ROOT, args.suite)
    if args.list:
        for name, _, _, timeout in checks:
            print(f"{name}: timeout {timeout}s")
        if args.suite == "full":
            print("postgres: disposable local PostgreSQL required")
        return 0
    return execute_suite(args, checks)


def run_smoke(target: str, output_dir: Path) -> int:
    from scripts.verification.smoke import verify_smoke

    run_id = uuid4().hex
    run_dir = output_dir.resolve() / (datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ-") + run_id[:8])
    run_dir.mkdir(parents=True, exist_ok=True)
    metadata: dict[str, object] = {
        "run_id": run_id,
        "state": "running",
        "suite": "production-smoke",
        "platform": platform.platform(),
        "python": platform.python_version(),
    }
    results = verify_smoke(target, run_dir)
    metadata["state"] = "completed"
    write_report(run_dir, metadata, results)
    print(f"Report: {run_dir / 'index.html'}", flush=True)
    return aggregate_exit_code(results)


def execute_suite(args: argparse.Namespace, checks: list[tuple[str, list[str], Path, int]]) -> int:
    run_id = uuid4().hex
    run_dir = args.output_dir.resolve() / (
        datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ-") + run_id[:8]
    )
    run_dir.mkdir(parents=True, exist_ok=True)

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
    }
    results: list[CheckResult] = []
    write_report(run_dir, metadata, results)
    started = time.monotonic()
    with ExitStack() as stack:
        try:
            from scripts.verification.environment import (
                child_environment,
                create_environment,
                owned_cleanup,
            )

            temporary = stack.enter_context(tempfile.TemporaryDirectory(prefix="hypersync-verify-"))
            environment = create_environment(Path(temporary) / "runtime")
            stack.callback(owned_cleanup, environment)
            env = child_environment(environment)
            secrets: tuple[str, ...] = ()
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
                if result.detail:
                    print(f"{name} detail: {result.detail}", flush=True)
                if result.status in {"failed", "blocked", "interrupted"}:
                    break
        except KeyboardInterrupt:
            results.append(
                CheckResult("runner", "interrupted", 0, None, None, "Interrupted by user")
            )
        except (ImportError, FileNotFoundError, RuntimeError, ValueError) as error:
            results.append(
                CheckResult(
                    "prerequisites",
                    "blocked",
                    0,
                    None,
                    None,
                    f"Verification prerequisite unavailable: {type(error).__name__}",
                )
            )
        except Exception as error:
            results.append(
                CheckResult(
                    "runner",
                    "failed",
                    0,
                    None,
                    None,
                    f"Verification infrastructure failed: {type(error).__name__}",
                )
            )
        finally:
            if args.suite == "full":
                try:
                    from scripts.verification.postgres import verify_postgres

                    postgres_url = os.environ.get("HYPERSYNC_TEST_POSTGRES_URL", "")
                    results.extend(verify_postgres(postgres_url, run_id, run_dir))
                except (Exception, KeyboardInterrupt) as error:
                    results.append(
                        CheckResult(
                            "postgres",
                            "failed",
                            0,
                            None,
                            None,
                            f"PostgreSQL stage failed: {type(error).__name__}",
                        )
                    )
            try:
                stack.close()
            except Exception as error:
                results.append(
                    CheckResult(
                        "cleanup",
                        "failed",
                        0,
                        None,
                        None,
                        f"Owned cleanup failed: {type(error).__name__}",
                    )
                )
    metadata["state"] = "completed"
    metadata["elapsed_seconds"] = round(time.monotonic() - started, 2)
    write_report(run_dir, metadata, results)
    print(f"Report: {run_dir / 'index.html'}", flush=True)
    return aggregate_exit_code(results)


if __name__ == "__main__":
    raise SystemExit(main())
