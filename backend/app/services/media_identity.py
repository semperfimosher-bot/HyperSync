from __future__ import annotations

from sqlalchemy import (
    delete,
    select,
)

from ..database import (
    get_session_factory,
)
from ..models.media import (
    Track,
    TrackArtistCredit,
    TrackIdentity,
)
from .audio_metadata import (
    normalize_track_identity,
    normalize_track_title_identity,
    primary_artist_credit,
    split_artist_credits,
)


def track_identity_keys(
    *,
    title: str,
    artist: str,
) -> tuple[
    str,
    str,
    str,
]:
    return (
        normalize_track_identity(
            artist,
        ),
        normalize_track_identity(
            primary_artist_credit(
                artist,
            )
        ),
        normalize_track_title_identity(
            title,
        ),
    )


def track_identity_lock_key(
    *,
    title: str,
    artist: str,
) -> str:
    (
        _artist_key,
        primary_artist_key,
        title_key,
    ) = track_identity_keys(
        title=title,
        artist=artist,
    )

    return (
        primary_artist_key
        + "\x1f"
        + title_key
    )


async def sync_track_media_identity(
    session,
    track: Track,
) -> None:
    await session.flush()

    (
        artist_key,
        primary_artist_key,
        title_key,
    ) = track_identity_keys(
        title=track.title,
        artist=track.artist,
    )

    identity = await session.get(
        TrackIdentity,
        track.id,
    )

    if identity is None:
        identity = TrackIdentity(
            track_id=track.id,
            artist_key=artist_key,
            primary_artist_key=(
                primary_artist_key
            ),
            title_key=title_key,
        )

        session.add(
            identity,
        )
    else:
        identity.artist_key = artist_key
        identity.primary_artist_key = (
            primary_artist_key
        )
        identity.title_key = title_key

    await session.execute(
        delete(
            TrackArtistCredit,
        ).where(
            TrackArtistCredit.track_id
            == track.id,
        )
    )

    credits = split_artist_credits(
        track.artist,
    )

    for position, artist_name in enumerate(
        credits,
    ):
        normalized = normalize_track_identity(
            artist_name,
        )

        if not normalized:
            continue

        session.add(
            TrackArtistCredit(
                track_id=track.id,
                position=position,
                artist_name=artist_name,
                normalized_name=normalized,
                is_primary=(
                    position == 0
                ),
            )
        )

    await session.flush()


def _scalar_one_or_none(
    result,
):
    scalar_one_or_none = getattr(
        result,
        "scalar_one_or_none",
        None,
    )

    if callable(
        scalar_one_or_none,
    ):
        return scalar_one_or_none()

    # Lightweight test/session doubles may only expose
    # scalars().all(). Treat those as not representing the
    # indexed query so the compatibility path can evaluate
    # identities explicitly instead of trusting fake SQL.
    return None


async def find_duplicate_track(
    session,
    *,
    title: str,
    artist: str,
) -> Track | None:
    (
        artist_key,
        _primary_artist_key,
        title_key,
    ) = track_identity_keys(
        title=title,
        artist=artist,
    )

    indexed_result = await session.execute(
        select(
            Track,
        )
        .join(
            TrackIdentity,
            TrackIdentity.track_id
            == Track.id,
        )
        .where(
            TrackIdentity.title_key
            == title_key,
            (
                (
                    TrackIdentity.artist_key
                    == artist_key
                )
                |
                (
                    TrackIdentity.primary_artist_key
                    == _primary_artist_key
                )
            ),
        )
        .order_by(
            Track.created_at.asc(),
            Track.id.asc(),
        )
        .limit(
            1,
        )
    )

    indexed = _scalar_one_or_none(
        indexed_result,
    )

    if indexed is not None:
        return indexed

    # Compatibility fallback while legacy rows are
    # being backfilled. Once indexed, future lookups
    # avoid scanning that row again.
    legacy_result = await session.execute(
        select(
            Track,
        )
        .outerjoin(
            TrackIdentity,
            TrackIdentity.track_id
            == Track.id,
        )
        .where(
            TrackIdentity.track_id.is_(
                None,
            )
        )
    )

    for track in legacy_result.scalars().all():
        (
            existing_artist_key,
            _existing_primary_key,
            existing_title_key,
        ) = track_identity_keys(
            title=track.title,
            artist=track.artist,
        )

        if (
            existing_title_key
            == title_key
            and (
                existing_artist_key
                == artist_key
                or _existing_primary_key
                == _primary_artist_key
            )
        ):
            return track

    return None


