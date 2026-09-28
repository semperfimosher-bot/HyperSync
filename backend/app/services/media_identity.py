from __future__ import annotations

from sqlalchemy import (
    delete,
    func,
    select,
)
from sqlalchemy.exc import (
    OperationalError,
)

from ..database import (
    get_session_factory,
)
from ..models.artist import (
    ArtistProfile,
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


def _artist_credit_matches_target(
    artist_credit: str | None,
    target: str,
    *,
    primary_only: bool,
) -> bool:
    credits = (
        (
            primary_artist_credit(
                artist_credit,
            ),
        )
        if primary_only
        else split_artist_credits(
            artist_credit,
        )
    )

    return any(
        normalize_track_identity(
            credit,
        )
        == target
        for credit in credits
        if credit
    )


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
        if _artist_credit_matches_target(
            track.artist,
            target,
            primary_only=primary_only,
        )
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
        if _artist_credit_matches_target(
            track.artist,
            target,
            primary_only=primary_only,
        ):
            tracks_by_id[
                track.id
            ] = track

    return list(
        tracks_by_id.values(),
    )


def group_duplicate_tracks(
    tracks: list[Track],
) -> list[dict]:
    grouped: dict[
        tuple[str, str],
        list[Track],
    ] = {}

    for track in tracks:
        (
            _artist_key,
            primary_artist_key,
            title_key,
        ) = track_identity_keys(
            title=track.title,
            artist=track.artist,
        )

        grouped.setdefault(
            (
                primary_artist_key,
                title_key,
            ),
            [],
        ).append(
            track,
        )

    groups: list[dict] = []

    for (
        artist_key,
        title_key,
    ), rows in grouped.items():
        if len(
            rows,
        ) < 2:
            continue

        ordered_tracks = sorted(
            rows,
            key=lambda item: (
                getattr(
                    item,
                    "created_at",
                    None,
                )
                is None,
                getattr(
                    item,
                    "created_at",
                    None,
                ),
                str(
                    item.id,
                ),
            ),
        )

        first = ordered_tracks[
            0
        ]

        groups.append(
            {
                "artist_key":
                    artist_key,
                "title_key":
                    title_key,
                "artist":
                    first.artist,
                "title":
                    first.title,
                "count":
                    len(
                        ordered_tracks,
                    ),
                "keep_track_id":
                    str(
                        first.id,
                    ),
                "tracks": [
                    {
                        "id":
                            str(
                                item.id,
                            ),
                        "title":
                            item.title,
                        "artist":
                            item.artist,
                        "album":
                            item.album,
                        "b2_object_key":
                            item.b2_object_key,
                    }
                    for item
                    in ordered_tracks
                ],
            }
        )

    groups.sort(
        key=lambda group: (
            -int(
                group[
                    "count"
                ],
            ),
            str(
                group[
                    "artist_key"
                ],
            ),
            str(
                group[
                    "title_key"
                ],
            ),
        )
    )

    return groups


async def duplicate_track_groups(
    session,
) -> tuple[
    int,
    list[dict],
]:
    track_count = int(
        (
            await session.execute(
                select(
                    func.count(
                        Track.id,
                    )
                )
            )
        ).scalar_one()
        or 0
    )

    missing_identity_count = int(
        (
            await session.execute(
                select(
                    func.count(
                        Track.id,
                    )
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
        ).scalar_one()
        or 0
    )

    if missing_identity_count:
        result = await session.execute(
            select(
                Track,
            )
        )

        return (
            track_count,
            group_duplicate_tracks(
                list(
                    result.scalars().all()
                )
            ),
        )

    else:
        duplicate_keys = (
            select(
                TrackIdentity.primary_artist_key,
                TrackIdentity.title_key,
            )
            .group_by(
                TrackIdentity.primary_artist_key,
                TrackIdentity.title_key,
            )
            .having(
                func.count(
                    TrackIdentity.track_id,
                )
                > 1
            )
            .subquery()
        )

        result = await session.execute(
            select(
                Track,
                TrackIdentity.primary_artist_key,
                TrackIdentity.title_key,
            )
            .join(
                TrackIdentity,
                TrackIdentity.track_id
                == Track.id,
            )
            .join(
                duplicate_keys,
                (
                    duplicate_keys.c.primary_artist_key
                    == TrackIdentity.primary_artist_key
                )
                &
                (
                    duplicate_keys.c.title_key
                    == TrackIdentity.title_key
                ),
            )
            .order_by(
                Track.created_at.asc(),
                Track.id.asc(),
            )
        )

        grouped = {}

        for (
            track,
            primary_artist_key,
            title_key,
        ) in result.all():
            grouped.setdefault(
                (
                    primary_artist_key,
                    title_key,
                ),
                [],
            ).append(
                track,
            )

        duplicate_rows = list(
            grouped.items()
        )

    groups: list[dict] = []

    for (
        artist_key,
        title_key,
    ), tracks in duplicate_rows:
        ordered_tracks = sorted(
            tracks,
            key=lambda item: (
                getattr(
                    item,
                    "created_at",
                    None,
                )
                is None,
                getattr(
                    item,
                    "created_at",
                    None,
                ),
                str(
                    item.id,
                ),
            ),
        )

        if len(
            ordered_tracks,
        ) < 2:
            continue

        first = ordered_tracks[
            0
        ]

        groups.append(
            {
                "artist_key":
                    artist_key,
                "title_key":
                    title_key,
                "artist":
                    first.artist,
                "title":
                    first.title,
                "count":
                    len(
                        ordered_tracks,
                    ),
                "keep_track_id":
                    str(
                        first.id,
                    ),
                "tracks": [
                    {
                        "id":
                            str(
                                item.id,
                            ),
                        "title":
                            item.title,
                        "artist":
                            item.artist,
                        "album":
                            item.album,
                        "b2_object_key":
                            item.b2_object_key,
                    }
                    for item
                    in ordered_tracks
                ],
            }
        )

    groups.sort(
        key=lambda group: (
            -int(
                group[
                    "count"
                ],
            ),
            str(
                group[
                    "artist_key"
                ],
            ),
            str(
                group[
                    "title_key"
                ],
            ),
        )
    )

    return (
        track_count,
        groups,
    )


async def catalog_identity_diagnostics(
    session,
) -> dict[str, int]:
    track_count = int(
        (
            await session.execute(
                select(
                    func.count(
                        Track.id,
                    )
                )
            )
        ).scalar_one()
        or 0
    )

    album_count = int(
        (
            await session.execute(
                select(
                    func.count(
                        func.distinct(
                            func.lower(
                                func.trim(
                                    Track.album,
                                )
                            )
                        )
                    )
                ).where(
                    Track.album.is_not(
                        None,
                    ),
                    func.trim(
                        Track.album,
                    )
                    != "",
                )
            )
        ).scalar_one()
        or 0
    )

    artwork_count = int(
        (
            await session.execute(
                select(
                    func.count(
                        Track.id,
                    )
                ).where(
                    Track.artwork_object_key.is_not(
                        None,
                    ),
                    func.trim(
                        Track.artwork_object_key,
                    )
                    != "",
                )
            )
        ).scalar_one()
        or 0
    )

    missing_identity_count = int(
        (
            await session.execute(
                select(
                    func.count(
                        Track.id,
                    )
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
        ).scalar_one()
        or 0
    )

    if missing_identity_count == 0:
        artist_count = int(
            (
                await session.execute(
                    select(
                        func.count(
                            func.distinct(
                                TrackArtistCredit
                                .normalized_name,
                            )
                        )
                    )
                )
            ).scalar_one()
            or 0
        )

        duplicate_groups = (
            select(
                TrackIdentity.primary_artist_key,
                TrackIdentity.title_key,
            )
            .group_by(
                TrackIdentity.primary_artist_key,
                TrackIdentity.title_key,
            )
            .having(
                func.count(
                    TrackIdentity.track_id,
                )
                > 1
            )
            .subquery()
        )

        duplicate_group_count = int(
            (
                await session.execute(
                    select(
                        func.count(),
                    ).select_from(
                        duplicate_groups,
                    )
                )
            ).scalar_one()
            or 0
        )

    else:
        result = await session.execute(
            select(
                Track.title,
                Track.artist,
            )
        )

        groups: dict[
            tuple[str, str],
            int,
        ] = {}

        artist_keys: set[str] = set()

        for title, artist in result.all():
            (
                _artist_key,
                primary_artist_key,
                title_key,
            ) = track_identity_keys(
                title=title,
                artist=artist,
            )

            key = (
                primary_artist_key,
                title_key,
            )

            groups[key] = (
                groups.get(
                    key,
                    0,
                )
                + 1
            )

            for credit in split_artist_credits(
                artist,
            ):
                normalized_credit = (
                    normalize_track_identity(
                        credit,
                    )
                )

                if normalized_credit:
                    artist_keys.add(
                        normalized_credit,
                    )

        artist_count = len(
            artist_keys,
        )

        duplicate_group_count = sum(
            1
            for count in groups.values()
            if count > 1
        )

    try:
        # Diagnostics are read-only and must never roll back
        # or expire the caller's transaction. Isolate the
        # optional artist-profile query behind a savepoint so
        # compatibility/test databases that omit that table
        # can fail locally without poisoning the outer session.
        async with session.begin_nested():
            artist_profile_backfill_pending = int(
                (
                    await session.execute(
                        select(
                            func.count(
                                func.distinct(
                                    TrackArtistCredit.normalized_name,
                                )
                            )
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
                    )
                ).scalar_one()
                or 0
            )
    except OperationalError:
        # Compatibility/test databases may intentionally
        # contain only the media sidecar tables. The failed
        # savepoint is rolled back independently; the caller's
        # surrounding transaction remains intact.
        artist_profile_backfill_pending = 0

    return {
        "track_count":
            track_count,
        "artist_count":
            artist_count,
        "album_count":
            album_count,
        "artwork_count":
            artwork_count,
        "duplicate_groups":
            duplicate_group_count,
        "identity_backfill_pending":
            missing_identity_count,
        "artist_profile_backfill_pending":
            artist_profile_backfill_pending,
    }


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
