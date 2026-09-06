# HyperSync Search Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make HyperSync search fast, bounded, typo-tolerant, and capable of returning music and people together for a normal query such as `shane`.

**Architecture:** Neon PostgreSQL remains the source of truth. PostgreSQL `pg_trgm` GIN indexes narrow track/person candidates to small bounded sets; Python then applies HyperSync's deterministic relevance scoring. SQLite keeps a bounded compatibility fallback for local tests/development.

**Tech Stack:** FastAPI, SQLAlchemy asyncio, PostgreSQL/Neon, Alembic, `pg_trgm`, pytest.

**Spec:** `docs/superpowers/specs/2026-09-05-search-architecture-design.md`

## Global Constraints

- Expected long-term scale: roughly 100,000 tracks and 100,000 users.
- Keep `GET /api/search` as the frontend boundary.
- Keep the existing SearchPage JSX/CSS/API response shape unchanged.
- Normal `general` queries search music and people together.
- Explicit people queries skip tracks.
- Music/history commands skip people.
- Never scan the full production catalog/users in Python.
- Track candidates: 80; track results: 40.
- People candidates: 40; people results: 20.
- Fuzzy database matching begins at 3 characters.
- Exact/prefix/contains textual relevance outranks popularity/personalization.
- Use TDD: write and observe failing tests before production changes.

---

### Task 1: Add parser and scoring regression tests

**Files:**
- Create: `tests/test_search_service.py`
- Modify later: `backend/app/services/search.py`

**Interfaces:**
- Consumes: `parse_search_query`, `score_person`, `score_track` from `backend.app.services.search`.
- Produces: executable expectations for parser intent and relevance scoring.

- [ ] **Step 1: Create `tests/test_search_service.py` with this exact content**

```python
import pytest

from backend.app.services.search import (
    parse_search_query,
    score_person,
    score_track,
)


def test_plain_query_remains_general() -> None:
    parsed = parse_search_query("shane")

    assert parsed.intent == "general"
    assert parsed.field_hint == "any"
    assert parsed.term == "shane"


@pytest.mark.parametrize(
    ("query", "expected_term"),
    [
        ("@shane", "shane"),
        ("people shane", "shane"),
        ("people named shane", "shane"),
        ("person shane", "shane"),
        ("user shane", "shane"),
        ("users shane", "shane"),
        ("find user shane", "shane"),
        ("find person shane", "shane"),
        ("find people shane", "shane"),
    ],
)
def test_people_query_shortcuts(
    query: str,
    expected_term: str,
) -> None:
    parsed = parse_search_query(query)

    assert parsed.intent == "people"
    assert parsed.field_hint == "people"
    assert parsed.term == expected_term


def test_unrelated_person_scores_zero() -> None:
    parsed = parse_search_query("people shane")

    match = score_person(
        "alex",
        "Alex Chen",
        parsed,
    )

    assert match.score == 0
    assert match.tier == 0
    assert match.label == ""


def test_exact_username_beats_prefix_match() -> None:
    parsed = parse_search_query("people shane")

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

    assert (exact.tier, exact.score) > (
        prefix.tier,
        prefix.score,
    )


def test_typo_matches_word_inside_display_name() -> None:
    parsed = parse_search_query("shnae")

    match = score_person(
        "totallydifferent",
        "Shane Mosher",
        parsed,
    )

    assert match.score > 0
    assert match.tier == 1
    assert match.label == "CLOSE MATCH"


def test_typo_matches_word_inside_track_fields() -> None:
    parsed = parse_search_query("shnae")

    match = score_track(
        "The Shane Signal",
        "HyperSync Artist",
        "Test Album",
        parsed,
    )

    assert match.score > 0
    assert match.tier == 1
    assert match.label == "CLOSE MATCH"
```

- [ ] **Step 2: Run the new tests and verify RED**

Run from the repository root:

```powershell
python -m pytest tests/test_search_service.py -q -W error
```

