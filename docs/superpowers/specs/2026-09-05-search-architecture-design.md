# HyperSync Search Architecture Design

## Goal

Make HyperSync search fast, typo-tolerant, predictable, and maintainable for the expected long-term scale of up to roughly 100,000 tracks and 100,000 users, without introducing a separate search engine.

## Chosen Architecture

HyperSync will keep Neon PostgreSQL as the single source of truth and use PostgreSQL's `pg_trgm` extension for indexed substring and fuzzy candidate retrieval. FastAPI's existing `/api/search` endpoint remains the permanent frontend boundary. Python relevance scoring only ranks a bounded candidate set returned by PostgreSQL; it must never scan tens of thousands of tracks or users in application memory.

No Meilisearch, Elasticsearch/OpenSearch, Algolia, or Redis Search service is introduced for this scale.

## Search Scope

A normal query searches music and people together.

Examples:

- `shane` searches tracks, artists/albums derived from matching tracks, and people.
- `post` searches music and people.
- `@shane` searches people only.
- `people shane` searches people only.
- `user shane` searches people only.
- `songs by Post Malone` searches tracks by artist only.
- `albums by Post Malone` searches album-oriented music results only.
- `my most played` and `recent songs` remain history commands and do not search people.

## Searchable Fields

Music candidate retrieval searches:

- `tracks.title`
- `tracks.artist`
- `tracks.album`

People candidate retrieval searches:

- `users.username`
- `users.username_normalized`
- `user_profiles.display_name`

Only active users are searchable. Only published tracks are searchable.

## Database Indexing

Add one Alembic migration after the current migration head.

The migration will:

1. Enable `pg_trgm` with `CREATE EXTENSION IF NOT EXISTS pg_trgm`.
2. Add GIN trigram indexes for `tracks.title`, `tracks.artist`, `tracks.album`, `users.username`, `users.username_normalized`, and `user_profiles.display_name`.
3. Use partial indexes where practical for published tracks and active/registered users only if the generated SQL remains simple and portable across Neon/PostgreSQL. If partial-index complexity adds uncertainty, prefer plain trigram indexes and keep `is_published` / `is_active` predicates in the query.

SQLite local development must continue to work. PostgreSQL-specific similarity retrieval must therefore be isolated so tests using SQLite can exercise the pure parser/ranker without requiring `pg_trgm`.

## Candidate Retrieval

The database narrows the candidate set before Python ranks anything.

Recommended limits:

- Track candidate limit: 80
- Track result limit: 40
- People candidate limit: 40
- People result limit: 20

These are deliberately small enough to keep ranking and play-count enrichment cheap while providing enough headroom for good relevance.

For query lengths:

- 0 characters: return no normal search results.
- 1 character: exact/prefix-oriented matching only; no fuzzy trigram similarity.
- 2 characters: prefix/contains matching with strict limits; no broad fuzzy fallback.
- 3+ characters: indexed substring and trigram similarity candidate retrieval are allowed.

Candidate retrieval must not use "newest N records" as a fuzzy-search strategy.

## Relevance Ranking

Ranking priority is deterministic:

1. Exact normalized match.
2. Prefix match.
3. Whole-word or substring match.
4. Fuzzy/typo match.
5. Personal listening and popularity tie-breakers for tracks.
6. Followers only as a final tie-breaker for people.

Popularity must never outrank a meaningfully stronger textual match.

Examples:

- Query `shane`: `@shane` ranks ahead of `@shanemusic`, which ranks ahead of `Shane Mosher`, which ranks ahead of a fuzzy typo-only match.
- Query `shnae`: a person or track containing `shane` may appear as a close match, but unrelated users must receive a zero score.

## Person Scoring Bug Fix

`score_person()` currently adds username/display-name bonuses even when the underlying text-match score is zero. The implementation must skip bonus application when the base score is zero, matching the existing `score_track()` behavior.

## Parser Changes

`parse_search_query()` will recognize explicit people forms while preserving current music/history commands.

Supported explicit people forms:

- `@username`
- `people username-or-name`
- `people named username-or-name`
- `person username-or-name`
- `user username-or-name`
- `users username-or-name`
- `find user username-or-name`
- `find person username-or-name`
- `find people username-or-name`

A plain query such as `shane` remains `general` intent so music and people are searched together.

## Unified API Behavior

`GET /api/search` remains the only Search-page endpoint.

For `general` intent:

- Build bounded music candidates.
- Build bounded people candidates in the same request.
- Return both categories when both have matches.

For `people` intent:

- Skip track candidate retrieval.
- Search people only.

For music-specific/history intents:

- Keep current music behavior.
- Do not search people.

The response model remains compatible with the existing `SearchPage.jsx`: `tracks`, `artists`, `albums`, `people`, `counts`, and `processing_ms` remain present.

## Artists and Albums

Artists and albums will continue to be derived from the returned matching track set for this iteration. This avoids introducing separate canonical artist/album tables that the current data model does not have.

Because derivation happens from a bounded track-result set, artist/album counts represent returned search results, not necessarily exhaustive global catalog counts.

## Personalization

Existing per-user play-count and recent-listening boosts remain supported for track ranking. They should be applied only after textual relevance tier, so a weak textual match cannot beat an exact match solely because the user played it often.

## Error and Fallback Behavior

If PostgreSQL trigram functionality is unavailable unexpectedly in production, search should fail clearly rather than silently scanning the full catalog in Python.

Local SQLite development should use the existing direct `ILIKE`/case-insensitive-compatible code path with strict limits and pure Python scoring. SQLite is for local/test compatibility, not production-performance parity.

## Frontend

No Search-page visual redesign is part of this work. The existing `frontend/src/components/pages/SearchPage.jsx`, `frontend/src/searchApi.js`, and the newly redesigned `search.css` remain API-compatible.

The current 220 ms frontend debounce and stale-request cancellation remain unchanged.

## Testing Strategy

Use TDD.

Tests must cover:

- unrelated people score zero;
- exact username beats prefix/contains/fuzzy people matches;
- `@shane` is people intent with term `shane`;
- `people shane`, `user shane`, and `find user shane` parse as people intent;
- plain `shane` remains general intent;
- a general query returns both a matching track and a matching person;
- music-specific commands do not return people;
- people-specific commands do not return tracks;
- typo matching can recover a close person/track candidate for 3+ character input;
- result counts respect hard limits;
- existing search preference/history behavior remains green.

PostgreSQL-specific index migration structure should be covered by migration/verification checks already used by the project. Pure ranking/parser tests should not require a live Neon database.

## Files Expected to Change

- `migrations/versions/<new_search_indexes_migration>.py`
- `backend/app/services/search.py`
- `backend/app/api/routes/search.py`
- `tests/test_search_relevance.py`
- optionally a focused `tests/test_search_service.py` if keeping parser/scoring unit tests separate makes the suite clearer

No frontend files are expected to change for functionality.

## Verification

After implementation:

1. Run focused search tests.
2. Run Ruff check/format.
3. Run the full pytest suite with warnings as errors.
4. Run the repository's existing project verifier.
5. Apply Alembic migration to the configured Neon migration database.
6. Confirm the live Neon schema revision and search behavior.

## Non-Goals

This iteration does not add:

- a dedicated search engine;
- semantic/vector search;
- lyrics-content search;
- a canonical artist or album table;
- search analytics infrastructure;
- background indexing workers;
- frontend redesign work.
