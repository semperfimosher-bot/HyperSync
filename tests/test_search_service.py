from datetime import UTC, datetime

import pytest

from backend.app.services.search import (
    parse_search_query,
    score_person,
    score_track,
    sort_track_rows,
)


def test_find_people_command_opens_people_directory():
    parsed = parse_search_query(
        "find people",
    )

    assert (
        parsed.intent
        == "people"
    )

    assert parsed.term == ""

    assert (
        parsed.field_hint
        == "people"
    )


@pytest.mark.parametrize(
    (
        "query",
        "expected_intent",
    ),
    [
        (
            "my most played",
            "my_most_played",
        ),
        (
            "recent songs",
            "recent",
        ),
        (
            "top artists",
            "top_artists",
        ),
        (
            "my top artists",
            "top_artists",
        ),
        (
            "top albums",
            "top_albums",
        ),
        (
            "my top albums",
            "top_albums",
        ),
        (
            "new releases",
            "new_releases",
        ),
        (
            "new music",
            "new_releases",
        ),
    ],
)
def test_shortcut_commands_parse_to_real_intents(
    query,
    expected_intent,
):
    parsed = parse_search_query(
        query,
    )

    assert (
        parsed.intent
        == expected_intent
    )

    assert parsed.term == ""


def test_new_releases_sort_newest_first():
    rows = [
        {
            "title": (
                "A Older Track"
            ),
            "artist": (
                "Artist A"
            ),
            "created_at": datetime(
                2026,
                1,
                1,
                tzinfo=UTC,
            ),
        },
        {
            "title": (
                "Z Newer Track"
            ),
            "artist": (
                "Artist B"
            ),
            "created_at": datetime(
                2026,
                8,
                1,
                tzinfo=UTC,
            ),
        },
    ]

    ordered = sort_track_rows(
        rows,
        "smart",
        "new_releases",
    )

    assert [
        row["title"]
        for row in ordered
    ] == [
        "Z Newer Track",
        "A Older Track",
    ]


def test_plain_query_remains_general() -> None:
    parsed = parse_search_query(
        "shane",
    )

    assert (
        parsed.intent
        == "general"
    )

    assert (
        parsed.field_hint
        == "any"
    )

    assert (
        parsed.term
        == "shane"
    )


@pytest.mark.parametrize(
    (
        "query",
        "expected_term",
    ),
    [
        (
            "@shane",
            "shane",
        ),
        (
            "people shane",
            "shane",
        ),
        (
            "people named shane",
            "shane",
        ),
        (
            "person shane",
            "shane",
        ),
        (
            "user shane",
            "shane",
        ),
        (
            "users shane",
            "shane",
        ),
        (
            "find user shane",
            "shane",
        ),
        (
            "find person shane",
            "shane",
        ),
        (
            "find people shane",
            "shane",
        ),
    ],
)
def test_people_query_shortcuts(
    query: str,
    expected_term: str,
) -> None:
    parsed = parse_search_query(
        query,
    )

    assert (
        parsed.intent
        == "people"
    )

    assert (
        parsed.field_hint
        == "people"
    )

    assert (
        parsed.term
        == expected_term
    )


def test_unrelated_person_scores_zero() -> None:
    parsed = parse_search_query(
        "people shane",
    )

    match = score_person(
        "alex",
        "Alex Chen",
        parsed,
    )

    assert match.score == 0
    assert match.tier == 0
    assert match.label == ""


def test_exact_username_beats_prefix_match() -> None:
    parsed = parse_search_query(
        "people shane",
    )

    exact = score_person(
        "shane",
        "Someone Else",
        parsed,
    )

    prefix = score_person(
        "shanemusic",
        "Shane Music",
        parsed,
    )

    assert (
        exact.tier,
        exact.score,
    ) > (
        prefix.tier,
        prefix.score,
    )


def test_typo_matches_word_inside_display_name() -> None:
    parsed = parse_search_query(
        "shnae",
    )

    match = score_person(
        "totallydifferent",
        "Shane Mosher",
        parsed,
    )

    assert match.score > 0

    assert (
        match.tier
        == 1
    )

    assert (
        match.label
        == "CLOSE MATCH"
    )


def test_typo_matches_word_inside_track_fields() -> None:
    parsed = parse_search_query(
        "shnae",
    )

    match = score_track(
        "The Shane Signal",
        "HyperSync Artist",
        "Test Album",
        parsed,
    )

    assert match.score > 0

    assert (
        match.tier
        == 1
    )

    assert (
        match.label
        == "CLOSE MATCH"
    )
    