Expected: FAIL. The current parser does not understand `@shane`/`people shane`/`user shane`, unrelated people receive a positive bonus score, and typo matching against a word inside a longer field is too weak.

---

### Task 2: Fix parser and text scoring

**Files:**
- Modify: `backend/app/services/search.py`
- Test: `tests/test_search_service.py`

**Interfaces:**
- Produces: unchanged public signatures for `parse_search_query`, `score_person`, and `score_track`.
- Parser adds explicit people command forms while plain text remains `general`.

- [ ] **Step 1: Replace the current `people named` pattern inside `parse_search_query()`**

Find this block:

```python
        (
            r"^people\\s+named\\s+(.+)$",
            "people",
            "people",
        ),
```

Replace it with:

```python
        (
            r"^@([^\\s]+)$",
            "people",
            "people",
        ),
        (
            (
                r"^(?:people|users?|person)"
                r"\\s+(?:named\\s+)?(.+)$"
            ),
            "people",
            "people",
        ),
        (
            (
                r"^find\\s+"
                r"(?:people|users?|person)"
                r"\\s+(.+)$"
            ),
            "people",
            "people",
        ),
```

- [ ] **Step 2: Make `_score_value()` token-aware for typo matching**

Inside `_score_value()`, find the current block:

```python
    similarity = SequenceMatcher(
        None,
        normalized_term,
        normalized_value,
    ).ratio()

    if similarity >= 0.72:
        return (
            250 + int(similarity * 200),
            1,
            "CLOSE MATCH",
        )
```

Replace it with:

```python
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
        window_size = len(term_words)

        similarities.extend(
            SequenceMatcher(
                None,
                normalized_term,
                " ".join(
                    value_words[
                        index : index + window_size
                    ]
                ),
            ).ratio()
            for index in range(
                len(value_words) - window_size + 1
            )
        )

    similarity = max(similarities)

    if similarity >= 0.72:
        return (
            250 + int(similarity * 200),
            1,
            "CLOSE MATCH",
        )
```

- [ ] **Step 3: Fix the person bonus bug**

Inside `score_person()`, immediately after this existing call:

```python
        ) = _score_value(
            value,
            parsed.term,
        )
```

insert:

```python
        if score <= 0:
            continue
```

The following `candidate = MatchResult(...)` block must stay after this guard.

- [ ] **Step 4: Run the service tests and verify GREEN**

```powershell
python -m pytest tests/test_search_service.py -q -W error
```

Expected: PASS.

---

### Task 3: Change integration expectations to normal music + people search

**Files:**
- Replace: `tests/test_search_relevance.py`
- Modify later: `backend/app/api/routes/search.py`

**Interfaces:**
- Produces: API behavior tests for general search, explicit people search, and music-specific commands.

- [ ] **Step 1: Replace all of `tests/test_search_relevance.py` with this exact content**

