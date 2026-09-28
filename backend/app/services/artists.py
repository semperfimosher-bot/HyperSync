from sqlalchemy import (
    select,
    text,
)

from ..models.artist import ArtistProfile
from ..models.media import Track
from .audio_metadata import (
    primary_artist_credit,
    split_artist_credits,
)


def normalize_artist_name(
    value: str,
) -> str:
    return (
        " ".join(
            str(
                value
                or ""
            )
            .strip()
            .split()
        )
        .casefold()
    )


def artist_credit_matches(
    artist_credit: str | None,
    artist_name: str,
    *,
    primary_only: bool = False,
) -> bool:
    target = normalize_artist_name(
        artist_name,
    )

    if not target:
        return False

    if primary_only:
        credits = (
            primary_artist_credit(
                artist_credit,
            ),
        )
    else:
        credits = split_artist_credits(
            artist_credit,
        )

    return any(
        normalize_artist_name(
            credit,
        )
        == target
        for credit in credits
        if credit
    )


def _artist_like_pattern(
    artist_name: str,
) -> str:
    clean = " ".join(
        str(
            artist_name
            or ""
        )
        .strip()
        .split()
    )

    escaped = (
        clean
        .replace(
            "\\",
            "\\\\",
        )
        .replace(
            "%",
            "\\%",
        )
        .replace(
            "_",
            "\\_",
        )
    )

    return (
        "%"
        + escaped
        + "%"
    )


async def load_published_artist_tracks(
    session,
    artist_name: str,
    *,
    primary_only: bool = False,
    limit: int | None = None,
) -> list[Track]:
    clean = " ".join(
        str(
            artist_name
            or ""
        )
        .strip()
        .split()
    )

    if not clean:
        return []

    statement = (
        select(
            Track,
        )
        .where(
            Track.is_published.is_(
                True,
            ),
            Track.artist.ilike(
                _artist_like_pattern(
                    clean,
                ),
                escape="\\",
            ),
        )
        .order_by(
            Track.artist.asc(),
            Track.title.asc(),
        )
    )

    result = await session.execute(
        statement,
    )

    matches = [
        track
        for track
        in result.scalars().all()
        if artist_credit_matches(
            track.artist,
            clean,
            primary_only=(
                primary_only
            ),
        )
    ]

    if (
        limit is not None
        and limit >= 0
    ):
        return matches[
            :limit
        ]

    return matches


async def ensure_artist_profile(
    session,
    artist_name: str,
) -> ArtistProfile:
    clean_name = " ".join(
        str(
            artist_name
            or ""
        )
        .strip()
        .split()
    )

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
