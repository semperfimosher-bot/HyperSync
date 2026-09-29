from sqlalchemy import (
    select,
    text,
)

from ..models.artist import ArtistProfile
from ..models.media import (
    Track,
    TrackArtistCredit,
)
from .audio_metadata import (
    normalize_track_identity,
    primary_artist_credit,
    split_artist_credits,
)
from .media_identity import (
    load_tracks_for_artist_credit,
)


def normalize_artist_name(
    value: str,
) -> str:
    # Keep artist profile/search identity aligned with the
    # same Unicode + whitespace normalization used by track
    # identity and duplicate detection.
    return normalize_track_identity(
        value,
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


def artist_names_for_credit(
    artist_credit: str | None,
    *,
    include_combined: bool = True,
) -> tuple[str, ...]:
    raw = " ".join(
        str(
            artist_credit
            or ""
        )
        .strip()
        .split()
    )

    if not raw:
        return ()

    values = (
        (
            raw,
            *split_artist_credits(
                raw,
            ),
        )
        if include_combined
        else split_artist_credits(
            raw,
        )
    )

    result: list[str] = []
    seen: set[str] = set()

    for value in values:
        clean = " ".join(
            str(
                value
                or ""
            )
            .strip()
            .split()
        )

        key = normalize_artist_name(
            clean,
        )

        if (
            not key
            or key in seen
        ):
            continue

        seen.add(
            key,
        )
        result.append(
            clean,
        )

    return tuple(
        result,
    )


async def ensure_artist_profiles_for_credit(
    session,
    artist_credit: str | None,
    *,
    include_combined: bool = True,
) -> list[ArtistProfile]:
    profiles: list[
        ArtistProfile
    ] = []

    for artist_name in artist_names_for_credit(
        artist_credit,
        include_combined=(
            include_combined
        ),
    ):
        profiles.append(
            await ensure_artist_profile(
                session,
                artist_name,
            )
        )

    return profiles


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
    tracks = (
        await load_tracks_for_artist_credit(
            session,
            artist_name,
            primary_only=(
                primary_only
            ),
            published_only=True,
        )
    )

    tracks.sort(
        key=lambda track: (
            track.artist.casefold(),
            track.title.casefold(),
            str(
                track.id,
            ),
        )
    )

    if (
        limit is not None
        and limit >= 0
    ):
        return tracks[
            :limit
        ]

    return tracks


async def backfill_missing_artist_profiles(
    *,
    batch_size: int = 250,
) -> int:
    from ..database import (
        get_session_factory,
    )

    session_factory = (
        get_session_factory()
    )

    async with session_factory() as session:
        result = await session.execute(
            select(
                TrackArtistCredit.artist_name,
                TrackArtistCredit.normalized_name,
            )
            .outerjoin(
                ArtistProfile,
                ArtistProfile.normalized_name
                == TrackArtistCredit.normalized_name,
            )
            .where(
                ArtistProfile.id.is_(
                    None,
                )
            )
            .distinct()
            .order_by(
                TrackArtistCredit.normalized_name.asc(),
            )
            .limit(
                max(
                    1,
                    int(
                        batch_size,
                    ),
                )
            )
        )

        rows = list(
            result.all()
        )

        for (
            artist_name,
            normalized_name,
        ) in rows:
            clean_name = " ".join(
                str(
                    artist_name
                    or ""
                )
                .strip()
                .split()
            )

            if (
                not clean_name
                or not normalized_name
            ):
                continue

            await ensure_artist_profile(
                session,
                clean_name,
            )

        if rows:
            await session.commit()

        return len(
            rows,
        )


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
