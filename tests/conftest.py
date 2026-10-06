import asyncio
import os
from uuid import uuid4

import pytest

from scripts.verification.postgres_database import (
    create_owned_database,
    drop_owned_database,
    upgrade_database_to_head,
    validate_local_postgres_service,
)

PYTEST_DATABASE_PREFIX = "hs_pytest"
_DATABASE_STATE: dict[str, str] = {}
_DATABASE_FREE_TEST_FILES = {
    "test_verification_runner.py",
    "test_verification_reporting.py",
    "test_verification_processes.py",
}


def _database_required(config) -> bool:
    requested = [
        str(value).replace("\\", "/")
        for value in getattr(config, "args", [])
        if str(value).endswith(".py")
    ]
    if requested and all(
        value.rsplit("/", 1)[-1]
        in _DATABASE_FREE_TEST_FILES
        for value in requested
    ):
        return False
    return True


def pytest_configure(config) -> None:
    os.environ["ENVIRONMENT"] = "test"
    if not _database_required(config):
        return

    service_url = os.environ.get(
        "HYPERSYNC_TEST_POSTGRES_URL",
        "",
    ).strip()
    if not service_url:
        raise pytest.UsageError(
            "Database-backed tests require "
            "HYPERSYNC_TEST_POSTGRES_URL pointing to a "
            "disposable local PostgreSQL service."
        )

    try:
        service_url = validate_local_postgres_service(
            service_url
        )
    except ValueError as exc:
        raise pytest.UsageError(str(exc)) from exc

    run_id = uuid4().hex
    database_url = asyncio.run(
        create_owned_database(
            service_url,
            run_id,
            PYTEST_DATABASE_PREFIX,
        )
    )
    try:
        os.environ["DATABASE_URL"] = database_url
        os.environ[
            "MIGRATION_DATABASE_URL"
        ] = database_url

        from backend.app.config import get_settings

        get_settings.cache_clear()
        asyncio.run(
            upgrade_database_to_head(
                database_url
            )
        )
    except BaseException:
        asyncio.run(
            drop_owned_database(
                service_url,
                run_id,
                PYTEST_DATABASE_PREFIX,
            )
        )
        raise

    _DATABASE_STATE.update(
        service_url=service_url,
        run_id=run_id,
    )


@pytest.fixture(autouse=True)
async def cleanup_database():
    from backend.app.database import close_database

    yield
    await close_database()


def pytest_unconfigure(config) -> None:
    service_url = _DATABASE_STATE.get(
        "service_url"
    )
    run_id = _DATABASE_STATE.get(
        "run_id"
    )
    if not service_url or not run_id:
        return

    asyncio.run(
        drop_owned_database(
            service_url,
            run_id,
            PYTEST_DATABASE_PREFIX,
        )
    )
    _DATABASE_STATE.clear()
