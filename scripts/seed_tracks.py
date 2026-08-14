import asyncio

from sqlalchemy import select

from backend.app.database import get_session_factory
from backend.app.models.media import Track

TRACKS = [
    {
        "title": "Give the Love Around",
        "artist": "The Script",
        "b2_object_key": "The Script - Give the Love Around.mp3",
    },
    {
        "title": "Superheroes",
        "artist": "The Script",
        "b2_object_key": "The Script - Superheroes.mp3",
    },
]


async def main() -> None:
    session_factory = get_session_factory()

    async with session_factory() as session:
        for track_data in TRACKS:
            result = await session.execute(
                select(Track).where(
                    Track.b2_object_key == track_data["b2_object_key"],
                )
            )

            if result.scalar_one_or_none() is not None:
                print(
                    f"Already exists: "
                    f"{track_data['b2_object_key']}"
                )
                continue

            session.add(Track(**track_data))

        await session.commit()

    print("TRACK SEED COMPLETE")


if __name__ == "__main__":
    asyncio.run(main())