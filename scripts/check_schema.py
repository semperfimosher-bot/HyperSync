import asyncio

from sqlalchemy import text

from backend.app.database import get_engine

EXPECTED_TABLES = {
    "users",
    "user_profiles",
    "user_sessions",
}


async def main() -> None:
    engine = get_engine()

    query = text(
        """
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        """
    )

    try:
        async with engine.connect() as connection:
            result = await connection.execute(query)
            actual_tables = set(result.scalars().all())

        missing_tables = EXPECTED_TABLES - actual_tables

        if missing_tables:
            missing_names = ", ".join(sorted(missing_tables))

            raise SystemExit(f"Missing database tables: {missing_names}")

        print("Account schema is present in Neon.")
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
