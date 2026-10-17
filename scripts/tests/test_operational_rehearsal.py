"""Offline safety contracts for the disposable PostgreSQL rehearsal."""

import multiprocessing

import pytest


def test_postgres_commands_never_include_credentials_or_remote_targets():
    from scripts.operational_rehearsal import postgres_command

    url = "postgresql://verification:top-secret@127.0.0.1:5432/admin"
    command, env = postgres_command(url, "a" * 32, "hs_restore", "b" * 64, restore=True)
    assert command[:5] == ["docker", "exec", "-i", "-e", "PGPASSWORD"]
    assert "pg_restore" in command
    assert "--exit-on-error" in command
    assert "--no-owner" in command
    assert "--no-acl" in command
    assert "--clean" not in command
    assert "top-secret" not in str(command)
    assert env["PGPASSWORD"] == "top-secret"
    assert command[-1] == "--dbname=hs_restore_" + "a" * 32


@pytest.mark.parametrize("url,container", [
    ("postgresql://u:p@production.invalid/db", "b" * 64),
    ("postgresql://u:p@127.0.0.1/db?host=production.invalid", "b" * 64),
    ("postgresql://u:p@127.0.0.1/db", "untrusted;container"),
])
def test_commands_reject_unsafe_targets(url, container):
    from scripts.operational_rehearsal import postgres_command

    with pytest.raises(ValueError):
        postgres_command(url, "a" * 32, "hs_restore", container, restore=False)


def test_owned_names_cannot_be_replaced_with_arbitrary_database():
    from scripts.operational_rehearsal import postgres_command

    with pytest.raises(ValueError):
        postgres_command("postgresql://u:p@127.0.0.1/db", "bad", "hs_restore", "b" * 64,
                         restore=False)


def test_stop_process_reaps_a_live_child():
    from scripts.operational_rehearsal import stop_process

    ctx = multiprocessing.get_context("spawn")
    process = ctx.Process(target=_wait_forever)
    process.start()
    stop_process(process)
    assert not process.is_alive()
    assert process.exitcode is not None


def _wait_forever():
    multiprocessing.Event().wait()


@pytest.mark.asyncio
async def test_rehearsal_refuses_changed_database_ownership(monkeypatch):
    from unittest.mock import AsyncMock, MagicMock

    import asyncpg

    from scripts.operational_rehearsal import verify_ownership

    connection = MagicMock()
    connection.fetchval = AsyncMock(return_value="someone-else")
    connection.close = AsyncMock()
    monkeypatch.setattr(asyncpg, "connect", AsyncMock(return_value=connection))
    with pytest.raises(RuntimeError, match="ownership"):
        await verify_ownership("postgresql://u:p@127.0.0.1/db", "a" * 32, "hs_restore")
    connection.close.assert_awaited_once()
