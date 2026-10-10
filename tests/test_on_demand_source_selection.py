from backend.app.services.on_demand_ingestion import (
    is_allowed_artwork_url,
)
from backend.app.services.on_demand_metadata import (
    CatalogTrackCandidate,
)
from bot.youtube_source import (
    _candidate_deduplication_key,
    _source_search_queries,
    _search_ranked_candidates,
    is_allowed_direct_media_url,
    rank_source_candidates,
    score_source_candidate,
)


def _metadata(
    title: str = "Love Somebody",
) -> CatalogTrackCandidate:
    return CatalogTrackCandidate(
        key="music:test",
        title=title,
        artist="Morgan Wallen",
        album="One Thing at a Time",
        duration_seconds=204,
        artwork_url=None,
        genre="Country",
        release_year=2024,
        explicit=False,
        track_number=1,
        disc_number=1,
        isrc="USUG12400001",
        deezer_track_id="123",
        apple_track_id="456",
        provider="deezer+itunes",
        confidence=0.98,
    )


def test_source_ranking_prefers_clean_official_audio_over_live_and_remix() -> None:
    metadata = _metadata()

    entries = [
        {
            "id": "live",
            "title": "Morgan Wallen - Love Somebody (Live)",
            "uploader": "Fan Channel",
            "duration": 242,
            "view_count": 5_000_000,
        },
        {
            "id": "remix",
            "title": "Love Somebody Remix - Morgan Wallen",
            "uploader": "Remix Channel",
            "duration": 205,
            "view_count": 8_000_000,
        },
        {
            "id": "official",
            "title": "Morgan Wallen - Love Somebody (Official Audio)",
            "uploader": "Morgan Wallen - Topic",
            "duration": 204,
            "view_count": 1_000_000,
        },
    ]

    ranked = rank_source_candidates(
        entries,
        metadata,
    )

    assert ranked[0][1]["id"] == "official"

    assert ranked[0][0] > ranked[1][0]
    assert ranked[0][0] > 38


def test_requested_remix_is_not_penalized_as_an_unwanted_version() -> None:
    metadata = _metadata(
        "Love Somebody (Remix)",
    )

    remix = {
        "id": "remix",
        "title": "Morgan Wallen - Love Somebody Remix",
        "uploader": "Morgan Wallen",
        "duration": 204,
    }

    regular = {
        "id": "regular",
        "title": "Morgan Wallen - Love Somebody",
        "uploader": "Morgan Wallen - Topic",
        "duration": 204,
    }

    assert (
        score_source_candidate(
            remix,
            metadata,
        )
        >
        score_source_candidate(
            regular,
            metadata,
        )
    )


def test_temporary_media_url_only_allows_https_googlevideo_hosts() -> None:
    assert is_allowed_direct_media_url(
        "https://rr1---sn-example.googlevideo.com/videoplayback?id=abc"
    )

    assert not is_allowed_direct_media_url(
        "http://rr1---sn-example.googlevideo.com/videoplayback?id=abc"
    )

    assert not is_allowed_direct_media_url(
        "https://googlevideo.com.attacker.example/videoplayback"
    )

    assert not is_allowed_direct_media_url(
        "https://127.0.0.1/internal"
    )

    assert not is_allowed_direct_media_url(
        "https://example.com/audio"
    )


def test_artwork_urls_only_allow_deezer_and_itunes_cdn_hosts() -> None:
    assert is_allowed_artwork_url(
        "https://e-cdns-images.dzcdn.net/images/cover/example/500x500.jpg"
    )

    assert is_allowed_artwork_url(
        "https://is1-ssl.mzstatic.com/image/thumb/Music/example/600x600bb.jpg"
    )

    assert not is_allowed_artwork_url(
        "http://e-cdns-images.dzcdn.net/images/cover/example.jpg"
    )

    assert not is_allowed_artwork_url(
        "https://mzstatic.com.attacker.example/image.jpg"
    )

    assert not is_allowed_artwork_url(
        "https://127.0.0.1/internal"
    )


def test_source_search_queries_include_order_and_suffix_fallbacks() -> None:
    queries = _source_search_queries(
        _metadata(),
    )

    assert queries == (
        "Morgan Wallen Love Somebody official audio",
        "Love Somebody Morgan Wallen",
        "Morgan Wallen Love Somebody",
        "Love Somebody official audio",
    )



def test_source_search_continues_after_one_query_fails() -> None:
    attempted_queries: list[str] = []

    def search(metadata, *, query):
        attempted_queries.append(query)
        if len(attempted_queries) == 1:
            raise OSError("temporary upstream search failure")
        return [
            {
                "id": "official",
                "title": "Morgan Wallen - Love Somebody (Official Audio)",
                "uploader": "Morgan Wallen - Topic",
                "duration": 204,
                "view_count": 1_000_000,
            }
        ]

    ranked = _search_ranked_candidates(
        _metadata(),
        search=search,
    )

    assert len(attempted_queries) == 2
    assert ranked
    assert ranked[0][1]["id"] == "official"
    assert ranked[0][0] >= 65.0


def test_candidate_deduplication_key_uses_stable_ids_when_available() -> None:
    assert _candidate_deduplication_key({"id": "abc", "title": "ignored"}) == "abc"
    assert _candidate_deduplication_key({"webpage_url": "https://example.test"}) == "https://example.test"
    assert _candidate_deduplication_key({"url": "https://example.test/audio"}) == "https://example.test/audio"


def test_candidate_deduplication_key_separates_title_and_uploader() -> None:
    assert _candidate_deduplication_key(
        {"title": "Same", "uploader": "Artist"}
    ) == "Same" + chr(31) + "Artist"
    assert _candidate_deduplication_key(
        {"title": "Same", "channel": "Artist"}
    ) == "Same" + chr(31) + "Artist"
