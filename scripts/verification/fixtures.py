import json
import math
import struct
import wave
from uuid import UUID, uuid5

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.app.models import AccountType, Track, User, UserProfile
from backend.app.security.passwords import hash_password

from .environment import RunEnvironment
from .postgres_database import upgrade_database_to_head


async def seed_fixtures(environment: RunEnvironment) -> dict:
    root = environment.root
    media = root / "media"
    media.mkdir()
    tracks = []
    namespace = UUID(environment.run_id)
    for index, seconds in enumerate([45, 45, 45, 3]):
        title = f"Verification Track {index + 1}"
        relative = f"media/track-{index + 1}.wav"
        with wave.open(str(root / relative), "wb") as audio:
            audio.setnchannels(1)
            audio.setsampwidth(2)
            audio.setframerate(22050)
            period = b"".join(
                struct.pack(
                    "<h", int(3000 * math.sin(2 * math.pi * (220 + index * 110) * n / 22050))
                )
                for n in range(22050)
            )
            for _ in range(seconds):
                audio.writeframes(period)
        tracks.append(
            {
                "id": str(uuid5(namespace, title)),
                "title": title,
                "duration": seconds,
                "file": relative,
            }
        )
    accounts = [
        {
            "username": f"verify-{role}-{environment.run_id[:8]}",
            "password": f"Verify-{environment.run_id}-{role}!",
        }
        for role in ["host", "guest", "outsider"]
    ]
    await upgrade_database_to_head(
        environment.database_url
    )
    engine = create_async_engine(
        environment.database_url,
        connect_args={"ssl": False},
    )
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as session:
            for item in tracks:
                session.add(
                    Track(
                        id=UUID(item["id"]),
                        title=item["title"],
                        artist="Verification Artist",
                        album="Verification Album",
                        b2_object_key=item["file"],
                        mime_type="audio/wav",
                        duration_seconds=item["duration"],
                        file_size=(root / item["file"]).stat().st_size,
                        is_published=True,
                    )
                )
            for account in accounts:
                user_id = uuid5(namespace, account["username"])
                session.add(
                    User(
                        id=user_id,
                        account_type=AccountType.REGISTERED,
                        email=f"{account['username']}@example.com",
                        username=account["username"],
                        username_normalized=account["username"],
                        password_hash=hash_password(account["password"]),
                    )
                )
                session.add(UserProfile(user_id=user_id, display_name="Verification"))
            await session.commit()
    finally:
        await engine.dispose()
    manifest = {
        "run_id": environment.run_id,
        "api_port": environment.api_port,
        "web_port": environment.web_port,
        "base_url": f"http://127.0.0.1:{environment.web_port}",
        "accounts": accounts,
        "tracks": tracks,
    }
    environment.manifest_path.write_text(json.dumps(manifest, indent=2))
    environment.manifest_path.chmod(0o600)
    return manifest
