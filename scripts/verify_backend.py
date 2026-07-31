from __future__ import annotations

import ast
import configparser
import json
import re
import subprocess
import sys
import tomllib
from collections import Counter
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Any
from uuid import uuid4

from backend.app.config import get_settings
from backend.app.main import app
from backend.app.models import Base
from backend.app.security.passwords import hash_password, verify_password
from backend.app.security.tokens import (
    InvalidAccessTokenError,
    create_access_token,
    create_refresh_token,
    decode_access_token,
    hash_refresh_token,
)

PROJECT_ROOT = Path(__file__).resolve().parents[1]

REQUIRED_FILES = {
    ".dockerignore",
    ".env.example",
    ".gitattributes",
    ".gitignore",
    "Dockerfile.backend",
    "README.md",
    "alembic.ini",
    "pyproject.toml",
    "pyrightconfig.json",
    "requirements.backend.txt",
    "requirements.dev.txt",
    "backend/__init__.py",
    "backend/app/__init__.py",
    "backend/app/main.py",
    "backend/app/config.py",
    "backend/app/database.py",
    "backend/app/api/__init__.py",
    "backend/app/api/router.py",
    "backend/app/api/routes/health.py",
    "backend/app/models/__init__.py",
    "backend/app/models/base.py",
    "backend/app/models/account.py",
    "backend/app/security/__init__.py",
    "backend/app/security/passwords.py",
    "backend/app/security/tokens.py",
    "bot/__init__.py",
    "migrations/env.py",
    "migrations/script.py.mako",
    "scripts/__init__.py",
    "scripts/check_schema.py",
    "scripts/verify_backend.py",
    "scripts/verify-project.ps1",
    "tests/test_health.py",
    "tests/test_models.py",
    "tests/test_passwords.py",
    "tests/test_tokens.py",
    "frontend/Dockerfile",
    "frontend/index.html",
    "frontend/nginx.conf",
    "frontend/package.json",
    "frontend/package-lock.json",
    "frontend/vite.config.js",
    "frontend/src/App.jsx",
    "frontend/src/main.jsx",
    "frontend/src/styles.css",
}

REQUIRED_RUNTIME_PACKAGES = {
    "alembic",
    "asyncpg",
    "email_validator",
    "fastapi",
    "httpx",
    "jwt",
    "pwdlib",
    "pydantic_settings",
    "sqlalchemy",
    "uvicorn",
}

REQUIRED_DEV_PACKAGES = {
    "bandit",
    "pip_audit",
    "pyright",
    "pytest",
    "pytest_asyncio",
    "ruff",
}

EXPECTED_TABLES = {
    "users",
    "user_profiles",
    "user_sessions",
}

EXPECTED_USER_COLUMNS = {
    "id",
    "account_type",
    "email",
    "username",
    "username_normalized",
    "password_hash",
    "role",
    "is_active",
    "is_email_verified",
    "last_login_at",
    "created_at",
    "updated_at",
}

EXPECTED_SESSION_COLUMNS = {
    "id",
    "user_id",
    "family_id",
    "refresh_token_hash",
    "expires_at",
    "last_used_at",
    "revoked_at",
    "revoke_reason",
    "user_agent",
    "ip_address",
    "created_at",
    "updated_at",
}

REQUIRED_ENVIRONMENT_KEYS = {
    "APP_NAME",
    "APP_VERSION",
    "ENVIRONMENT",
    "BACKEND_HOST",
    "BACKEND_PORT",
    "FRONTEND_ORIGINS",
    "DATABASE_URL",
    "MIGRATION_DATABASE_URL",
    "JWT_SECRET",
    "JWT_ALGORITHM",
    "JWT_ISSUER",
    "JWT_AUDIENCE",
    "ACCESS_TOKEN_TTL_MINUTES",
    "REFRESH_TOKEN_TTL_DAYS",
}

REQUIRED_BACKEND_REQUIREMENTS = {
    "alembic",
    "asyncpg",
    "email-validator",
    "fastapi",
    "httpx",
    "pwdlib",
    "pyjwt",
    "pydantic-settings",
    "sqlalchemy",
    "uvicorn",
}

