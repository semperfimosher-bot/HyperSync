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
    assert "frontend-build" in result.stdout
    assert "browser-journeys" not in result.stdout
    assert not (tmp_path / "out").exists()


# These Git/launcher tests stay in the database-free runner suite, including
# the existing Windows CI job. Every remote below is a disposable local repo.
@pytest.fixture
def go_repository(tmp_path):
    import subprocess

    remote = tmp_path / "origin.git"
    seed = tmp_path / "seed"
    checkout = tmp_path / "checkout"

    def git(folder, *args, env=None, check=True):
        return subprocess.run(
            ["git", "-C", str(folder), *args],
            text=True,
            capture_output=True,
            check=check,
            env=env,
        )

    subprocess.run(["git", "init", "--bare", str(remote)], check=True, capture_output=True)
    subprocess.run(["git", "init", "-b", "main", str(seed)], check=True, capture_output=True)
    git(seed, "config", "user.name", "Launcher test")
    git(seed, "config", "user.email", "launcher@example.invalid")
    (seed / "update-local.ps1").write_text("# fixture startup\n")
    (seed / "tracked.txt").write_text("original\n")
    git(seed, "add", ".")
    dates = {
        **os.environ,
        "GIT_AUTHOR_DATE": "2001-01-01T00:00:00Z",
        "GIT_COMMITTER_DATE": "2001-01-01T00:00:00Z",
    }
    git(seed, "commit", "-m", "initial", env=dates)
    git(seed, "remote", "add", "origin", str(remote))
    git(seed, "push", "origin", "main")
    subprocess.run(
        ["git", "clone", "--single-branch", "--branch", "main", str(remote), str(checkout)],
        check=True,
        capture_output=True,
    )
    git(checkout, "config", "user.name", "Launcher test")
    git(checkout, "config", "user.email", "launcher@example.invalid")

    def publish(branch="newest/review", date="2002-01-01T00:00:00Z"):
        git(seed, "switch", "-C", branch)
        (seed / "tracked.txt").write_text(branch + "\n")
        git(seed, "add", ".")
        git(
            seed,
            "commit",
            "--allow-empty",
            "-m",
            branch,
            env={
                **os.environ,
                "GIT_AUTHOR_DATE": date,
                "GIT_COMMITTER_DATE": date,
            },
        )
        git(seed, "push", "origin", branch)
        return git(seed, "rev-parse", "HEAD").stdout.strip()

    return checkout, seed, remote, git, publish


def run_go_update(checkout, *args):
    import subprocess

    helper = Path(__file__).resolve().parents[1] / "scripts" / "update_checkout.py"
    return subprocess.run(
        [sys.executable, str(helper), "--repo", str(checkout), *args],
        text=True,
        capture_output=True,
        timeout=30,
    )


def test_go_selects_newest_tip_even_from_single_branch_clone(go_repository):
    import json

    checkout, _, _, git, publish = go_repository
    expected = publish()
    result = run_go_update(checkout)
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == {"branch": "newest/review", "commit": expected}
    assert git(checkout, "rev-parse", "HEAD").stdout.strip() == expected


def test_go_fetches_fresh_commits_on_each_run(go_repository):
    import json

    checkout, _, _, git, publish = go_repository
    publish()
    assert run_go_update(checkout).returncode == 0
    expected = publish(date="2003-01-01T00:00:00Z")
    result = run_go_update(checkout)
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout)["commit"] == expected
    assert git(checkout, "rev-parse", "HEAD").stdout.strip() == expected


def test_go_explicit_branch_overrides_newest_policy(go_repository):
    import json

    checkout, _, _, git, publish = go_repository
    original = git(checkout, "rev-parse", "HEAD").stdout.strip()
    publish()
    result = run_go_update(checkout, "--branch", "main")
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == {"branch": "main", "commit": original}


@pytest.mark.parametrize("untracked", [False, True])
def test_go_preserves_dirty_work_and_refuses_to_launch(go_repository, untracked):
    checkout, _, _, git, publish = go_repository
    publish()
    before = git(checkout, "rev-parse", "HEAD").stdout
    edited = checkout / ("notes.txt" if untracked else "tracked.txt")
    edited.write_text("my unsaved work\n")
    result = run_go_update(checkout)
    assert result.returncode != 0
    assert "uncommitted" in result.stderr.lower()
    assert edited.read_text() == "my unsaved work\n"
    assert git(checkout, "rev-parse", "HEAD").stdout == before


def test_go_preserves_local_commits_instead_of_running_ahead_of_remote(go_repository):
    checkout, _, _, git, _ = go_repository
    (checkout / "tracked.txt").write_text("local commit\n")
    git(checkout, "add", ".")
    git(checkout, "commit", "-m", "local only")
    before = git(checkout, "rev-parse", "HEAD").stdout
    result = run_go_update(checkout, "--branch", "main")
    assert result.returncode != 0
    assert "local commits" in result.stderr.lower()
    assert git(checkout, "rev-parse", "HEAD").stdout == before


def test_go_does_not_use_stale_refs_when_fetch_fails(go_repository):
    checkout, _, _, git, publish = go_repository
    publish()
    git(checkout, "remote", "set-url", "origin", str(checkout / "missing.git"))
    before = git(checkout, "rev-parse", "HEAD").stdout
    result = run_go_update(checkout)
    assert result.returncode != 0
    assert "fetch" in result.stderr.lower()
    assert git(checkout, "rev-parse", "HEAD").stdout == before


