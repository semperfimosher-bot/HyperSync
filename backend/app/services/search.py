from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime
from difflib import SequenceMatcher
from typing import Literal

SearchSortMode = Literal[
    "smart",
    "recent",
    "alphabetical",
    "artist",
]

SearchIntent = Literal[
    "general",
    "tracks_by_artist",
    "albums_by_artist",
    "people",
    "my_most_played",
    "recent",
    "top_artists",
    "top_albums",
    "new_releases",
]


SEARCH_SORT_MODES: tuple[
    SearchSortMode,
    ...,
] = (
    "smart",
    "recent",
    "alphabetical",
    "artist",
)

_FEATURED_ARTIST_PATTERN = re.compile(
    (
        r"\b"
        r"(?:feat(?:uring)?|ft)"
        r"\.?\s+"
        r"([^)\]\}]+)"
    ),
    flags=re.IGNORECASE,
)

_FEATURED_ARTIST_SPLIT_PATTERN = re.compile(
    (
        r"\s*"
        r"(?:,|&|\band\b|\bx\b)"
        r"\s*"
    ),
    flags=re.IGNORECASE,
)


@dataclass(frozen=True)
class ParsedSearch:
    raw: str
    term: str
    intent: SearchIntent

    field_hint: Literal[
        "any",
        "artist",
        "people",
    ] = "any"


@dataclass(frozen=True)
class MatchResult:
    score: int
    tier: int
    label: str
    field: str


def normalize_text(
    value: str | None,
) -> str:
    if not value:
        return ""

    return " ".join(value.casefold().split())


def extract_featured_artists(
    title: str | None,
) -> tuple[str, ...]:
    if not title:
        return ()

    found: list[str] = []
    seen: set[str] = set()

    for match in _FEATURED_ARTIST_PATTERN.finditer(
        title,
    ):
        credit = match.group(1).strip()

        names = _FEATURED_ARTIST_SPLIT_PATTERN.split(
            credit,
        )

        for name in names:
            cleaned = name.strip(" .()[]{}")

            normalized = normalize_text(
                cleaned,
            )

            if not normalized or normalized in seen:
                continue

            seen.add(
                normalized,
            )

            found.append(
                cleaned,
            )

    return tuple(
        found,
    )


def normalize_sort_mode(
    value: str | None,
) -> SearchSortMode:
    if value in SEARCH_SORT_MODES:
        return value

    return "smart"


def parse_search_query(
    query: str,
) -> ParsedSearch:
    raw = " ".join(query.strip().split())

    patterns: tuple[
        tuple[
            str,
            SearchIntent,
            str,
        ],
        ...,
    ] = (
        (
            r"^songs?\s+by\s+(.+)$",
            "tracks_by_artist",
            "artist",
        ),
        (
            r"^albums?\s+by\s+(.+)$",
            "albums_by_artist",
            "artist",
        ),
        (
            r"^@([^\s]+)$",
            "people",
            "people",
        ),
        (
            (
                r"^find\s+"
                r"(?:people|users?|person)$"
            ),
            "people",
            "people",
        ),
        (
            (
                r"^(?:people|users?|person)"
                r"\s+(?:named\s+)?(.+)$"
            ),
            "people",
            "people",
        ),
        (
            (
                r"^find\s+"
                r"(?:people|users?|person)"
                r"\s+(.+)$"
            ),
            "people",
            "people",
        ),
        (
            (
                r"^my\s+most\s+played"
                r"(?:\s+(.+))?$"
            ),
            "my_most_played",
            "any",
        ),
        (
            (
                r"^(?:recent|recently\s+played)"
                r"\s+songs?(?:\s+(.+))?$"
            ),
            "recent",
            "any",
        ),
        (
            r"^(?:my\s+)?top\s+artists?$",
            "top_artists",
            "any",
        ),
        (
            r"^(?:my\s+)?top\s+albums?$",
            "top_albums",
            "any",
        ),
        (
            (
                r"^(?:new\s+releases?"
                r"|new\s+music)$"
            ),
            "new_releases",
            "any",
        ),
    )

    for (
        pattern,
        intent,
        field_hint,
    ) in patterns:
        match = re.match(
            pattern,
            raw,
            flags=re.IGNORECASE,
        )

        if not match:
            continue

        term = (match.group(1) if match.lastindex else "") or ""

        return ParsedSearch(
            raw=raw,
            term=term.strip(),
            intent=intent,
            field_hint=field_hint,
        )

    return ParsedSearch(
        raw=raw,
        term=raw,
        intent="general",
        field_hint="any",
    )