```python
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient

from backend.app.database import get_session_factory
from backend.app.main import app
from backend.app.models.account import (
    User,
    UserProfile,
)
from backend.app.models.media import Track
from backend.app.security.passwords import (
    hash_password,
)


async def _add_registered_user(
    session,
    *,
    username: str,
    display_name: str,
) -> User:
    user = User(
        id=uuid4(),
        username=username,
        username_normalized=username.casefold(),
        email=f"{username}@example.com",
        password_hash=hash_password(
            "search-test-pass",
        ),
        account_type="registered",
        is_active=True,
    )

    session.add(user)
    await session.flush()

    session.add(
        UserProfile(
            user_id=user.id,
            display_name=display_name,
            bio="Search relevance test profile",
            is_public=True,
        )
    )

    return user


@pytest.mark.asyncio
async def test_general_search_returns_music_and_people() -> None:
    run_id = uuid4().hex[:8]

    query = f"Signal {run_id}"
    username = f"listener-{run_id}"

    session_factory = get_session_factory()

    async with session_factory() as session:
        await _add_registered_user(
            session,
            username=username,
            display_name=f"{query} Listener",
        )

        session.add(
            Track(
                id=uuid4(),
                title=query,
                artist="HyperSync Test Artist",
                album="Search Test Album",
                b2_object_key=(
                    f"audio/search-relevance-{run_id}.mp3"
                ),
                mime_type="audio/mpeg",
                file_size=4096,
                duration_seconds=180,
                is_published=True,
            )
        )

        await session.commit()

    transport = ASGITransport(
        app=app,
    )

    async with AsyncClient(
        transport=transport,
        base_url="http://test",
    ) as client:
        response = await client.get(
            "/api/search",
            params={
                "q": query,
                "sort": "smart",
            },
        )

    assert response.status_code == 200, response.text

    payload = response.json()

    assert any(
        track["title"] == query
        for track in payload["tracks"]
    )

    assert any(
        person["username"] == username
        for person in payload["people"]
    )


@pytest.mark.asyncio
async def test_explicit_people_search_returns_people_only() -> None:
    run_id = uuid4().hex[:8]

    display_name = f"Person {run_id}"
    username = f"person-{run_id}"

    session_factory = get_session_factory()

    async with session_factory() as session:
        await _add_registered_user(
            session,
            username=username,
            display_name=display_name,
        )

        session.add(
            Track(
                id=uuid4(),
                title=display_name,
                artist="People Intent Test",
                album="People Intent Album",
                b2_object_key=(
                    f"audio/people-intent-{run_id}.mp3"
                ),
                mime_type="audio/mpeg",
                file_size=4096,
                duration_seconds=180,
                is_published=True,
            )
        )

        await session.commit()

    transport = ASGITransport(
        app=app,
    )

    async with AsyncClient(
        transport=transport,
        base_url="http://test",
    ) as client:
        response = await client.get(
            "/api/search",
            params={
                "q": f"people {display_name}",
                "sort": "smart",
            },
        )

    assert response.status_code == 200, response.text

    payload = response.json()

    assert payload["tracks"] == []

    assert any(
        person["username"] == username
        for person in payload["people"]
    )


@pytest.mark.asyncio
async def test_music_specific_search_does_not_return_people() -> None:
    run_id = uuid4().hex[:8]

    artist_name = f"Artist {run_id}"
    username = f"artist-person-{run_id}"

    session_factory = get_session_factory()

    async with session_factory() as session:
        await _add_registered_user(
            session,
            username=username,
            display_name=artist_name,
        )

        session.add(
            Track(
                id=uuid4(),
                title=f"Song {run_id}",
                artist=artist_name,
                album="Music Intent Album",
                b2_object_key=(
                    f"audio/music-intent-{run_id}.mp3"
                ),
                mime_type="audio/mpeg",
                file_size=4096,
                duration_seconds=180,
                is_published=True,
            )
        )

        await session.commit()

    transport = ASGITransport(
        app=app,
    )

    async with AsyncClient(
        transport=transport,
        base_url="http://test",
    ) as client:
        response = await client.get(
            "/api/search",
            params={
                "q": f"songs by {artist_name}",
                "sort": "smart",
            },
        )

    assert response.status_code == 200, response.text

    payload = response.json()

    assert any(
        track["artist"] == artist_name
        for track in payload["tracks"]
    )

    assert payload["people"] == []
```

- [ ] **Step 2: Run the integration tests and verify RED**

```powershell
python -m pytest tests/test_search_relevance.py -q -W error
```

Expected: at minimum `test_general_search_returns_music_and_people` FAILS because the current route hides People whenever a general query already found tracks.

---

### Task 4: Add PostgreSQL trigram indexes

**Files:**
- Create: `migrations/versions/e7a1c4d9b2f6_add_search_trigram_indexes.py`

**Interfaces:**
- Revises current head `b6e8d4a1c9f2`.
- Enables `pg_trgm` and creates six GIN indexes.
- Becomes a no-op schema change on SQLite while still allowing Alembic revision advancement.

