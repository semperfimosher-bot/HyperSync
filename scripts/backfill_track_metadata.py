from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import func, or_, select


REPO_ROOT = (
    Path(__file__)
    .resolve()
    .parents[1]
)

if str(REPO_ROOT) not in sys.path:
    sys.path.insert(
        0,
        str(REPO_ROOT),
    )


from backend.app.config import get_settings  # noqa: E402
from backend.app.database import (  # noqa: E402
    close_database,
    get_session_factory,
)
from backend.app.models.media import Track  # noqa: E402
from backend.app.services.generated_playlists import (  # noqa: E402
    refresh_smart_playlists_for_track,
)
from backend.app.services.music_metadata import (  # noqa: E402
    ExternalTrackMetadata,
    lookup_external_track_metadata,
)


DEFAULT_MIN_CONFIDENCE = 0.90


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Fill missing HyperSync track genre and "
            "release-year metadata using the same "
            "Last.fm -> Apple -> MusicBrainz provider "
            "chain used by new uploads."
        ),
    )

    parser.add_argument(
        "--dry-run",
        action="store_true",
        help=(
            "Look up and report metadata without "
            "writing anything to the database."
        ),
    )

    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help=(
            "Maximum tracks to process. 0 means every "
            "track still missing genre or release year."
        ),
    )

    parser.add_argument(
        "--min-confidence",
        type=float,
        default=DEFAULT_MIN_CONFIDENCE,
        help=(
            "Reject provider matches below this confidence "
            "(default: 0.90)."
        ),
    )

    parser.add_argument(
        "--skip-playlist-refresh",
        action="store_true",
        help=(
            "Do not refresh generated smart/genre playlists "
            "after a track's metadata changes."
        ),
    )

    parser.add_argument(
        "--allow-local",
        action="store_true",
        help=(
            "Allow running when DATABASE_URL is empty and "
            "HyperSync would use local_dev.db."
        ),
    )

    parser.add_argument(
        "--report",
        type=Path,
        default=None,
        help=(
            "JSONL report path. By default a timestamped "
            "file is created under storage/logs."
        ),
    )

    return parser


def missing_metadata(
    track: Track,
) -> bool:
    return (
        not (
            track.genre
            or ""
        ).strip()
        or track.release_year
        is None
    )


def acceptable_metadata(
    metadata: ExternalTrackMetadata | None,
    *,
    min_confidence: float,
) -> bool:
    if metadata is None:
        return False

    try:
        confidence = float(
            metadata.get(
                "confidence",
                0.0,
            )
            or 0.0
        )
    except (
        TypeError,
        ValueError,
    ):
        return False

    if confidence < min_confidence:
        return False

    return bool(
        metadata.get(
            "genre",
        )
        or metadata.get(
            "release_year",
        )
        is not None
    )


def apply_missing_metadata(
    track: Track,
    metadata: ExternalTrackMetadata,
) -> tuple[
    bool,
    bool,
    bool,
]:
    genre_changed = False
    year_changed = False

    if (
        not (
            track.genre
            or ""
        ).strip()
        and metadata.get(
            "genre",
        )
    ):
        track.genre = (
            str(
                metadata[
                    "genre"
                ]
            )
            .strip()[:120]
            or None
        )

        genre_changed = (
            track.genre
            is not None
        )

    if (
        track.release_year
        is None
        and metadata.get(
            "release_year",
        )
        is not None
    ):
        year = int(
            metadata[
                "release_year"
            ]
        )

        if 1900 <= year <= 2100:
            track.release_year = year
            year_changed = True

    return (
        genre_changed
        or year_changed,
        genre_changed,
        year_changed,
    )


def default_report_path() -> Path:
    stamp = (
        datetime.now(
            UTC,
        )
        .strftime(
            "%Y%m%d-%H%M%S",
        )
    )

    return (
        REPO_ROOT
        / "storage"
        / "logs"
        / (
            "metadata-backfill-"
            + stamp
            + ".jsonl"
        )
    )


