import shutil
import sys
from pathlib import Path


def base_checks(root: Path, suite: str) -> list[tuple[str, list[str], Path, int]]:
    py = sys.executable
    npm = shutil.which("npm.cmd" if sys.platform == "win32" else "npm") or "npm"
    checks = [
        (
            "backend-tests",
            [py, "-m", "pytest", "-p", "scripts.verification.pytest_plugin", "-q"],
            root,
            600,
        ),
        (
            "python-lint",
            [py, "-m", "ruff", "check", "backend", "bot", "scripts", "tests"],
            root,
            120,
        ),
        ("python-types", [py, "-m", "pyright"], root, 180),
        ("frontend-tests", [npm, "run", "test:offline"], root / "frontend", 180),
        ("frontend-build", [npm, "run", "build"], root / "frontend", 180),
    ]
    if suite == "full":
        checks += [
            ("python-audit", [py, "-m", "pip_audit", "-r", "requirements.backend.txt"], root, 300),
            (
                "python-security",
                [py, "-m", "bandit", "-q", "-r", "backend", "bot", "-ll"],
                root,
                180,
            ),
            (
                "frontend-audit",
                [npm, "audit", "--omit=dev", "--audit-level=high"],
                root / "frontend",
                180,
            ),
            (
                "backend-image",
                [
                    "docker",
                    "build",
                    "-f",
                    "Dockerfile.backend",
                    "-t",
                    "hypersynced-verification",
                    ".",
                ],
                root,
                900,
            ),
        ]
    return checks
