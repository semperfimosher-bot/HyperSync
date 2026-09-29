from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

if str(REPO_ROOT) not in sys.path:
    sys.path.insert(
        0,
        str(REPO_ROOT),
    )

from backend.app.config import get_settings  # noqa: E402  # repo root is added above


def main() -> None:
    settings = get_settings()

    database_url = settings.database_url.strip()
    database_kind = (
        "none"
        if not database_url
        else (
            "sqlite"
            if database_url.startswith("sqlite")
            else "remote"
        )
    )

    database_mode = (
        "local SQLite"
        if database_kind in {"none", "sqlite"}
        else "remote PostgreSQL"
    )

    b2_ready = all(
        value.strip()
        for value in (
            settings.b2_endpoint,
            settings.b2_key_id,
            settings.b2_application_key,
            settings.b2_bucket_name,
        )
    )

    cookies_path = settings.yt_dlp_cookies_file.strip()
    cookies_ready = bool(
        cookies_path
        and Path(cookies_path).expanduser().is_file()
    )

    admin_ready = bool(
        settings.admin_account_creation_password.strip()
    )

    print(f"database_kind={database_kind}")
    print(f"database={database_mode}")
    print("b2=" + ("ready" if b2_ready else "missing"))
    print(
        "cookies="
        + (
            "ready"
            if cookies_ready
            else (
                "configured-but-missing"
                if cookies_path
                else "optional-not-set"
            )
        )
    )
    print("admin=" + ("ready" if admin_ready else "not-set"))


if __name__ == "__main__":
    main()
