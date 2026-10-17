"""Fetch origin and select an exact remote branch tip without discarding local work.

The installed go launcher keeps its own copy outside the checkout so switching
onto a branch with older launcher files cannot silently restore branch pinning.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


class UpdateError(RuntimeError):
    pass


def git(repo: Path, *arguments: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(repo), *arguments],
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        check=False,
    )
    if result.returncode:
        raise UpdateError(f"Git {arguments[0]} failed: {result.stderr.strip()}")
    return result.stdout.strip()


def update_checkout(repo: Path, branch: str = "") -> dict[str, str]:
    repo = repo.resolve()
    if Path(git(repo, "rev-parse", "--show-toplevel")).resolve() != repo:
        raise UpdateError("The launcher must point to the repository root.")
    if git(repo, "status", "--porcelain", "--untracked-files=all"):
        raise UpdateError(
            "Uncommitted changes are present. Commit or stash them, then run go again; "
            "nothing was discarded."
        )

    # An explicit refspec also updates clones originally restricted to one branch.
    git(repo, "remote", "set-branches", "origin", "*")
    git(repo, "fetch", "--prune", "origin", "+refs/heads/*:refs/remotes/origin/*")
    current = git(repo, "branch", "--show-current")
    refs = git(
        repo,
        "for-each-ref",
        "--format=%(refname)%09%(objectname)%09%(committerdate:unix)%09%(symref)",
        "refs/remotes/origin/",
    )
    candidates = []
    for line in refs.splitlines():
        ref, commit, timestamp, *symbolic = line.split("\t")
        if symbolic and symbolic[0]:
            continue
        name = ref.removeprefix("refs/remotes/origin/")
        candidates.append((name, commit, int(timestamp)))
    if not candidates:
        raise UpdateError("No remote branches were found on origin.")

    branch = branch.strip()
    if branch:
        git(repo, "check-ref-format", "--branch", branch)
        selected = next((item for item in candidates if item[0] == branch), None)
        if selected is None:
            raise UpdateError(f"Branch {branch!r} was not found on origin.")
    else:
        # Prefer the current branch on equal dates, then sort names for stable ties.
        selected = min(candidates, key=lambda item: (-item[2], item[0] != current, item[0]))
    branch, target, _ = selected

    # A non-app branch should never replace the checkout and then fail startup.
    git(repo, "cat-file", "-e", f"{target}:update-local.ps1")
    local = subprocess.run(
        ["git", "-C", str(repo), "show-ref", "--verify", "--hash", f"refs/heads/{branch}"],
        text=True,
        capture_output=True,
        check=False,
    )
    if local.returncode == 0:
        ancestor = subprocess.run(
            ["git", "-C", str(repo), "merge-base", "--is-ancestor", local.stdout.strip(), target],
            capture_output=True,
            check=False,
        )
        if ancestor.returncode != 0:
            raise UpdateError(
                f"Branch {branch!r} has local commits absent from origin, or its history "
                "has diverged. Reconcile it before running go; nothing was discarded."
            )
        git(repo, "switch", "--no-guess", branch)
        git(repo, "merge", "--ff-only", target)
    else:
        git(repo, "switch", "--track", "-c", branch, f"origin/{branch}")
    actual = git(repo, "rev-parse", "HEAD")
    if actual != target:
        raise UpdateError("Checkout did not reach the fetched remote commit; startup refused.")
    if git(repo, "status", "--porcelain", "--untracked-files=all"):
        raise UpdateError("Checkout hooks changed files; startup refused until the tree is clean.")
    return {"branch": branch, "commit": actual}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--branch", default="")
    args = parser.parse_args()
    try:
        print(json.dumps(update_checkout(args.repo, args.branch)))
    except (UpdateError, OSError, ValueError) as error:
        print(f"HyperSync update stopped: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