REQUIRED_DEV_REQUIREMENTS = {
    "bandit",
    "pip-audit",
    "pyright",
    "pytest",
    "pytest-asyncio",
    "ruff",
}

TEXT_EXTENSIONS = {
    ".cfg",
    ".conf",
    ".css",
    ".html",
    ".ini",
    ".js",
    ".jsx",
    ".json",
    ".md",
    ".mako",
    ".ps1",
    ".py",
    ".toml",
    ".txt",
    ".yaml",
    ".yml",
}

TEXT_FILENAMES = {
    ".dockerignore",
    ".env.example",
    ".gitattributes",
    ".gitignore",
}

LF_EXTENSIONS = {
    ".conf",
    ".css",
    ".html",
    ".js",
    ".jsx",
    ".json",
    ".md",
    ".mako",
    ".py",
    ".toml",
    ".txt",
    ".yaml",
    ".yml",
}

CRLF_EXTENSIONS = {
    ".bat",
    ".cmd",
    ".ps1",
}

VALID_DOCKER_INSTRUCTIONS = {
    "ADD",
    "ARG",
    "CMD",
    "COPY",
    "ENTRYPOINT",
    "ENV",
    "EXPOSE",
    "FROM",
    "HEALTHCHECK",
    "LABEL",
    "MAINTAINER",
    "ONBUILD",
    "RUN",
    "SHELL",
    "STOPSIGNAL",
    "USER",
    "VOLUME",
    "WORKDIR",
}

MAX_REPOSITORY_FILE_BYTES = 10 * 1024 * 1024


class VerificationFailure(RuntimeError):
    """Raised when a project invariant is not satisfied."""


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise VerificationFailure(message)


def _relative(path: Path) -> str:
    return path.relative_to(PROJECT_ROOT).as_posix()


def _git_project_files() -> list[Path]:
    completed = subprocess.run(
        [
            "git",
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "-z",
        ],
        cwd=PROJECT_ROOT,
        check=True,
        capture_output=True,
    )

    paths: list[Path] = []
    for raw_path in completed.stdout.split(b"\0"):
        if not raw_path:
            continue

        relative_path = raw_path.decode("utf-8")
        path = PROJECT_ROOT / relative_path
        if path.is_file():
            paths.append(path)

    return paths


def _text_project_files() -> list[Path]:
    files: list[Path] = []

    for path in _git_project_files():
        if (
            path.suffix.lower() in TEXT_EXTENSIONS
            or path.name in TEXT_FILENAMES
            or path.name.startswith("Dockerfile")
            or path.name.startswith("requirements.")
        ):
            files.append(path)

    return files


def _read_utf8(path: Path) -> str:
    data = path.read_bytes()

    _require(
        not data.startswith(b"\xef\xbb\xbf"),
        f"{_relative(path)} contains a UTF-8 byte-order mark.",
    )

    try:
        return data.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise VerificationFailure(f"{_relative(path)} is not valid UTF-8: {exc}") from exc


def _require_lf(path: Path, data: bytes) -> None:
    _require(
        b"\r" not in data,
        f"{_relative(path)} must use LF line endings.",
    )


def _require_crlf(path: Path, data: bytes) -> None:
    without_crlf = data.replace(b"\r\n", b"")
    _require(
        b"\n" not in without_crlf and b"\r" not in without_crlf,
        f"{_relative(path)} must use CRLF line endings.",
    )


def verify_required_files() -> None:
    missing = sorted(
        relative_path
        for relative_path in REQUIRED_FILES
        if not (PROJECT_ROOT / relative_path).is_file()
    )

    _require(
        not missing,
        "Required files are missing: " + ", ".join(missing),
    )

    misplaced = PROJECT_ROOT / "backend/app/security/verify_backend.py"
    _require(
        not misplaced.exists(),
        "backend/app/security/verify_backend.py is misplaced; keep only scripts/verify_backend.py.",
    )

    misplaced_tests = sorted(
        _relative(path) for path in (PROJECT_ROOT / "backend").rglob("test_*.py")
    )
    _require(
        not misplaced_tests,
        "Tests must live in tests/, not backend/: " + ", ".join(misplaced_tests),
    )


