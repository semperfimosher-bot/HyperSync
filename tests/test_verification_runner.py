import os
import sys
from pathlib import Path

import pytest

from scripts.verification.models import CheckResult, aggregate_exit_code
from scripts.verification.processes import run_check


def execute(tmp_path: Path, code: str, *args: str, timeout: float = 5):
    return run_check(
        [sys.executable, "-c", code, *args],
        cwd=tmp_path,
        env=dict(os.environ),
        timeout_seconds=timeout,
        log_path=tmp_path / "check.log",
        secrets=("secret-test-value",),
    )


def test_literal_arguments_success_and_secret_redaction(tmp_path):
    folder = tmp_path / "space ü"
    folder.mkdir()
    literal = "$(touch bad); `echo bad`"
    result = execute(folder, "import sys; print(sys.argv[1]); print('secret-test-value')", literal)
    assert result.status == "passed"
    output = (folder / "check.log").read_text()
    assert literal in output
    assert "secret-test-value" not in output
    assert not (folder / "bad").exists()


def test_failed_child_records_original_exit_code(tmp_path):
    result = execute(tmp_path, "print('failure evidence'); raise SystemExit(7)")
    assert result.status == "failed"
    assert result.exit_code == 7
    assert "failure evidence" in (tmp_path / "check.log").read_text()


def test_missing_program_is_blocked(tmp_path):
    result = run_check(
        [str(tmp_path / "nonexistent")],
        cwd=tmp_path,
        env={},
        timeout_seconds=1,
        log_path=tmp_path / "check.log",
        secrets=(),
    )
    assert result.status == "blocked"


def test_timeout_is_failure_and_leaves_evidence(tmp_path):
    result = execute(
        tmp_path, "import time; print('started', flush=True); time.sleep(10)", timeout=0.2
    )
    assert result.status == "failed"
    assert "timeout" in result.detail.lower()
    assert "started" in (tmp_path / "check.log").read_text()


@pytest.mark.parametrize(
    ("states", "code"),
    [
        (["passed"], 0),
        (["blocked"], 2),
        (["failed", "blocked"], 1),
        (["interrupted"], 1),
        (["skipped"], 2),
        ([], 2),
    ],
)
def test_aggregate_never_claims_unexecuted_checks_passed(states, code):
    assert aggregate_exit_code([CheckResult(s, s, 0, None, None, "") for s in states]) == code


@pytest.mark.parametrize("value", ["0", "-1", "nan", "inf", "1441"])
def test_duration_rejects_unbounded_or_invalid_values(value):
    import argparse

    from scripts.verify_project import positive_minutes

    with pytest.raises(argparse.ArgumentTypeError):
        positive_minutes(value)


def test_cli_list_does_not_create_reports_or_require_browser(tmp_path):
    import subprocess

    script = Path(__file__).resolve().parents[1] / "scripts/verify_project.py"
    result = subprocess.run(
        [sys.executable, str(script), "--list", "--output-dir", str(tmp_path / "out")],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0
    assert "browser-journeys" in result.stdout
    assert not (tmp_path / "out").exists()
