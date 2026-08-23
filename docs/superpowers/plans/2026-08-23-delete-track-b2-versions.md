# Permanent Track Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make admin track deletion remove the database row, the audio B2 object, every historical B2 version of that audio object, the artwork B2 object, and every historical B2 version of that artwork object as quickly as practical.

**Architecture:** Put reusable B2 object cleanup in `backend/app/services/b2.py`. The admin delete endpoint will collect the track's audio and artwork keys, delete all versions for both objects concurrently, then delete the track row and commit. The test will verify every B2 version is actually deleted and the database row is gone.

**Tech Stack:** FastAPI, SQLAlchemy async sessions, `b2sdk.v2`, pytest, httpx.

**Spec:** Permanent deletion of tracks and all associated B2 versions.

## Global Constraints

- Only the authenticated admin endpoint may perform this deletion.
- B2 cleanup must include all versions returned by `list_file_versions`.
- Audio and artwork B2 cleanup should run concurrently to minimize deletion latency.
- The database row is committed only after B2 cleanup succeeds.
- A B2 cleanup failure must return HTTP 500 and must not delete the database row.
- No frontend API contract change is required.

---

### Task 1: Add a reusable fast B2 version-deletion helper

**Files:**
- Modify: `backend/app/services/b2.py`

**Interfaces:**
- Produces `delete_all_object_versions(bucket, object_key) -> int`, an async helper that lists every version for one B2 object and concurrently deletes every returned version, returning the number of deleted versions.

- [ ] **Step 1: Add imports needed for concurrency and typing**

Add `asyncio` and `Any` imports at the top of `backend/app/services/b2.py`.

- [ ] **Step 2: Add the helper after `get_b2_endpoint()`**

Use:

```python
async def delete_all_object_versions(bucket: Any, object_key: str) -> int:
    versions = await asyncio.to_thread(
        bucket.list_file_versions,
        file_name=object_key,
    )

    deletions = []

    for version in versions:
        file_name = getattr(version, "file_name", None) or getattr(
            version, "fileName", None
        )
        file_id = getattr(version, "file_id", None) or getattr(
            version, "fileId", None
        )

        if file_name and file_id:
            deletions.append(
                asyncio.to_thread(
                    bucket.delete_file_version,
                    file_id=file_id,
                    file_name=file_name,
                )
            )

    if not deletions:
        return 0

    await asyncio.gather(*deletions)
    return len(deletions)
```

- [ ] **Step 3: Verify the helper file parses**

Run:

```bash
python -m compileall backend/app/services/b2.py
```

Expected: exit code 0.

- [ ] **Step 4: Commit the helper**

```bash
git add backend/app/services/b2.py
git commit -m "feat: add concurrent B2 version cleanup helper"
```

---

### Task 2: Make admin track deletion remove audio and artwork completely

**Files:**
- Modify: `backend/app/api/routes/admin.py`

**Interfaces:**
- Consumes `delete_all_object_versions` from `backend.app.services.b2`.
- Keeps `DELETE /api/admin/tracks/{track_id}` unchanged for the frontend.

- [ ] **Step 1: Import the helper**

Change the B2 import from:

```python
from ...services.b2 import get_b2_bucket
```

to:

```python
from ...services.b2 import (
    delete_all_object_versions,
    get_b2_bucket,
)
```

- [ ] **Step 2: Replace the current B2 cleanup block in `delete_track()`**

Replace the current `object_key` cleanup loop with:

```python
    bucket = get_b2_bucket()

    object_keys = [
        key
        for key in (
            track.b2_object_key,
            track.artwork_object_key,
        )
        if key
    ]

    try:
        deleted_versions = await asyncio.gather(
            *(
                delete_all_object_versions(bucket, object_key)
                for object_key in object_keys
            )
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to permanently remove track files from B2: {exc}",
        ) from exc
```

- [ ] **Step 3: Delete the database row after successful B2 cleanup**

Replace the duplicate-track query/deletion block with:

```python
    await session.delete(track)
    await session.commit()

    return {
        "success": True,
        "deleted_track_id": str(track_id),
        "deleted_object_key": track.b2_object_key,
        "deleted_artwork_object_key": track.artwork_object_key,
        "deleted_b2_versions": sum(deleted_versions),
    }
```