def report_row(
    *,
    track: Track,
    status: str,
    old_genre: str | None,
    old_year: int | None,
    metadata: ExternalTrackMetadata | None,
    error: str | None = None,
) -> dict[str, Any]:
    return {
        "track_id":
            str(
                track.id,
            ),
        "title":
            track.title,
        "artist":
            track.artist,
        "album":
            track.album,
        "status":
            status,
        "old_genre":
            old_genre,
        "new_genre":
            track.genre,
        "old_release_year":
            old_year,
        "new_release_year":
            track.release_year,
        "provider_genre":
            (
                metadata.get(
                    "genre",
                )
                if metadata
                else None
            ),
        "provider_release_year":
            (
                metadata.get(
                    "release_year",
                )
                if metadata
                else None
            ),
        "source":
            (
                metadata.get(
                    "source",
                )
                if metadata
                else None
            ),
        "recording_id":
            (
                metadata.get(
                    "recording_id",
                )
                if metadata
                else None
            ),
        "confidence":
            (
                metadata.get(
                    "confidence",
                )
                if metadata
                else None
            ),
        "error":
            error,
    }


def write_report_line(
    handle,
    row: dict[str, Any],
) -> None:
    handle.write(
        json.dumps(
            row,
            ensure_ascii=False,
            default=str,
        )
        + "\n"
    )

    handle.flush()


