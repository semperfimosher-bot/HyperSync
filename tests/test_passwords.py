import threading

import pytest

import backend.app.security.passwords as password_module
from backend.app.security.passwords import (
    hash_password,
    verify_and_update_password,
    verify_password,
)


def test_password_hashing_and_verification() -> None:
    password = "correct horse battery staple"

    password_hash = hash_password(password)

    assert password_hash != password
    assert password_hash.startswith("$argon2")

    assert (
        verify_password(
            password,
            password_hash,
        )
        is True
    )

    assert (
        verify_password(
            "wrong password",
            password_hash,
        )
        is False
    )


def test_password_hash_can_be_checked_for_updates() -> None:
    password = "another strong test password"

    password_hash = hash_password(password)

    is_valid, updated_hash = verify_and_update_password(
        password,
        password_hash,
    )

    assert is_valid is True

    assert updated_hash is None or updated_hash.startswith("$argon2")


@pytest.mark.asyncio
async def test_async_password_helpers_run_off_event_loop(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    event_loop_thread = (
        threading.get_ident()
    )

    def fake_hash(
        _password: str,
    ) -> str:
        return str(
            threading.get_ident(),
        )

    def fake_verify(
        _password: str,
        _password_hash: str,
    ) -> bool:
        return (
            threading.get_ident()
            != event_loop_thread
        )

    monkeypatch.setattr(
        password_module,
        "hash_password",
        fake_hash,
    )
    monkeypatch.setattr(
        password_module,
        "verify_password",
        fake_verify,
    )

    worker_thread = int(
        await password_module.hash_password_async(
            "thread-check",
        )
    )

    assert (
        worker_thread
        != event_loop_thread
    )

    assert (
        await password_module.verify_password_async(
            "thread-check",
            "unused",
        )
        is True
    )