This is safe with the current model because `b2_object_key` is unique, so the endpoint should only delete the requested track row. The artwork key is separately cleaned up before the database commit.

- [ ] **Step 4: Run the existing admin-delete test before changing it**

Run:

```bash
pytest tests/test_catalog_search_and_admin_delete.py::test_admin_delete_removes_b2_versions_and_database_rows -v
```

Expected: the existing test may fail because its fake bucket currently does not retain a reference for asserting deletion calls and the response contract is being strengthened.

- [ ] **Step 5: Commit the route change**

```bash
git add backend/app/api/routes/admin.py
git commit -m "feat: permanently delete track audio and artwork from B2"
```

---

### Task 3: Strengthen the deletion test to prove every version is deleted

**Files:**
- Modify: `tests/test_catalog_search_and_admin_delete.py`

**Interfaces:**
- Tests the unchanged `DELETE /api/admin/tracks/{track_id}` API.

- [ ] **Step 1: Make the fake bucket retain its deletion history**

Change the fake bucket setup so one instance is created before monkeypatching:

```python
    fake_bucket = FakeBucket()

    monkeypatch.setattr(
        "backend.app.api.routes.admin.get_b2_bucket",
        lambda: fake_bucket,
    )
```

- [ ] **Step 2: Add an artwork key to the test track**

Use a unique artwork key such as:

```python
artwork_object_key = f"artwork/delete-me-{run_id}.jpg"
```

and set:

```python
artwork_object_key=artwork_object_key,
```

on the test `Track`.

- [ ] **Step 3: Make the fake bucket return versions for both objects**

Change `FakeBucket.list_file_versions()` to return audio versions for the audio key and artwork versions for the artwork key:

```python
        def list_file_versions(self, file_name: str | None = None):
            if file_name == object_key:
                return [
                    type("Version", (), {"file_name": object_key, "file_id": "audio-v1"})(),
                    type("Version", (), {"file_name": object_key, "file_id": "audio-v2"})(),
                ]

            if file_name == artwork_object_key:
                return [
                    type("Version", (), {"file_name": artwork_object_key, "file_id": "art-v1"})(),
                    type("Version", (), {"file_name": artwork_object_key, "file_id": "art-v2"})(),
                ]

            raise AssertionError(f"Unexpected B2 object key: {file_name}")
```

- [ ] **Step 4: Assert every B2 version was deleted**

After the API response assertion, add:

```python
    assert sorted(fake_bucket.deleted) == sorted(
        [
            (object_key, "audio-v1"),
            (object_key, "audio-v2"),
            (artwork_object_key, "art-v1"),
            (artwork_object_key, "art-v2"),
        ]
    )

    assert payload["deleted_b2_versions"] == 4
    assert payload["deleted_artwork_object_key"] == artwork_object_key
```

- [ ] **Step 5: Verify the test passes**

Run:

```bash
pytest tests/test_catalog_search_and_admin_delete.py::test_admin_delete_removes_b2_versions_and_database_rows -v
```

Expected: PASS.

- [ ] **Step 6: Run the complete backend test suite**

Run:

```bash
pytest -q
```

Expected: all tests pass.

- [ ] **Step 7: Commit the test changes**

```bash
git add tests/test_catalog_search_and_admin_delete.py
git commit -m "test: verify permanent B2 track deletion"
```

---

### Task 4: Final verification

**Files:**
- No source changes.

- [ ] **Step 1: Run compile checks**

```bash
python -m compileall backend
```

Expected: exit code 0.

- [ ] **Step 2: Run the full test suite**

```bash
pytest -q
```

Expected: all tests pass.

- [ ] **Step 3: Manually verify the deletion flow**

Upload a disposable test track through the admin UI, confirm it appears in the catalog, delete it, refresh the catalog, and confirm it no longer appears. Then verify in B2 that neither the audio object nor its artwork object remains in the bucket's file versions.

- [ ] **Step 4: Confirm the API response**

A successful deletion should return fields equivalent to:

```json
{
  "success": true,
  "deleted_track_id": "<track-id>",
  "deleted_object_key": "<audio-key>",
  "deleted_artwork_object_key": "<artwork-key>",
  "deleted_b2_versions": 4
}
```

The exact version count depends on how many historical versions exist.
