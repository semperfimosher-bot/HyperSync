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