def verify_repository_file_sizes() -> None:
    oversized = [
        f"{_relative(path)} ({path.stat().st_size} bytes)"
        for path in _git_project_files()
        if path.stat().st_size > MAX_REPOSITORY_FILE_BYTES
    ]

    _require(
        not oversized,
        "Repository files larger than 10 MiB were found: " + ", ".join(oversized),
    )


def verify_text_files() -> None:
    failures: list[str] = []

    for path in _text_project_files():
        data = path.read_bytes()

        try:
            text = _read_utf8(path)

            _require(
                b"\0" not in data,
                f"{_relative(path)} contains a NUL byte.",
            )

            if data:
                _require(
                    data.endswith((b"\n", b"\r\n")),
                    f"{_relative(path)} must end with a newline.",
                )

            trailing_lines = [
                str(index)
                for index, line in enumerate(text.splitlines(), start=1)
                if line.endswith((" ", "\t"))
            ]
            _require(
                not trailing_lines,
                f"{_relative(path)} has trailing whitespace on lines: "
                + ", ".join(trailing_lines[:20]),
            )

            suffix = path.suffix.lower()
            if suffix in CRLF_EXTENSIONS:
                _require_crlf(path, data)
            elif (
                suffix in LF_EXTENSIONS
                or path.name == ".env.example"
                or path.name.startswith("Dockerfile")
            ):
                _require_lf(path, data)
        except VerificationFailure as exc:
            failures.append(str(exc))

    _require(
        not failures,
        "Text-file integrity errors:\n- " + "\n- ".join(failures),
    )


def verify_serialized_files() -> None:
    json_files = [
        PROJECT_ROOT / "pyrightconfig.json",
        PROJECT_ROOT / "frontend/package.json",
        PROJECT_ROOT / "frontend/package-lock.json",
    ]

    for path in json_files:
        try:
            json.loads(_read_utf8(path))
        except json.JSONDecodeError as exc:
            raise VerificationFailure(f"{_relative(path)} is invalid JSON: {exc}") from exc

    try:
        tomllib.loads(_read_utf8(PROJECT_ROOT / "pyproject.toml"))
    except tomllib.TOMLDecodeError as exc:
        raise VerificationFailure(f"pyproject.toml is invalid TOML: {exc}") from exc

    parser = configparser.RawConfigParser(strict=True)
    try:
        parser.read_string(_read_utf8(PROJECT_ROOT / "alembic.ini"))
    except configparser.Error as exc:
        raise VerificationFailure(f"alembic.ini is invalid: {exc}") from exc

    _require(
        parser.sections().count("post_write_hooks") == 1,
        "alembic.ini must contain exactly one [post_write_hooks] section.",
    )


def verify_python_syntax() -> None:
    failures: list[str] = []

    for path in _git_project_files():
        if path.suffix.lower() != ".py":
            continue

        try:
            ast.parse(_read_utf8(path), filename=_relative(path))
        except SyntaxError as exc:
            failures.append(f"{_relative(path)}:{exc.lineno}: {exc.msg}")

    _require(
        not failures,
        "Python syntax errors:\n- " + "\n- ".join(failures),
    )


def _normalized_requirement_name(requirement: str) -> str:
    package_part = requirement.split("==", maxsplit=1)[0].strip()
    package_part = package_part.split("[", maxsplit=1)[0]
    return package_part.lower().replace("_", "-")


