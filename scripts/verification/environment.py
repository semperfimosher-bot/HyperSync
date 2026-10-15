import asyncio
import hashlib
import json
import os
import shutil
import socket
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

from backend.app.config import Settings

from .postgres_database import (
    create_owned_database,
    database_url_for_owned_database,
    drop_owned_database,
    validate_local_postgres_service,
)

APP_DATABASE_PREFIX = "hs_app"


@dataclass(frozen=True)
class RunEnvironment:
    run_id: str
    root: Path
    database_url: str
    api_port: int
    web_port: int
    manifest_path: Path


def assert_port_available(port: int) -> None:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", port))


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def test_postgres_service_url() -> str:
    value = os.environ.get(
        "HYPERSYNC_TEST_POSTGRES_URL",
        "",
    ).strip()
    if not value:
        raise RuntimeError(
            "HYPERSYNC_TEST_POSTGRES_URL must point to a "
            "disposable local PostgreSQL service."
        )
    return validate_local_postgres_service(value)


def create_environment(run_dir: Path) -> RunEnvironment:
    root = run_dir.resolve()
    root.mkdir(parents=True, exist_ok=False)
    root.chmod(0o700)
    run_id = uuid4().hex
    (root / ".owner").write_text(run_id)

    api_port, web_port = free_port(), free_port()
    while api_port == web_port:
        web_port = free_port()

    service_url = test_postgres_service_url()
    try:
        database_url = asyncio.run(
            create_owned_database(
                service_url,
                run_id,
                APP_DATABASE_PREFIX,
            )
        )
    except BaseException:
        shutil.rmtree(root)
        raise

    return RunEnvironment(
        run_id,
        root,
        database_url,
        api_port,
        web_port,
        root / "manifest.json",
    )


def load_test_settings(
    environment: RunEnvironment,
) -> Settings:
    values = {
        name: field.get_default(
            call_default_factory=True
        )
        for name, field in Settings.model_fields.items()
    }
    origin = (
        f"http://127.0.0.1:{environment.web_port}"
    )
    values.update(
        environment="test",
        database_url=environment.database_url,
        migration_database_url=environment.database_url,
        jwt_secret=hashlib.sha256(
            (
                "verification:"
                + environment.run_id
            ).encode()
        ).hexdigest(),
        frontend_public_url=origin,
        frontend_origins=origin,
        backend_host="127.0.0.1",
        backend_port=environment.api_port,
        local_upload_root=str(
            environment.root / "media"
        ),
        local_temp_root=str(
            environment.root / "temporary"
        ),
        local_log_root=str(
            environment.root / "logs"
        ),
        demo_audio_path=str(
            environment.root
            / "media"
            / "demo.wav"
        ),
        b2_direct_upload_enabled=False,
        lrclib_base_url="http://127.0.0.1:1",
        auth_login_rate_limit=1000,
        auth_login_ip_rate_limit=10000,
        auth_register_rate_limit=1000,
        auth_refresh_rate_limit=10000,
    )
    values["_env_file"] = None
    return Settings(**values)


def clean_process_environment() -> dict[str, str]:
    allowed = {
        "PATH",
        "SYSTEMROOT",
        "WINDIR",
        "COMSPEC",
        "PATHEXT",
        "HOME",
        "USERPROFILE",
        "TEMP",
        "TMP",
        "TMPDIR",
        "LANG",
        "LC_ALL",
        "DISPLAY",
        "XAUTHORITY",
        "PLAYWRIGHT_BROWSERS_PATH",
        "PLAYWRIGHT_CHROMIUM_EXECUTABLE",
        "NODE_EXTRA_CA_CERTS",
        "SSL_CERT_FILE",
        "REQUESTS_CA_BUNDLE",
        "PIP_CERT",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "NO_PROXY",
        "CI",
    }
    return {
        key: value
        for key, value in os.environ.items()
        if (
            key.upper() in allowed
            or key.startswith("CODEX_")
        )
    }


def child_environment(
    environment: RunEnvironment,
) -> dict[str, str]:
    clean = clean_process_environment()
    settings = load_test_settings(environment)
    for key, value in settings.model_dump().items():
        clean[key.upper()] = (
            str(value).lower()
            if isinstance(value, bool)
            else str(value)
        )
    clean.update(
        PYTHONUNBUFFERED="1",
        VITE_API_BASE_URL="/api",
        HYPERSYNC_TEST_POSTGRES_URL=(
            test_postgres_service_url()
        ),
        HYPERSYNC_TEST_MANIFEST=str(
            environment.manifest_path
        ),
        HYPERSYNC_BACKEND_PORT=str(
            environment.api_port
        ),
        HYPERSYNC_DEV_PORT=str(
            environment.web_port
        ),
        HYPERSYNC_DEV_HOST="127.0.0.1",
    )
    return clean


def read_environment(path: Path) -> RunEnvironment:
    data = json.loads(path.read_text())
    root = path.resolve().parent
    run_id = data["run_id"]
    if (
        root.is_symlink()
        or (root / ".owner").read_text()
        != run_id
    ):
        raise ValueError(
            "Invalid verification ownership"
        )

    database_url = database_url_for_owned_database(
        test_postgres_service_url(),
        run_id,
        APP_DATABASE_PREFIX,
    )
    return RunEnvironment(
        run_id,
        root,
        database_url,
        data["api_port"],
        data["web_port"],
        path.resolve(),
    )


def owned_cleanup(
    environment: RunEnvironment,
) -> None:
    root = environment.root
    if (
        root.is_symlink()
        or not root.is_dir()
        or (root / ".owner").read_text()
        != environment.run_id
    ):
        raise ValueError(
            "Refusing cleanup without matching ownership"
        )

    asyncio.run(
        drop_owned_database(
            test_postgres_service_url(),
            environment.run_id,
            APP_DATABASE_PREFIX,
        )
    )
    shutil.rmtree(root)
