from pwdlib import PasswordHash

_password_hash = PasswordHash.recommended()


def hash_password(password: str) -> str:
    """Hash a plaintext password with the recommended Argon2 settings."""

    return _password_hash.hash(password)


def verify_password(
    password: str,
    password_hash: str,
) -> bool:
    """Return True only when the password matches the stored hash."""

    return _password_hash.verify(
        password,
        password_hash,
    )


def verify_and_update_password(
    password: str,
    password_hash: str,
) -> tuple[bool, str | None]:
    """Verify a password and replace old hashing parameters when needed."""

    return _password_hash.verify_and_update(
        password,
        password_hash,
    )