- [ ] **Step 1: Create the migration with this exact content**

```python
"""add search trigram indexes

Revision ID: e7a1c4d9b2f6
Revises: b6e8d4a1c9f2
"""

from collections.abc import Sequence

from alembic import op

revision: str = "e7a1c4d9b2f6"

down_revision: str | Sequence[str] | None = "b6e8d4a1c9f2"

branch_labels: str | Sequence[str] | None = None

depends_on: str | Sequence[str] | None = None


TRACK_INDEXES = (
    ("ix_tracks_title_trgm", "title"),
    ("ix_tracks_artist_trgm", "artist"),
    ("ix_tracks_album_trgm", "album"),
)

USER_INDEXES = (
    ("ix_users_username_trgm", "username"),
    (
        "ix_users_username_normalized_trgm",
        "username_normalized",
    ),
)

PROFILE_INDEXES = (
    (
        "ix_user_profiles_display_name_trgm",
        "display_name",
    ),
)


def upgrade() -> None:
    bind = op.get_bind()

    if bind.dialect.name != "postgresql":
        return

    op.execute(
        "CREATE EXTENSION IF NOT EXISTS pg_trgm"
    )

    for index_name, column_name in TRACK_INDEXES:
        op.create_index(
            index_name,
            "tracks",
            [column_name],
            unique=False,
            postgresql_using="gin",
            postgresql_ops={
                column_name: "gin_trgm_ops",
            },
        )

    for index_name, column_name in USER_INDEXES:
        op.create_index(
            index_name,
            "users",
            [column_name],
            unique=False,
            postgresql_using="gin",
            postgresql_ops={
                column_name: "gin_trgm_ops",
            },
        )

    for index_name, column_name in PROFILE_INDEXES:
        op.create_index(
            index_name,
            "user_profiles",
            [column_name],
            unique=False,
            postgresql_using="gin",
            postgresql_ops={
                column_name: "gin_trgm_ops",
            },
        )


def downgrade() -> None:
    bind = op.get_bind()

    if bind.dialect.name != "postgresql":
        return

    for index_name, _ in reversed(PROFILE_INDEXES):
        op.drop_index(
            index_name,
            table_name="user_profiles",
        )

    for index_name, _ in reversed(USER_INDEXES):
        op.drop_index(
            index_name,
            table_name="users",
        )

    for index_name, _ in reversed(TRACK_INDEXES):
        op.drop_index(
            index_name,
            table_name="tracks",
        )
```

Do not drop the `pg_trgm` extension in `downgrade()` because another future feature may share it.

- [ ] **Step 2: Verify the Alembic graph before touching the live database**

```powershell
python -m alembic heads
```

Expected:

```text
e7a1c4d9b2f6 (head)
```

---

### Task 5: Replace unbounded/newest-N candidate search with bounded indexed retrieval

**Files:**
- Modify: `backend/app/api/routes/search.py`
- Test: `tests/test_search_relevance.py`

**Interfaces:**
- Track candidate cap: 80, final track cap: 40.
- People candidate cap: 40, final people cap: 20.
- PostgreSQL 3+ character queries use `ILIKE`, trigram similarity `%`, and word-similarity `<%` predicates.
- SQLite uses direct bounded `ILIKE` plus a small bounded Python-scoring fallback for 3+ character typos.

- [ ] **Step 1: Add `literal` to the SQLAlchemy imports**

Find:

```python
from sqlalchemy import (
    func,
    or_,
    select,
)
```

Replace with:

```python
from sqlalchemy import (
    func,
    literal,
    or_,
    select,
)
```

- [ ] **Step 2: Replace the candidate constants**

Find:

```python
FUZZY_TRACK_CANDIDATE_LIMIT = 1200
FUZZY_PEOPLE_CANDIDATE_LIMIT = 200
HISTORY_COMMAND_LIMIT = 100
```

Replace with:

