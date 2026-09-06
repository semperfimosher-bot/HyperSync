from __future__ import annotations

import asyncio
from time import perf_counter

from sqlalchemy import func, select
from sqlalchemy.orm import joinedload, selectinload

from backend.app.database import (
    get_session_factory,
)
from backend.app.models.account import (
    AccountType,
    User,
)
from backend.app.security.passwords import (
    hash_password,
    verify_password,
)


def milliseconds(
    started: float,
) -> float:
    return (perf_counter() - started) * 1000


async def run_diagnostic(
    identifier: str,
) -> None:
    normalized_identifier = identifier.strip().lower()
    print()
    print("HyperSync login latency diagnostic")
    print("This performs READ-ONLY database queries.")
    print("It does not ask for your password.")
    print()

    print()
    print("1. Measuring Argon2 locally...")

    dummy_password = "HyperSync-Latency-Probe-Only-2026!"

    started = perf_counter()

    dummy_hash = hash_password(
        dummy_password,
    )

    hash_ms = milliseconds(
        started,
    )

    started = perf_counter()

    verified = verify_password(
        dummy_password,
        dummy_hash,
    )

    verify_ms = milliseconds(
        started,
    )

    if not verified:
        raise RuntimeError("Argon2 diagnostic failed.")

    print(f"   Argon2 hash:   {hash_ms:.1f} ms")

    print(f"   Argon2 verify: {verify_ms:.1f} ms")

    session_factory = get_session_factory()

    print()
    print("2. Measuring database connection...")

    async with session_factory() as session:
        started = perf_counter()

        await session.execute(select(1))

        connection_ms = milliseconds(
            started,
        )

    print(f"   SELECT 1:      {connection_ms:.1f} ms")

    print()
    print("3. Measuring CURRENT login query...")

    async with session_factory() as session:
        started = perf_counter()

        result = await session.execute(
            select(
                User,
            )
            .options(
                selectinload(
                    User.profile,
                ),
            )
            .where(
                User.account_type == AccountType.REGISTERED,
                User.is_active.is_(
                    True,
                ),
                (User.username_normalized == normalized_identifier)
                | (
                    func.lower(
                        User.email,
                    )
                    == normalized_identifier
                ),
            )
        )

        current_user = result.scalar_one_or_none()

        current_query_ms = milliseconds(
            started,
        )

    print(f"   Current query: {current_query_ms:.1f} ms")

    print(f"   User found:    {current_user is not None}")

    print()
    print("4. Measuring OPTIMIZED read-only query...")

    async with session_factory() as session:
        started = perf_counter()

        result = await session.execute(
            select(
                User,
            )
            .options(
                joinedload(
                    User.profile,
                ),
            )
            .where(
                User.account_type == AccountType.REGISTERED,
                User.is_active.is_(
                    True,
                ),
                (User.username_normalized == normalized_identifier)
                | (User.email == normalized_identifier),
            )
        )

        optimized_user = result.scalar_one_or_none()

        optimized_query_ms = milliseconds(
            started,
        )

    print(f"   Optimized query: {optimized_query_ms:.1f} ms")

    print(f"   User found:      {optimized_user is not None}")

    print()
    print("==============================")
    print("RESULTS")
    print("==============================")

    print(f"DB connection:    {connection_ms:.1f} ms")

    print(f"Current lookup:   {current_query_ms:.1f} ms")

    print(f"Optimized lookup: {optimized_query_ms:.1f} ms")

    print(f"Argon2 verify:    {verify_ms:.1f} ms")

    known_current_ms = connection_ms + current_query_ms + verify_ms

    known_optimized_ms = connection_ms + optimized_query_ms + verify_ms

    print()
    print(f"Known current work:   {known_current_ms:.1f} ms")

    print(f"Known optimized work: {known_optimized_ms:.1f} ms")

    print()
    print("No database rows were changed.")


def main() -> None:
    print()
    print("HyperSync login latency diagnostic")
    print("This performs READ-ONLY database queries.")
    print("It does not ask for your password.")
    print()

    identifier = input("Enter the username or email you normally sign in with: ").strip()

    asyncio.run(
        run_diagnostic(
            identifier,
        )
    )


if __name__ == "__main__":
    main()