def _score_value(
    value: str | None,
    term: str,
) -> tuple[
    int,
    int,
    str,
]:
    normalized_value = normalize_text(
        value,
    )

    normalized_term = normalize_text(
        term,
    )

    if not normalized_value or not normalized_term:
        return 0, 0, ""

    if normalized_value == normalized_term:
        return (
            1000,
            4,
            "EXACT MATCH",
        )

    if normalized_value.startswith(
        normalized_term,
    ):
        return (
            800,
            3,
            "STRONG MATCH",
        )

    if normalized_term in normalized_value:
        return (
            600,
            2,
            "MATCH",
        )

    similarities = [
        SequenceMatcher(
            None,
            normalized_term,
            normalized_value,
        ).ratio()
    ]

    value_words = normalized_value.split()

    term_words = normalized_term.split()

    if len(term_words) == 1:
        similarities.extend(
            SequenceMatcher(
                None,
                normalized_term,
                word,
            ).ratio()
            for word in value_words
        )

    elif len(value_words) >= len(term_words):
        window_size = len(
            term_words,
        )

        similarities.extend(
            SequenceMatcher(
                None,
                normalized_term,
                " ".join(value_words[index : index + window_size]),
            ).ratio()
            for index in range(len(value_words) - window_size + 1)
        )

    similarity = max(
        similarities,
    )

    if similarity >= 0.72:
        return (
            250 + int(similarity * 200),
            1,
            "CLOSE MATCH",
        )

    return 0, 0, ""


def score_track(
    title: str,
    artist: str,
    album: str | None,
    parsed: ParsedSearch,
) -> MatchResult:
    if not parsed.term:
        return MatchResult(
            score=1,
            tier=1,
            label="PERSONALIZED",
            field="history",
        )

    if parsed.field_hint == "artist":
        fields = (
            (
                "artist",
                artist,
                40,
            ),
        )

    else:
        fields = (
            (
                "title",
                title,
                60,
            ),
            (
                "artist",
                artist,
                40,
            ),
            (
                "album",
                album,
                20,
            ),
        )

    best = MatchResult(
        score=0,
        tier=0,
        label="",
        field="",
    )

    for (
        field,
        value,
        bonus,
    ) in fields:
        (
            score,
            tier,
            label,
        ) = _score_value(
            value,
            parsed.term,
        )

        if score <= 0:
            continue

        candidate = MatchResult(
            score=score + bonus,
            tier=tier,
            label=label,
            field=field,
        )

        if (
            candidate.tier,
            candidate.score,
        ) > (
            best.tier,
            best.score,
        ):
            best = candidate

    return best


def score_artist(
    artist: str,
    parsed: ParsedSearch,
) -> MatchResult:
    if not parsed.term:
        return MatchResult(
            score=0,
            tier=0,
            label="",
            field="",
        )

    (
        score,
        tier,
        label,
    ) = _score_value(
        artist,
        parsed.term,
    )

    if score <= 0:
        return MatchResult(
            score=0,
            tier=0,
            label="",
            field="",
        )

    return MatchResult(
        score=score + 40,
        tier=tier,
        label=label,
        field="artist",
    )


def score_album(
    album: str | None,
    parsed: ParsedSearch,
) -> MatchResult:
    if not parsed.term or not album:
        return MatchResult(
            score=0,
            tier=0,
            label="",
            field="",
        )

    (
        score,
        tier,
        label,
    ) = _score_value(
        album,
        parsed.term,
    )

    if score <= 0:
        return MatchResult(
            score=0,
            tier=0,
            label="",
            field="",
        )

    return MatchResult(
        score=score + 20,
        tier=tier,
        label=label,
        field="album",
    )


