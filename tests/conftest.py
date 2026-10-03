import os

import pytest


def pytest_configure() -> None:
    os.environ["ENVIRONMENT"] = "test"


@pytest.fixture(autouse=True)
async def cleanup_database():
    from backend.app.database import close_database

    yield
    await close_database()
