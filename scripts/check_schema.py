import asyncio

from sqlalchemy import text

from backend.app.database import get_engine

EXPECTED_REVISION = "022b324132d4"

EXPECTED_TABLES = {
    "alembic_version",
    "users",
    "user_profiles",
    "user_sessions",
}


async def main() -> None:
    engine = get_engine()

    table_query = text(
        """
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        """
    )

    revision_query = text(
        """
        SELECT version_num
        FROM alembic_version
        """
    )

    try:
        async with engine.connect() as connection:
            table_result = await connection.execute(table_query)

            actual_tables = set(table_result.scalars().all())

            missing_tables = EXPECTED_TABLES - actual_tables

            if missing_tables:
                missing_names = ", ".join(sorted(missing_tables))

                raise SystemExit(f"Missing database tables: {missing_names}")

            revision_result = await connection.execute(revision_query)

            current_revision = revision_result.scalar_one_or_none()

        if current_revision != EXPECTED_REVISION:
            raise SystemExit(
                "Unexpected Alembic revision. "
                f"Expected {EXPECTED_REVISION}, "
                f"found {current_revision!r}."
            )

        print("Account schema and Alembic revision are correct in Neon.")
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