def score_person(
    username: str,
    display_name: str,
    parsed: ParsedSearch,
) -> MatchResult:
    if not parsed.term:
        return MatchResult(
            score=0,
            tier=0,
            label="",
            field="",
        )

    best = MatchResult(
        score=0,
        tier=0,
        label="",
        field="",
    )

    for (
        field,
        value,
        bonus,
    ) in (
        (
            "username",
            username,
            50,
        ),
        (
            "display_name",
            display_name,
            30,
        ),
    ):
        (
            score,
            tier,
            label,
        ) = _score_value(
            value,
            parsed.term,
        )

        if score <= 0:
            continue

        candidate = MatchResult(
            score=score + bonus,
            tier=tier,
            label=label,
            field=field,
        )

        if (
            candidate.tier,
            candidate.score,
        ) > (
            best.tier,
            best.score,
        ):
            best = candidate

    return best


def _timestamp(
    value: datetime | None,
) -> float:
    if value is None:
        return -1.0

    if value.tzinfo is None:
        value = value.replace(
            tzinfo=UTC,
        )

    return value.timestamp()


def sort_track_rows(
    rows: list[dict],
    mode: SearchSortMode,
    intent: SearchIntent,
) -> list[dict]:
    if intent == "new_releases":
        return sorted(
            rows,
            key=lambda row: (
                -_timestamp(
                    row.get(
                        "created_at",
                    )
                ),
                str(
                    row.get(
                        "title",
                        "",
                    )
                ).casefold(),
                str(
                    row.get(
                        "artist",
                        "",
                    )
                ).casefold(),
            ),
        )

    if intent == "my_most_played":
        return sorted(
            rows,
            key=lambda row: (
                -int(
                    row.get(
                        "user_play_count",
                        0,
                    )
                ),
                -int(
                    row.get(
                        "match_tier",
                        0,
                    )
                ),
                -int(
                    row.get(
                        "match_score",
                        0,
                    )
                ),
                str(
                    row.get(
                        "title",
                        "",
                    )
                ).casefold(),
            ),
        )

    if intent == "recent":
        mode = "recent"

    if mode == "recent":
        return sorted(
            rows,
            key=lambda row: (
                (
                    row.get(
                        "last_played_at",
                    )
                    is None
                ),
                -_timestamp(
                    row.get(
                        "last_played_at",
                    )
                ),
                -int(
                    row.get(
                        "match_tier",
                        0,
                    )
                ),
                -int(
                    row.get(
                        "match_score",
                        0,
                    )
                ),
                str(
                    row.get(
                        "title",
                        "",
                    )
                ).casefold(),
            ),
        )

    if mode == "alphabetical":
        return sorted(
            rows,
            key=lambda row: (
                str(
                    row.get(
                        "title",
                        "",
                    )
                ).casefold(),
                str(
                    row.get(
                        "artist",
                        "",
                    )
                ).casefold(),
            ),
        )

    if mode == "artist":
        return sorted(
            rows,
            key=lambda row: (
                str(
                    row.get(
                        "artist",
                        "",
                    )
                ).casefold(),
                str(
                    row.get(
                        "title",
                        "",
                    )
                ).casefold(),
            ),
        )

    def smart_score(
        row: dict,
    ) -> float:
        personal_boost = (
            min(
                int(
                    row.get(
                        "user_play_count",
                        0,
                    )
                ),
                50,
            )
            * 3
        )

        popularity_boost = (
            min(
                int(
                    row.get(
                        "global_play_count",
                        0,
                    )
                ),
                100,
            )
            * 0.5
        )

        return (
            int(
                row.get(
                    "match_score",
                    0,
                )
            )
            + personal_boost
            + popularity_boost
        )

    return sorted(
        rows,
        key=lambda row: (
            -int(
                row.get(
                    "match_tier",
                    0,
                )
            ),
            -smart_score(
                row,
            ),
            str(
                row.get(
                    "title",
                    "",
                )
            ).casefold(),
        ),
    )