async def load_tracks_for_artist_credit(
    session,
    artist_name: str,
    *,
    primary_only: bool = False,
    published_only: bool = True,
) -> list[Track]:
    target = normalize_track_identity(
        artist_name,
    )

    if not target:
        return []

    indexed_stmt = (
        select(
            Track,
        )
        .join(
            TrackArtistCredit,
            TrackArtistCredit.track_id
            == Track.id,
        )
        .where(
            TrackArtistCredit.normalized_name
            == target,
        )
    )

    if primary_only:
        indexed_stmt = indexed_stmt.where(
            TrackArtistCredit.is_primary.is_(
                True,
            )
        )

    if published_only:
        indexed_stmt = indexed_stmt.where(
            Track.is_published.is_(
                True,
            )
        )

    indexed_result = await session.execute(
        indexed_stmt
    )

    tracks_by_id = {
        track.id:
            track
        for track
        in indexed_result.scalars().all()
    }

    # Compatibility fallback for rows that do not
    # have artist-credit sidecars yet.
    legacy_stmt = (
        select(
            Track,
        )
        .outerjoin(
            TrackArtistCredit,
            TrackArtistCredit.track_id
            == Track.id,
        )
        .where(
            TrackArtistCredit.track_id.is_(
                None,
            )
        )
        .distinct()
    )

    if published_only:
        legacy_stmt = legacy_stmt.where(
            Track.is_published.is_(
                True,
            )
        )

    legacy_result = await session.execute(
        legacy_stmt
    )

    for track in legacy_result.scalars().all():
        credits = (
            (
                primary_artist_credit(
                    track.artist,
                ),
            )
            if primary_only
            else split_artist_credits(
                track.artist,
            )
        )

        if any(
            normalize_track_identity(
                credit,
            )
            == target
            for credit in credits
            if credit
        ):
            tracks_by_id[
                track.id
            ] = track

    return list(
        tracks_by_id.values(),
    )


async def backfill_missing_media_identities(
    *,
    batch_size: int = 250,
) -> int:
    session_factory = (
        get_session_factory()
    )

    async with session_factory() as session:
        identity_result = await session.execute(
            select(
                Track,
            )
            .outerjoin(
                TrackIdentity,
                TrackIdentity.track_id
                == Track.id,
            )
            .where(
                TrackIdentity.track_id.is_(
                    None,
                )
            )
            .order_by(
                Track.created_at.asc(),
                Track.id.asc(),
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

        tracks = list(
            identity_result.scalars().all()
        )

        if not tracks:
            credit_result = await session.execute(
                select(
                    Track,
                )
                .outerjoin(
                    TrackArtistCredit,
                    TrackArtistCredit.track_id
                    == Track.id,
                )
                .where(
                    TrackArtistCredit.track_id.is_(
                        None,
                    )
                )
                .distinct()
                .order_by(
                    Track.created_at.asc(),
                    Track.id.asc(),
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

            tracks = list(
                credit_result.scalars().all()
            )

        for track in tracks:
            await sync_track_media_identity(
                session,
                track,
            )

        if tracks:
            await session.commit()

        return len(
            tracks,
        )


async def backfill_all_media_identities(
    *,
    batch_size: int = 250,
) -> int:
    total = 0

    while True:
        processed = (
            await backfill_missing_media_identities(
                batch_size=batch_size,
            )
        )

        total += processed

        if processed == 0:
            return total
