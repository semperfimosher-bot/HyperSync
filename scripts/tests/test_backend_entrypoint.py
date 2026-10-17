import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def run_entrypoint(tmp_path, **env):
    executable = tmp_path / "python"
    executable.write_text(
        '#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALLS"\n'
        'case "$*" in *alembic*) exit "${MIGRATION_RESULT:-0}";; esac\n'
    )
    executable.chmod(0o755)
    calls = tmp_path / "calls"
    result = subprocess.run(
        ["sh", str(ROOT / "scripts/backend-entrypoint.sh")],
        env={
            **os.environ,
            "PATH": str(tmp_path) + ":" + os.environ["PATH"],
            "CALLS": str(calls),
            **env,
        },
        capture_output=True,
        text=True,
        timeout=5,
    )
    return result, calls.read_text() if calls.exists() else ""


def test_migration_on_start_defaults_to_enabled(tmp_path):
    result, calls = run_entrypoint(tmp_path)
    assert result.returncode == 0
    assert "alembic" in calls
    assert "uvicorn" in calls


def test_release_mode_skips_migrations(tmp_path):
    result, calls = run_entrypoint(tmp_path, MIGRATE_ON_START="false")
    assert result.returncode == 0
    assert "alembic" not in calls
    assert "uvicorn" in calls


def test_failed_migration_never_starts_server(tmp_path):
    result, calls = run_entrypoint(tmp_path, MIGRATION_RESULT="1", MIGRATION_MAX_ATTEMPTS="1")
    assert result.returncode == 1
    assert "alembic" in calls
    assert "uvicorn" not in calls