```python
TRACK_CANDIDATE_LIMIT = 80
TRACK_RESULT_LIMIT = 40
PEOPLE_CANDIDATE_LIMIT = 40
PEOPLE_RESULT_LIMIT = 20
HISTORY_COMMAND_LIMIT = 100
```

- [ ] **Step 3: Add a database-dialect helper immediately before `_load_track_candidates()`**

```python
def _is_postgresql(
    session: AsyncSession,
) -> bool:
    return (
        session.get_bind().dialect.name
        == "postgresql"
    )
```

- [ ] **Step 4: Replace the entire `_load_track_candidates()` function with this code**

```python
async def _load_track_candidates(
    session: AsyncSession,
    parsed: ParsedSearch,
    user: User | None,
) -> list[Track]:
    if parsed.intent == "people":
        return []

    if (
        parsed.intent
        in {
            "my_most_played",
            "recent",
        }
        and not parsed.term
    ):
        if user is None:
            return []

        track_ids = await _load_history_track_ids(
            session,
            user,
            parsed.intent,
        )

        if not track_ids:
            return []

        result = await session.execute(
            select(Track).where(
                Track.id.in_(
                    track_ids,
                ),
                Track.is_published.is_(
                    True,
                ),
            )
        )

        by_id = {
            track.id: track
            for track in result.scalars().all()
        }

        return [
            by_id[track_id]
            for track_id in track_ids
            if track_id in by_id
        ]

    term = parsed.term.strip()

    if not term:
        return []

    prefix_pattern = f"{term}%"
    contains_pattern = f"%{term}%"

    stmt = select(Track).where(
        Track.is_published.is_(True),
    )

    fields = (
        (Track.artist,)
        if parsed.field_hint == "artist"
        else (
            Track.title,
            Track.artist,
            Track.album,
        )
    )

    if (
        _is_postgresql(session)
        and len(term) >= 3
    ):
        query_literal = literal(term)

        candidate_conditions = []
        similarity_scores = []

        for field in fields:
            candidate_conditions.extend(
                [
                    field.ilike(
                        contains_pattern,
                    ),
                    field.op("%")(term),
                    query_literal.op("<%")(field),
                ]
            )

            similarity_scores.extend(
                [
                    func.coalesce(
                        func.similarity(
                            field,
                            term,
                        ),
                        0.0,
                    ),
                    func.coalesce(
                        func.word_similarity(
                            term,
                            field,
                        ),
                        0.0,
                    ),
                ]
            )

        best_similarity = func.greatest(
            *similarity_scores
        )

        result = await session.execute(
            stmt.where(
                or_(
                    *candidate_conditions
                )
            )
            .order_by(
                best_similarity.desc(),
                Track.artist.asc(),
                Track.title.asc(),
            )
            .limit(
                TRACK_CANDIDATE_LIMIT,
            )
        )

        return list(
            result.scalars().all()
        )

    direct_pattern = (
        prefix_pattern
        if len(term) == 1
        else contains_pattern
    )

    result = await session.execute(
        stmt.where(
            or_(
                *(
                    field.ilike(
                        direct_pattern,
                    )
                    for field in fields
                )
            )
        )
        .order_by(
            Track.artist.asc(),
            Track.title.asc(),
        )
        .limit(
            TRACK_CANDIDATE_LIMIT,
        )
    )

    direct = list(
        result.scalars().all()
    )

    if (
        direct
        or len(term) < 3
        or _is_postgresql(session)
    ):
        return direct

    # SQLite-only compatibility fallback.
    # Production PostgreSQL must use pg_trgm
    # rather than newest-N Python scanning.
    fuzzy_result = await session.execute(
        select(Track)
        .where(
            Track.is_published.is_(
                True,
            )
        )
        .order_by(
            Track.created_at.desc(),
        )
        .limit(
            TRACK_CANDIDATE_LIMIT,
        )
    )

    return list(
        fuzzy_result.scalars().all()
    )
```

- [ ] **Step 5: Cap final ranked track results**