def _parse_requirements(path: Path) -> tuple[set[str], list[str]]:
    package_names: list[str] = []
    included_files: list[str] = []

    for line_number, raw_line in enumerate(_read_utf8(path).splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue

        if line.startswith("-r "):
            included_files.append(line.removeprefix("-r ").strip())
            continue

        _require(
            "==" in line,
            f"{_relative(path)}:{line_number} must pin the package with ==.",
        )
        _require(
            not any(marker in line for marker in (";", " @ ", "git+", "http://", "https://")),
            f"{_relative(path)}:{line_number} uses an unsupported requirement form.",
        )
        package_names.append(_normalized_requirement_name(line))

    duplicates = sorted(
        package_name for package_name, count in Counter(package_names).items() if count > 1
    )
    _require(
        not duplicates,
        f"{_relative(path)} contains duplicate packages: " + ", ".join(duplicates),
    )

    return set(package_names), included_files


def verify_requirements() -> None:
    backend_packages, backend_includes = _parse_requirements(
        PROJECT_ROOT / "requirements.backend.txt"
    )
    dev_packages, dev_includes = _parse_requirements(PROJECT_ROOT / "requirements.dev.txt")

    _require(
        not backend_includes,
        "requirements.backend.txt must not include another requirements file.",
    )
    _require(
        REQUIRED_BACKEND_REQUIREMENTS.issubset(backend_packages),
        "requirements.backend.txt is missing: "
        + ", ".join(sorted(REQUIRED_BACKEND_REQUIREMENTS - backend_packages)),
    )
    _require(
        "requirements.backend.txt" in dev_includes,
        "requirements.dev.txt must include requirements.backend.txt.",
    )
    _require(
        REQUIRED_DEV_REQUIREMENTS.issubset(dev_packages),
        "requirements.dev.txt is missing: "
        + ", ".join(sorted(REQUIRED_DEV_REQUIREMENTS - dev_packages)),
    )


def _parse_env_example() -> dict[str, str]:
    values: dict[str, str] = {}
    duplicates: list[str] = []

    for line_number, raw_line in enumerate(
        _read_utf8(PROJECT_ROOT / ".env.example").splitlines(),
        start=1,
    ):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue

        _require(
            "=" in line,
            f".env.example:{line_number} must use KEY=VALUE syntax.",
        )
        key, value = line.split("=", maxsplit=1)
        key = key.strip()

        _require(
            re.fullmatch(r"[A-Z][A-Z0-9_]*", key) is not None,
            f".env.example:{line_number} contains an invalid key: {key!r}.",
        )

        if key in values:
            duplicates.append(key)
        values[key] = value.strip()

    _require(
        not duplicates,
        ".env.example contains duplicate keys: " + ", ".join(sorted(set(duplicates))),
    )
    return values


def verify_environment_example() -> None:
    values = _parse_env_example()
    missing = REQUIRED_ENVIRONMENT_KEYS - values.keys()

    _require(
        not missing,
        ".env.example is missing: " + ", ".join(sorted(missing)),
    )
    _require(values["JWT_ALGORITHM"] == "HS256", "JWT_ALGORITHM must default to HS256.")
    _require(bool(values["JWT_ISSUER"]), "JWT_ISSUER must not be empty.")
    _require(bool(values["JWT_AUDIENCE"]), "JWT_AUDIENCE must not be empty.")
    _require(
        any(
            marker in values["JWT_SECRET"].lower()
            for marker in ("replace", "example", "placeholder", "change")
        ),
        ".env.example must contain a placeholder JWT secret, never a real secret.",
    )


def verify_configuration_files() -> None:
    pyproject = tomllib.loads(_read_utf8(PROJECT_ROOT / "pyproject.toml"))
    pytest_options = pyproject.get("tool", {}).get("pytest", {}).get("ini_options", {})
    ruff_options = pyproject.get("tool", {}).get("ruff", {})

    _require(
        pytest_options.get("testpaths") == ["tests"],
        "pyproject.toml must configure pytest testpaths = ['tests'].",
    )
    filter_warnings = pytest_options.get("filterwarnings", [])
    _require(
        "error" in filter_warnings,
        "pyproject.toml must make Python warnings fail with filterwarnings = ['error'].",
    )
    _require(
        ruff_options.get("target-version") == "py313",
        "Ruff must target Python 3.13.",
    )

    pyright = json.loads(_read_utf8(PROJECT_ROOT / "pyrightconfig.json"))
    included_roots = set(pyright.get("include", []))
    _require(
        {"backend", "bot", "migrations", "scripts", "tests"}.issubset(included_roots),
        "pyrightconfig.json must include backend, bot, migrations, scripts, and tests.",
    )
    _require(
        pyright.get("typeCheckingMode") in {"basic", "standard", "strict"},
        "pyrightconfig.json must set typeCheckingMode.",
    )

    package = json.loads(_read_utf8(PROJECT_ROOT / "frontend/package.json"))
    scripts = package.get("scripts", {})
    _require(scripts.get("build") == "vite build", "Frontend build script must run vite build.")

    for section_name in ("dependencies", "devDependencies"):
        dependencies = package.get(section_name, {})
        for dependency_name, version in dependencies.items():
            _require(
                isinstance(version, str)
                and re.fullmatch(r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?", version) is not None,
                f"frontend/package.json must exactly pin {dependency_name}; found {version!r}.",
            )

    lockfile = json.loads(_read_utf8(PROJECT_ROOT / "frontend/package-lock.json"))
    _require(
        int(lockfile.get("lockfileVersion", 0)) >= 3,
        "frontend/package-lock.json must use lockfileVersion 3 or newer.",
    )


def _docker_logical_lines(path: Path) -> list[tuple[int, str]]:
    lines: list[tuple[int, str]] = []
    continuation = ""
    continuation_start = 0

    for line_number, raw_line in enumerate(_read_utf8(path).splitlines(), start=1):
        stripped = raw_line.strip()
        if not stripped or stripped.startswith("#"):
            continue

        if continuation:
            stripped = f"{continuation} {stripped}"
        else:
            continuation_start = line_number

        if stripped.endswith("\\"):
            continuation = stripped[:-1].rstrip()
            continue

        lines.append((continuation_start, stripped))
        continuation = ""

    _require(
        not continuation,
        f"{_relative(path)} ends with an unfinished line continuation.",
    )
    return lines


def verify_dockerfile(path: Path) -> None:
    logical_lines = _docker_logical_lines(path)
    commands: list[tuple[int, str, str]] = []

    for line_number, line in logical_lines:
        match = re.match(
            r"^([A-Za-z]+)\s+(.+)$",
            line,
        )

        if match is None:
            raise VerificationFailure(
                f"{_relative(path)}:{line_number} is not a valid Docker instruction: {line!r}."
            )

        instruction = match.group(1).upper()
        arguments = match.group(2).strip()

        _require(
            instruction in VALID_DOCKER_INSTRUCTIONS,
            f"{_relative(path)}:{line_number} has unknown instruction {instruction!r}.",
        )

        commands.append(
            (
                line_number,
                instruction,
                arguments,
            )
        )

        if instruction in {"CMD", "ENTRYPOINT"} and arguments.startswith("["):
            try:
                parsed = json.loads(arguments)
            except json.JSONDecodeError as exc:
                raise VerificationFailure(
                    f"{_relative(path)}:{line_number} has invalid JSON-form {instruction}: {exc}"
                ) from exc

            _require(
                isinstance(parsed, list)
                and bool(parsed)
                and all(isinstance(item, str) for item in parsed),
                f"{_relative(path)}:{line_number} "
                f"{instruction} must be a nonempty "
                "JSON string array.",
            )

    _require(
        any(instruction == "FROM" for _, instruction, _ in commands),
        f"{_relative(path)} must contain FROM.",
    )

    _require(
        any(instruction == "CMD" for _, instruction, _ in commands),
        f"{_relative(path)} must contain CMD.",
    )


def verify_dockerfiles() -> None:
    backend_path = PROJECT_ROOT / "Dockerfile.backend"
    frontend_path = PROJECT_ROOT / "frontend/Dockerfile"

    verify_dockerfile(backend_path)
    verify_dockerfile(frontend_path)

    backend_text = _read_utf8(backend_path)
    _require("FROM python:3.13-slim" in backend_text, "Backend Docker image must use Python 3.13.")
    _require("EXPOSE 8000" in backend_text, "Backend Dockerfile must expose port 8000.")
    _require(
        "exec python -m uvicorn backend.app.main:app" in backend_text,
        "Backend Docker CMD must exec Uvicorn.",
    )
    _require(
        "${PORT:-8000}" in backend_text,
        "Backend Docker CMD must support Northflank's PORT variable.",
    )

    frontend_text = _read_utf8(frontend_path)
    _require("npm ci" in frontend_text, "Frontend Dockerfile must use npm ci.")
    _require("npm run build" in frontend_text, "Frontend Dockerfile must build the Vite app.")
    _require("EXPOSE 80" in frontend_text, "Frontend Dockerfile must expose port 80.")


def verify_python_version() -> None:
    _require(
        sys.version_info[:2] == (3, 13),
        "Verification must run with Python 3.13 to match Docker and Ruff.",
    )


def verify_required_packages() -> None:
    from importlib import import_module

    for package_name in sorted(REQUIRED_RUNTIME_PACKAGES | REQUIRED_DEV_PACKAGES):
        try:
            import_module(package_name)
        except ImportError as exc:
            raise VerificationFailure(
                f"Required package cannot be imported: {package_name}"
            ) from exc


def verify_settings() -> None:
    settings = get_settings()

    for attribute_name in (
        "jwt_secret",
        "jwt_algorithm",
        "jwt_issuer",
        "jwt_audience",
        "access_token_ttl_minutes",
        "refresh_token_ttl_days",
    ):
        _require(
            hasattr(settings, attribute_name),
            f"Settings is missing {attribute_name!r}.",
        )

    _require(
        settings.jwt_algorithm in {"HS256", "HS384", "HS512"},
        "JWT_ALGORITHM must use an approved HMAC algorithm.",
    )
    _require(bool(settings.jwt_issuer.strip()), "JWT_ISSUER must not be empty.")
    _require(bool(settings.jwt_audience.strip()), "JWT_AUDIENCE must not be empty.")
    _require(settings.access_token_ttl_minutes > 0, "Access-token TTL must be positive.")
    _require(settings.refresh_token_ttl_days > 0, "Refresh-token TTL must be positive.")

    secret_lower = settings.jwt_secret.lower()
    _require(len(settings.jwt_secret) >= 32, "JWT_SECRET must contain at least 32 characters.")
    _require(
        not any(
            marker in secret_lower
            for marker in ("replace", "placeholder", "change-me", "example-secret")
        ),
        "JWT_SECRET still looks like a placeholder.",
    )

    if settings.bot_jwt_secret:
        _require(
            len(settings.bot_jwt_secret) >= 32,
            "BOT_JWT_SECRET must contain at least 32 characters when configured.",
        )
        _require(
            settings.bot_jwt_secret != settings.jwt_secret,
            "BOT_JWT_SECRET must differ from JWT_SECRET.",
        )

    _require(bool(settings.sqlalchemy_database_url), "DATABASE_URL is not configured.")
    _require(
        settings.sqlalchemy_database_url.startswith("postgresql+asyncpg://"),
        "DATABASE_URL must resolve to postgresql+asyncpg://.",
    )
    _require(
        "sslmode=" not in settings.sqlalchemy_database_url
        and "channel_binding=" not in settings.sqlalchemy_database_url,
        "The asyncpg URL must not contain libpq-only TLS query parameters.",
    )
    _require(bool(settings.sqlalchemy_migration_url), "MIGRATION_DATABASE_URL is not configured.")

    _require(
        "*" not in settings.cors_origins,
        "Wildcard CORS is unsafe while credentials are enabled.",
    )
    if settings.environment == "production":
        _require(
            all(
                "localhost" not in origin and "127.0.0.1" not in origin
                for origin in settings.cors_origins
            ),
            "Production FRONTEND_ORIGINS must not contain localhost.",
        )


def _collect_route_entries(
    routes: object,
) -> list[tuple[str, set[str]]]:
    """Collect routes, including routes inside included routers."""

    if isinstance(routes, (str, bytes)) or not isinstance(routes, Iterable):
        raise VerificationFailure("FastAPI returned a non-iterable route collection.")

    entries: list[tuple[str, set[str]]] = []

    for route in routes:
        candidate_factory = getattr(
            route,
            "effective_candidates",
            None,
        )

        if callable(candidate_factory):
            entries.extend(_collect_route_entries(candidate_factory()))
            continue

        path = getattr(
            route,
            "path",
            None,
        )

        if not isinstance(path, str):
            continue

        raw_methods = getattr(
            route,
            "methods",
            None,
        )

        if isinstance(raw_methods, (str, bytes)) or not isinstance(
            raw_methods,
            Iterable,
        ):
            methods: set[str] = set()
        else:
            methods = {str(method).upper() for method in raw_methods}

        entries.append(
            (
                path,
                methods,
            )
        )

    return entries


def verify_application() -> None:
    _require(
        app.title == "HyperSync API",
        f"Unexpected API title: {app.title!r}",
    )

    openapi_paths = set(
        app.openapi().get(
            "paths",
            {},
        )
    )

    required_paths = {
        "/",
        "/health",
        "/health/live",
        "/health/ready",
    }

    missing_paths = required_paths - openapi_paths

    _require(
        not missing_paths,
        "Required API routes are missing: " + ", ".join(sorted(missing_paths)),
    )

    route_entries = _collect_route_entries(app.routes)

    route_keys: list[tuple[str, str]] = []

    for path, methods in route_entries:
        route_keys.extend(
            (path, method)
            for method in methods
            if method
            not in {
                "HEAD",
                "OPTIONS",
            }
        )

    duplicates = sorted(
        f"{method} {path}" for (path, method), count in Counter(route_keys).items() if count > 1
    )

    _require(
        not duplicates,
        "Duplicate API routes were registered: " + ", ".join(duplicates),
    )


def verify_models() -> None:
    actual_tables = set(Base.metadata.tables)
    missing_tables = EXPECTED_TABLES - actual_tables
    _require(
        not missing_tables,
        "Missing registered model tables: " + ", ".join(sorted(missing_tables)),
    )

    user_columns = set(Base.metadata.tables["users"].columns.keys())
    session_columns = set(Base.metadata.tables["user_sessions"].columns.keys())

    _require(
        EXPECTED_USER_COLUMNS.issubset(user_columns),
        "users is missing columns: " + ", ".join(sorted(EXPECTED_USER_COLUMNS - user_columns)),
    )
    _require(
        EXPECTED_SESSION_COLUMNS.issubset(session_columns),
        "user_sessions is missing columns: "
        + ", ".join(sorted(EXPECTED_SESSION_COLUMNS - session_columns)),
    )
    _require(
        "password" not in user_columns,
        "The users table must never store plaintext passwords.",
    )
    _require(
        "refresh_token" not in session_columns,
        "The sessions table must never store raw refresh tokens.",
    )

    refresh_hash_column = Base.metadata.tables["user_sessions"].columns["refresh_token_hash"]
    _require(
        getattr(refresh_hash_column.type, "length", None) == 64,
        "refresh_token_hash must be exactly 64 characters.",
    )


def verify_security_primitives() -> None:
    password = "HyperSync verifier password 2026"
    password_hash = hash_password(password)
    _require(password_hash != password, "Password hashing returned plaintext.")
    _require(password_hash.startswith("$argon2"), "Passwords must use Argon2.")
    _require(verify_password(password, password_hash), "Correct password verification failed.")
    _require(
        not verify_password("incorrect password", password_hash),
        "Incorrect password was accepted.",
    )

    user_id = uuid4()
    session_id = uuid4()
    token, expires_in = create_access_token(
        user_id=user_id,
        session_id=session_id,
        role="user",
    )
    claims = decode_access_token(token)

    _require(expires_in > 0, "Access-token TTL must be positive.")
    _require(claims.user_id == user_id, "Access token changed the user ID.")
    _require(claims.session_id == session_id, "Access token changed the session ID.")
    _require(claims.role == "user", "Access token changed the role.")

    header, payload, signature = token.split(".")
    replacement = "a" if signature[0] != "a" else "b"
    tampered = f"{header}.{payload}.{replacement}{signature[1:]}"
    try:
        decode_access_token(tampered)
    except InvalidAccessTokenError:
        pass
    else:
        raise VerificationFailure("A tampered access token was accepted.")

    first_refresh_token = create_refresh_token()
    second_refresh_token = create_refresh_token()
    _require(first_refresh_token != second_refresh_token, "Refresh tokens are not random.")
    _require(
        len(hash_refresh_token(first_refresh_token)) == 64,
        "Refresh-token hashes must be SHA-256 hex digests.",
    )
    _require(
        hash_refresh_token(first_refresh_token) != hash_refresh_token(second_refresh_token),
        "Different refresh tokens produced the same hash.",
    )


def _migration_assignment(tree: ast.Module, name: str) -> Any:
    for node in tree.body:
        if isinstance(node, ast.Assign):
            if any(isinstance(target, ast.Name) and target.id == name for target in node.targets):
                return ast.literal_eval(node.value)
        elif isinstance(node, ast.AnnAssign):
            if (
                isinstance(node.target, ast.Name)
                and node.target.id == name
                and node.value is not None
            ):
                return ast.literal_eval(node.value)

    raise VerificationFailure(f"Migration is missing {name!r}.")


def verify_migration_graph() -> None:
    migration_paths = sorted((PROJECT_ROOT / "migrations/versions").glob("*.py"))
    _require(bool(migration_paths), "No Alembic migration files were found.")

    revisions: dict[str, tuple[str, ...]] = {}
    for path in migration_paths:
        tree = ast.parse(_read_utf8(path), filename=_relative(path))
        revision = _migration_assignment(tree, "revision")
        down_revision = _migration_assignment(tree, "down_revision")

        _require(
            isinstance(revision, str) and bool(revision),
            f"{_relative(path)} has an invalid revision.",
        )
        _require(revision not in revisions, f"Duplicate Alembic revision: {revision}.")

        if down_revision is None:
            parents: tuple[str, ...] = ()
        elif isinstance(down_revision, str):
            parents = (down_revision,)
        elif isinstance(down_revision, tuple) and all(
            isinstance(item, str) for item in down_revision
        ):
            parents = down_revision
        else:
            raise VerificationFailure(f"{_relative(path)} has an invalid down_revision.")

        revisions[revision] = parents

    unknown_parents = sorted(
        parent for parents in revisions.values() for parent in parents if parent not in revisions
    )
    _require(
        not unknown_parents,
        "Alembic migrations reference unknown parents: " + ", ".join(unknown_parents),
    )

    parent_revisions = {parent for parents in revisions.values() for parent in parents}
    heads = sorted(set(revisions) - parent_revisions)
    _require(
        len(heads) == 1,
        "Alembic must have exactly one head; found: " + ", ".join(heads),
    )


def main() -> int:
    checks: list[tuple[str, Callable[[], None]]] = [
        ("required files", verify_required_files),
        ("repository file sizes", verify_repository_file_sizes),
        ("text files", verify_text_files),
        ("serialized configuration", verify_serialized_files),
        ("Python syntax", verify_python_syntax),
        ("requirements", verify_requirements),
        ("environment example", verify_environment_example),
        ("configuration compatibility", verify_configuration_files),
        ("Dockerfiles", verify_dockerfiles),
        ("Python version", verify_python_version),
        ("required packages", verify_required_packages),
        ("settings", verify_settings),
        ("FastAPI application", verify_application),
        ("SQLAlchemy models", verify_models),
        ("security primitives", verify_security_primitives),
        ("Alembic migration graph", verify_migration_graph),
    ]

    failures: list[str] = []
    for check_name, check in checks:
        try:
            check()
        except Exception as exc:  # noqa: BLE001 - aggregate all verifier failures.
            failures.append(f"{check_name}: {exc}")

    if failures:
        print(
            "Backend verification found problems:\n- " + "\n- ".join(failures),
            file=sys.stderr,
        )
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
