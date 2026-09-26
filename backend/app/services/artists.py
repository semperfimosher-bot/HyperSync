from sqlalchemy import (
    select,
    text,
)

from ..models.artist import ArtistProfile


def normalize_artist_name(
    value: str,
) -> str:
    return (
        value.strip()
        .casefold()
    )


async def ensure_artist_profile(
    session,
    artist_name: str,
) -> ArtistProfile:
    clean_name = artist_name.strip()

    if not clean_name:
        raise ValueError(
            "Artist name cannot be empty.",
        )

    normalized = normalize_artist_name(
        clean_name,
    )

    bind = session.get_bind()

    if (
        bind is not None
        and bind.dialect.name
        == "postgresql"
    ):
        await session.execute(
            text(
                "SELECT "
                "pg_advisory_xact_lock("
                "hashtext(:artist_name)"
                ")"
            ),
            {
                "artist_name":
                    "artist-profile:"
                    + normalized,
            },
        )

    result = await session.execute(
        select(
            ArtistProfile,
        ).where(
            ArtistProfile.normalized_name
            == normalized,
        )
    )

    profile = (
        result.scalar_one_or_none()
    )

    if profile is not None:
        return profile

    profile = ArtistProfile(
        name=clean_name,
        normalized_name=normalized,
    )

    session.add(
        profile,
    )

    await session.flush()

    return profile