def test_go_equal_commit_dates_keep_current_branch(go_repository):
    import json

    checkout, seed, _, git, _ = go_repository
    git(seed, "branch", "also-current")
    git(seed, "push", "origin", "also-current")
    result = run_go_update(checkout)
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout)["branch"] == "main"


def test_go_missing_explicit_branch_stops(go_repository):
    checkout, _, _, git, _ = go_repository
    before = git(checkout, "rev-parse", "HEAD").stdout
    result = run_go_update(checkout, "--branch", "missing")
    assert result.returncode != 0
    assert "not found" in result.stderr.lower()
    assert git(checkout, "rev-parse", "HEAD").stdout == before


@pytest.mark.skipif(
    sys.platform != "win32", reason="PowerShell launcher integration runs on Windows"
)
@pytest.mark.parametrize("legacy_kind", ["missing", "old"])
def test_go_bootstrap_survives_checkout_with_older_launcher_files(
    go_repository, tmp_path, legacy_kind
):
    import shutil
    import subprocess

    checkout, seed, _, git, _ = go_repository
    source_root = Path(__file__).resolve().parents[1]
    for relative in ("go.ps1", "install-go.ps1", "scripts/update_checkout.py"):
        target = seed / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source_root / relative, target)
    # Stub only server/dependency startup. Exercise the real installer, Git
    # selector and persistent PowerShell launcher with a disposable profile.
    (seed / "update-local.ps1").write_text(
        "param($FrontendPort,$BackendPort,$Branch,[switch]$NoBrowser,"
        "[switch]$SkipDependencies,[switch]$SkipMigrations,[switch]$AfterGitUpdate)\n"
        "if (-not $AfterGitUpdate) { throw 'checkout was not updated first' }\n"
        "Add-Content -LiteralPath $env:HS_START_LOG -Value $Branch\n"
        "Set-Content -LiteralPath $PROFILE.CurrentUserAllHosts -Value '# old branch shim'\n"
        "if (Test-Path (Join-Path $PSScriptRoot 'install-go.ps1')) { "
        "& (Join-Path $PSScriptRoot 'install-go.ps1') -Quiet }\n"
    )
    git(seed, "add", ".")
    git(
        seed,
        "commit",
        "-m",
        "installable launcher",
        env={
            **os.environ,
            "GIT_AUTHOR_DATE": "2001-02-01T00:00:00Z",
            "GIT_COMMITTER_DATE": "2001-02-01T00:00:00Z",
        },
    )
    git(seed, "push", "origin", "main")
    git(checkout, "pull", "--ff-only")
    git(seed, "switch", "-c", "legacy/newest")
    if legacy_kind == "missing":
        git(seed, "rm", "go.ps1", "install-go.ps1", "scripts/update_checkout.py")
    else:
        git(seed, "rm", "scripts/update_checkout.py")
        (seed / "go.ps1").write_text("throw 'Old branch-locked launcher must not run'\n")
        (seed / "install-go.ps1").write_text(
            "param([switch]$Quiet)\n"
            "$global:HyperSyncGoScript = Join-Path $PSScriptRoot 'go.ps1'\n"
            "function global:go { & $global:HyperSyncGoScript @args }\n"
            "Set-Content -LiteralPath $PROFILE.CurrentUserAllHosts -Value '# legacy profile'\n"
        )
        git(seed, "add", ".")
    git(
        seed,
        "commit",
        "-m",
        "branch predating launcher",
        env={
            **os.environ,
            "GIT_AUTHOR_DATE": "2002-01-01T00:00:00Z",
            "GIT_COMMITTER_DATE": "2002-01-01T00:00:00Z",
        },
    )
    git(seed, "push", "origin", "legacy/newest")
    appdata = tmp_path / "appdata"
    profile = tmp_path / "profile.ps1"
    started = tmp_path / "started.txt"

    def literal(path):
        return "'" + str(path).replace("'", "''") + "'"

    wrapper = tmp_path / "exercise.ps1"
    wrapper.write_text(
        "$ErrorActionPreference = 'Stop'\n"
        f"$PROFILE = {literal(profile)}\n"
        "$PROFILE = $PROFILE | Add-Member -NotePropertyName CurrentUserAllHosts "
        "-NotePropertyValue $PROFILE -PassThru -Force\n"
        f"$env:LOCALAPPDATA = {literal(appdata)}\n"
        f"$env:HS_START_LOG = {literal(started)}\n"
        "$savedUserPath = [Environment]::GetEnvironmentVariable('Path', 'User')\n"
        "try {\n"
        f"  & {literal(checkout / 'go.ps1')} -NoBrowser -SkipDependencies -SkipMigrations\n"
        "  go -NoBrowser -SkipDependencies -SkipMigrations\n"
        "} finally {\n"
        "  [Environment]::SetEnvironmentVariable('Path', $savedUserPath, 'User')\n"
        "}\n"
    )
    shell = shutil.which("powershell") or shutil.which("pwsh")
    assert shell is not None
    result = subprocess.run(
        [shell, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(wrapper)],
        text=True,
        capture_output=True,
        timeout=90,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert started.read_text().splitlines() == ["legacy/newest", "legacy/newest"]
    assert "RepositoryRoot" in profile.read_text(encoding="utf-8-sig")
    assert (appdata / "HyperSync/bin/scripts/update_checkout.py").is_file()
    assert (checkout / "go.ps1").exists() == (legacy_kind == "old")
