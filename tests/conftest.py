import pytest

from backend.app.database import close_database


@pytest.fixture(autouse=True)
async def cleanup_database():
    yield
    await close_database()
