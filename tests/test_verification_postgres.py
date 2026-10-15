import runpy
from unittest.mock import MagicMock

import pytest
from alembic import context
from alembic.config import Config

from scripts.verification.postgres import validate_target


@pytest.mark.parametrize(
    "url",
    [
        "",
        "postgresql://user:secret@production.invalid/live",
        "postgresql://u:p@127.0.0.1/db?host=production.invalid",
        "https://127.0.0.1/db",
        "postgresql://u:p@127.0.0.1/db#extra",
    ],
)
def test_postgres_rejects_nonlocal_or_ambiguous_targets(url):
    with pytest.raises(ValueError):
        validate_target(url, "a" * 32)


def test_postgres_database_name_is_owned_and_injection_safe():
    assert (
        validate_target("postgresql://u:p@127.0.0.1:5432/postgres", "a" * 32)
        == "hs_verify_" + "a" * 32
    )
    with pytest.raises(ValueError):
        validate_target("postgresql://u:p@127.0.0.1/postgres", "bad; DROP DATABASE postgres")


def test_online_migrations_can_use_an_owned_existing_connection(monkeypatch):
    config = Config()
    connection = MagicMock()
    config.attributes["connection"] = connection
    configure = MagicMock()
    migrate = MagicMock()
    monkeypatch.setattr(context, "config", config, raising=False)
    monkeypatch.setattr(context, "is_offline_mode", lambda: False)
    monkeypatch.setattr(context, "configure", configure)
    monkeypatch.setattr(context, "begin_transaction", MagicMock())
    monkeypatch.setattr(context, "run_migrations", migrate)
    runpy.run_path("migrations/env.py")
    assert configure.call_args.kwargs["connection"] is connection
    migrate.assert_called_once()


@pytest.mark.asyncio
async def test_parent_cleanup_refuses_database_with_different_owner(monkeypatch):
    from unittest.mock import AsyncMock

    import asyncpg

    from scripts.verification.postgres import cleanup_owned_database

    admin = MagicMock()
    admin.fetchrow = AsyncMock(return_value={'owner': 'someone-else'})
    admin.execute = AsyncMock()
    admin.close = AsyncMock()
    monkeypatch.setattr(asyncpg, 'connect', AsyncMock(return_value=admin))
    with pytest.raises(RuntimeError, match='ownership'):
        await cleanup_owned_database('postgresql://u:p@127.0.0.1/postgres', 'a' * 32)
    admin.execute.assert_not_called()
    admin.close.assert_awaited_once()


@pytest.mark.asyncio
async def test_parent_cleanup_removes_only_matching_owned_database(monkeypatch):
    from unittest.mock import AsyncMock

    import asyncpg

    from scripts.verification.postgres import cleanup_owned_database

    admin = MagicMock()
    admin.fetchrow = AsyncMock(return_value={'owner': 'a' * 32})
    admin.execute = AsyncMock()
    admin.close = AsyncMock()
    monkeypatch.setattr(asyncpg, 'connect', AsyncMock(return_value=admin))
    await cleanup_owned_database('postgresql://u:p@127.0.0.1/postgres', 'a' * 32)
    expected = 'DROP DATABASE "hs_verify_' + 'a' * 32 + '" WITH (FORCE)'
    assert admin.execute.call_args.args[0] == expected
