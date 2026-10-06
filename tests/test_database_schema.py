from sqlalchemy import text

from backend.app.database import get_engine


async def test_migrated_schema_contains_profile_avatar_column():
    async with get_engine().connect() as connection:
        result = await connection.execute(
            text(
                """
                SELECT column_name
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'user_profiles'
                  AND column_name = 'avatar_object_key'
                """
            )
        )
        assert result.scalar_one() == "avatar_object_key"