At the bottom of `_build_track_rows()`, find:

```python
    return sort_track_rows(
        rows,
        sort_mode,
        parsed.intent,
    )
```

Replace it with:

```python
    return sort_track_rows(
        rows,
        sort_mode,
        parsed.intent,
    )[:TRACK_RESULT_LIMIT]
```

- [ ] **Step 6: Replace the entire `_search_people()` function with this code**

```python
async def _search_people(
    session: AsyncSession,
    parsed: ParsedSearch,
) -> list[SearchPersonResult]:
    if (
        parsed.intent
        not in {
            "general",
            "people",
        }
        or not parsed.term
    ):
        return []

    follower_counts = (
        select(
            UserFollow.following_id.label(
                "user_id",
            ),
            func.count(
                UserFollow.follower_id,
            ).label(
                "followers_count",
            ),
        )
        .where(
            UserFollow.accepted_at.is_not(
                None,
            )
        )
        .group_by(
            UserFollow.following_id,
        )
        .subquery()
    )

    term = parsed.term.strip()
    prefix_pattern = f"{term}%"
    contains_pattern = f"%{term}%"

    base_stmt = (
        select(
            User,
            func.coalesce(
                follower_counts.c.followers_count,
                0,
            ),
        )
        .outerjoin(
            UserProfile,
            UserProfile.user_id == User.id,
        )
        .outerjoin(
            follower_counts,
            follower_counts.c.user_id == User.id,
        )
        .options(
            selectinload(
                User.profile,
            )
        )
        .where(
            User.is_active.is_(True),
            User.username.is_not(None),
        )
    )

    fields = (
        User.username,
        User.username_normalized,
        UserProfile.display_name,
    )

    if (
        _is_postgresql(session)
        and len(term) >= 3
    ):
        query_literal = literal(term)

        candidate_conditions = []
        similarity_scores = []

        for field in fields:
            candidate_conditions.extend(
                [
                    field.ilike(
                        contains_pattern,
                    ),
                    field.op("%")(term),
                    query_literal.op("<%")(field),
                ]
            )

            similarity_scores.extend(
                [
                    func.coalesce(
                        func.similarity(
                            field,
                            term,
                        ),
                        0.0,
                    ),
                    func.coalesce(
                        func.word_similarity(
                            term,
                            field,
                        ),
                        0.0,
                    ),
                ]
            )

        best_similarity = func.greatest(
            *similarity_scores
        )

        result = await session.execute(
            base_stmt.where(
                or_(
                    *candidate_conditions
                )
            )
            .order_by(
                best_similarity.desc(),
                User.username.asc(),
            )
            .limit(
                PEOPLE_CANDIDATE_LIMIT,
            )
        )

        rows = result.all()

    else:
        direct_pattern = (
            prefix_pattern
            if len(term) == 1
            else contains_pattern
        )

        result = await session.execute(
            base_stmt.where(
                or_(
                    *(
                        field.ilike(
                            direct_pattern,
                        )
                        for field in fields
                    )
                )
            )
            .order_by(
                User.username.asc(),
            )
            .limit(
                PEOPLE_CANDIDATE_LIMIT,
            )
        )

        rows = result.all()

        if (
            not rows
            and len(term) >= 3
            and not _is_postgresql(session)
        ):
            # SQLite-only compatibility fallback.
            fuzzy_result = await session.execute(
                select(
                    User,
                    func.coalesce(
                        follower_counts.c.followers_count,
                        0,
                    ),
                )
                .outerjoin(
                    follower_counts,
                    follower_counts.c.user_id == User.id,
                )
                .options(
                    selectinload(
                        User.profile,
                    )
                )
                .where(
                    User.is_active.is_(True),
                    User.username.is_not(None),
                )
                .order_by(
                    User.created_at.desc(),
                )
                .limit(
                    PEOPLE_CANDIDATE_LIMIT,
                )
            )

            rows = fuzzy_result.all()

    scored = []

    for (
        found_user,
        follower_count,
    ) in rows:
        username = (
            found_user.username
            or ""
        )

        display_name = (
            found_user.profile.display_name
            if found_user.profile
            else username or "User"
        )

        match = score_person(
            username,
            display_name,
            parsed,
        )

        if match.score <= 0:
            continue

        person = SearchPersonResult(
            username=username,
            display_name=display_name,
            avatar_url=(
                avatar_url(
                    found_user,
                )
            ),
            followers_count=int(
                follower_count
            ),
            member_since=(
                found_user.created_at
            ),
            match_label=(
                match.label
            ),
        )

        scored.append(
            (
                match.tier,
                match.score,
                int(follower_count),
                person,
            )
        )

    scored.sort(
        key=lambda item: (
            -item[0],
            -item[1],
            -item[2],
            item[3].username.casefold(),
        )
    )

    return [
        item[3]
        for item in scored[
            :PEOPLE_RESULT_LIMIT
        ]
    ]
```