async def run_backfill(
    args: argparse.Namespace,
) -> int:
    settings = get_settings()

    if (
        not settings.database_url
        .strip()
        and not args.allow_local
    ):
        print(
            "DATABASE_URL is empty. Refusing to modify "
            "local_dev.db by accident. Configure DATABASE_URL "
            "or pass --allow-local intentionally.",
            file=sys.stderr,
        )

        return 2

    if args.limit < 0:
        print(
            "--limit must be 0 or greater.",
            file=sys.stderr,
        )

        return 2

    if not (
        0.0
        <= args.min_confidence
        <= 1.0
    ):
        print(
            "--min-confidence must be between 0 and 1.",
            file=sys.stderr,
        )

        return 2

    report_path = (
        args.report
        if args.report is not None
        else default_report_path()
    )

    if not report_path.is_absolute():
        report_path = (
            REPO_ROOT
            / report_path
        )

    report_path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    session_factory = (
        get_session_factory()
    )

    async with session_factory() as session:
        statement = (
            select(
                Track,
            )
            .where(
                or_(
                    Track.genre.is_(
                        None,
                    ),
                    func.trim(
                        Track.genre,
                    )
                    == "",
                    Track.release_year
                    .is_(
                        None,
                    ),
                ),
            )
            .order_by(
                Track.created_at.asc(),
                Track.id.asc(),
            )
        )

        if args.limit > 0:
            statement = (
                statement.limit(
                    args.limit,
                )
            )

        result = await session.execute(
            statement,
        )

        tracks = list(
            result.scalars().all()
        )

        total = len(
            tracks,
        )

        print(
            (
                "HyperSync metadata backfill: "
                + str(
                    total,
                )
                + " track(s) need genre and/or release year."
            )
        )

        if args.dry_run:
            print(
                "DRY RUN: database writes are disabled.",
            )
        else:
            print(
                "APPLY MODE: only missing fields will be written.",
            )

        if (
            settings.lastfm_api_key
            .strip()
        ):
            print(
                "Providers: Last.fm -> Apple/iTunes -> MusicBrainz",
            )
        else:
            print(
                "Providers: Apple/iTunes -> MusicBrainz "
                "(LASTFM_API_KEY is not configured).",
            )

        print(
            "Report: "
            + str(
                report_path,
            )
        )

        stats = {
            "processed":
                0,
            "matched":
                0,
            "updated":
                0,
            "genre_updated":
                0,
            "year_updated":
                0,
            "unmatched":
                0,
            "low_confidence":
                0,
            "errors":
                0,
        }

        source_counts: dict[
            str,
            int,
        ] = {}

        with report_path.open(
            "a",
            encoding="utf-8",
        ) as report:
            for (
                index,
                track,
            ) in enumerate(
                tracks,
                start=1,
            ):
                old_genre = (
                    track.genre
                )

                old_year = (
                    track.release_year
                )

                metadata: (
                    ExternalTrackMetadata
                    | None
                ) = None

                try:
                    metadata = (
                        await lookup_external_track_metadata(
                            title=track.title,
                            artist=track.artist,
                            duration_seconds=(
                                track.duration_seconds
                            ),
                        )
                    )

                    stats[
                        "processed"
                    ] += 1

                    if metadata is None:
                        stats[
                            "unmatched"
                        ] += 1

                        status = (
                            "unmatched"
                        )

                    elif not acceptable_metadata(
                        metadata,
                        min_confidence=(
                            args.min_confidence
                        ),
                    ):
                        stats[
                            "low_confidence"
                        ] += 1

                        status = (
                            "low_confidence"
                        )

                    else:
                        stats[
                            "matched"
                        ] += 1

                        source = str(
                            metadata.get(
                                "source",
                                "unknown",
                            )
                        )

                        source_counts[
                            source
                        ] = (
                            source_counts.get(
                                source,
                                0,
                            )
                            + 1
                        )

                        (
                            changed,
                            genre_changed,
                            year_changed,
                        ) = (
                            apply_missing_metadata(
                                track,
                                metadata,
                            )
                        )

                        if changed:
                            status = (
                                "would_update"
                                if args.dry_run
                                else "updated"
                            )

                            stats[
                                "updated"
                            ] += 1

                            if genre_changed:
                                stats[
                                    "genre_updated"
                                ] += 1

                            if year_changed:
                                stats[
                                    "year_updated"
                                ] += 1

                            if args.dry_run:
                                track.genre = (
                                    old_genre
                                )

                                track.release_year = (
                                    old_year
                                )

                            else:
                                await session.commit()

                                if (
                                    not args
                                    .skip_playlist_refresh
                                ):
                                    try:
                                        await (
                                            refresh_smart_playlists_for_track(
                                                session,
                                                track,
                                            )
                                        )
                                    except Exception as exc:
                                        await session.rollback()

                                        write_report_line(
                                            report,
                                            {
                                                "type":
                                                    "playlist_refresh_error",
                                                "track_id":
                                                    str(
                                                        track.id,
                                                    ),
                                                "title":
                                                    track.title,
                                                "error":
                                                    str(
                                                        exc,
                                                    ),
                                            },
                                        )

                        else:
                            status = (
                                "matched_no_missing_value"
                            )

                    line = (
                        "["
                        + str(
                            index,
                        )
                        + "/"
                        + str(
                            total,
                        )
                        + "] "
                        + status.upper()
                        + " | "
                        + track.artist
                        + " - "
                        + track.title
                    )

                    if metadata:
                        line += (
                            " | "
                            + str(
                                metadata.get(
                                    "source",
                                    "",
                                )
                            )
                            + " "
                            + format(
                                float(
                                    metadata.get(
                                        "confidence",
                                        0.0,
                                    )
                                    or 0.0
                                ),
                                ".3f",
                            )
                        )

                    print(
                        line,
                        flush=True,
                    )

                    write_report_line(
                        report,
                        report_row(
                            track=track,
                            status=status,
                            old_genre=old_genre,
                            old_year=old_year,
                            metadata=metadata,
                        ),
                    )

                except KeyboardInterrupt:
                    print(
                        "\nInterrupted. Completed tracks are already safe; "
                        "run the command again to continue.",
                        file=sys.stderr,
                    )

                    return 130

                except Exception as exc:
                    await session.rollback()

                    stats[
                        "errors"
                    ] += 1

                    print(
                        (
                            "["
                            + str(
                                index,
                            )
                            + "/"
                            + str(
                                total,
                            )
                            + "] ERROR | "
                            + track.artist
                            + " - "
                            + track.title
                            + " | "
                            + str(
                                exc,
                            )
                        ),
                        file=sys.stderr,
                        flush=True,
                    )

                    write_report_line(
                        report,
                        report_row(
                            track=track,
                            status="error",
                            old_genre=old_genre,
                            old_year=old_year,
                            metadata=metadata,
                            error=str(
                                exc,
                            ),
                        ),
                    )

            write_report_line(
                report,
                {
                    "type":
                        "summary",
                    "finished_at":
                        datetime.now(
                            UTC,
                        ).isoformat(),
                    "dry_run":
                        bool(
                            args.dry_run,
                        ),
                    "stats":
                        stats,
                    "sources":
                        dict(
                            sorted(
                                source_counts.items(),
                            )
                        ),
                },
            )

        print("")
        print(
            "Backfill complete.",
        )

        print(
            json.dumps(
                {
                    **stats,
                    "sources":
                        dict(
                            sorted(
                                source_counts.items(),
                            )
                        ),
                },
                indent=2,
            )
        )

        print(
            "Report saved to: "
            + str(
                report_path,
            )
        )

        return (
            1
            if stats[
                "errors"
            ]
            else 0
        )


async def async_main() -> int:
    parser = build_parser()

    args = parser.parse_args()

    try:
        return await run_backfill(
            args,
        )
    finally:
        await close_database()


def main() -> None:
    raise SystemExit(
        asyncio.run(
            async_main(),
        )
    )


if __name__ == "__main__":
    main()
