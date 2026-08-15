import asyncio

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import text

from backend.app.database import get_engine

EXPECTED_TABLES = {
    "alembic_version",
    "users",
    "user_profiles",
    "user_sessions",
}


def get_alembic_head() -> str:
    alembic_config = Config("alembic.ini")
    script = ScriptDirectory.from_config(alembic_config)

    heads = script.get_heads()

    if len(heads) != 1:
        raise RuntimeError(f"Expected exactly one Alembic head, found: {heads}")

    return heads[0]


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

        expected_revision = get_alembic_head()

        if current_revision != expected_revision:
            raise RuntimeError(
                f"Unexpected Alembic revision. "
                f"Expected {expected_revision}, "
                f"found '{current_revision}'."
            )

        print("Account schema and Alembic revision are correct in Neon.")
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