- [ ] **Step 7: Make normal searches return music and people together**

Near the bottom of `search_hypersync()`, find:

```python
    should_search_people = (
        parsed.intent == "people"
        or (
            parsed.intent == "general"
            and not tracks
        )
    )
```

Replace it with:

```python
    should_search_people = (
        parsed.intent
        in {
            "general",
            "people",
        }
    )
```

Do not change the following `people = (...)` block.

---

### Task 6: Apply schema, verify focused tests, then verify the whole project

**Files:**
- No new production files.
- Uses the project's existing Alembic and verification scripts.

- [ ] **Step 1: Apply the new migration**

From the repository root, with your normal `.venv` active and `.env` configured:

```powershell
python -m alembic upgrade head
```

Expected: Alembic advances to `e7a1c4d9b2f6` and PostgreSQL creates the `pg_trgm` extension plus six GIN indexes. On SQLite, the migration intentionally performs no PostgreSQL-specific DDL.

- [ ] **Step 2: Run focused tests**

```powershell
python -m pytest tests/test_search_service.py tests/test_search_relevance.py -q -W error
```

Expected: PASS.

- [ ] **Step 3: Run Ruff without silently changing code first**

```powershell
python -m ruff check backend tests migrations
```

Expected: no errors. If Ruff reports formatting only, run the repository-standard formatter next.

- [ ] **Step 4: Format the touched Python files**

```powershell
python -m ruff format backend/app/services/search.py backend/app/api/routes/search.py tests/test_search_service.py tests/test_search_relevance.py migrations/versions/e7a1c4d9b2f6_add_search_trigram_indexes.py
```

- [ ] **Step 5: Re-run focused tests after formatting**

```powershell
python -m pytest tests/test_search_service.py tests/test_search_relevance.py -q -W error
```

Expected: PASS.

- [ ] **Step 6: Run the full suite**

```powershell
python -m pytest -q -W error
```

Expected: all tests PASS.

- [ ] **Step 7: Run HyperSync's existing project verifier**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-project.ps1
```

Expected: all configured project checks pass, including the Alembic graph/live Neon revision checks when the required environment is configured.

- [ ] **Step 8: Manual search smoke test**

Start HyperSync normally and verify these cases:

```text
shane
```

Expected: matching tracks/artists/albums and matching users can appear together.

```text
@shane
people shane
user shane
```

Expected: People only.

```text
songs by Post Malone
albums by Post Malone
```

Expected: music only.

```text
shnae
```

Expected: close `shane` text can be recovered when PostgreSQL trigram matching finds it; unrelated users do not appear merely because of a field bonus.

## Completion Criteria

The work is complete only when:

- the service regression tests pass;
- the general search integration test returns music and people together;
- music/people command scoping passes;
- Alembic has exactly one head at `e7a1c4d9b2f6`;
- the full pytest suite passes with warnings as errors;
- the project verifier passes;
- no frontend Search files were changed for functionality.
