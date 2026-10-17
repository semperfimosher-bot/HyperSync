# Backend Hardening Implementation Plan

> **For agentic workers:** Execute task by task with test-first fixes and independent review. Independent file-owned tasks may run concurrently.

**Goal:** Close the current branch's seven reliability/security findings and provide honest load/recovery evidence.
**Architecture:** Preserve the existing FastAPI/PostgreSQL/local-player architecture; add PostgreSQL durable maintenance jobs, serialize shared writes, and bound request/catalog work.
**Tech Stack:** FastAPI, SQLAlchemy asyncpg, PostgreSQL, React, Nginx, pytest/Node tests.
**Spec:** docs/superpowers/specs/2026-10-17-backend-hardening-design.md

## Global Constraints
- Existing data and account/local playback behavior remain compatible. No live infrastructure operations.
- Work on existing dedicated review checkout; preserve unrelated edits. Root integrates/commits/publishes with leased GitHub ref update.
- Tests before code; local PostgreSQL unavailable, full DB checks run through disposable GitHub CI. Do not use live credentials.
- Migration chain: 6a4d9e8b1c2f -> 74c2e8f1a9b6 playlist invariants -> 83d1f6b2c4a7 maintenance jobs.
- API request ceiling 64 MiB; avatar content ceiling 5 MiB. Keep existing payload success shapes.

## Review Focus
- Partial object deletion and retries must keep missing media unpublished.
- Concurrent first/repeated likes and existing generated refreshes cannot duplicate membership.
- Anonymous/private/follower/self access must obey the same profile privacy policy.
- Streaming oversized/chunked requests must fail boundedly, without trusting Content-Length alone.
- Worker crash/provider failure must retain durable jobs; multiple replicas cannot concurrently own one job.

### Task 1: Storage deletion safety
Owner files: backend/app/api/routes/admin.py deletion functions; tests/test_catalog_search_and_admin_delete.py or dedicated deletion regression file.
- [x] Reproduce partial audio success/artwork failure, single/bulk deletion.
- [x] Keep failures hidden, await all storage outcomes, expose retryable failure without claiming rollback restored media.
- [x] Test retries, all-failed/final DB failure, preserve unrelated tracks.

### Task 2: Playlist integrity
Owner files: models/playlist.py, routes/playlists.py, services/generated_playlists.py, migration74c2e8f1a9b6, related tests.
- [x] Reproduce concurrent first/existing likes and refreshes with real PostgreSQL integration tests.
- [x] Introduce centralized advisory locking, uniqueness, duplicate-preserving migration/position repair; acquire locks before reading shared state.
- [x] Verify likes/add/remove/reorder/generated creation/refresh compatibility.

### Task 3: Privacy and bounded avatar reads
Owner files: routes/users.py, related tests.
- [x] Test anonymous/private/public/self/accepted follower following-list access.
- [x] Enforce shared privacy policy and cap avatar read before allocation.
- [x] Verify existing profile contracts and upload errors.

### Task 4: Request body and proxy limits
Owner files: new middleware/request_limits.py, config.py limit fields only, frontend/nginx.conf, tests/test_request_limits.py.
- [x] Test declared/chunked oversized payloads, malformed Content-Length, exact boundary and auth/normal responses.
- [x] Implement bounded ASGI receive guard, explicit Nginx64m ceiling; root wires middleware after integration.
- [x] Document behavior in focused operations doc.

### Task 5: Catalog/scoring scalability
Owner files: routes/catalog.py, frontend/src/catalogStore.js, new catalog pagination tests; coordinate generated_playlists.py changes with Task2 owner.
- [x] Test stable paged catalog traversal and frontend assembly/deduplication/abort handling, preserve legacy endpoint shape.
- [x] Use bounded opt-in cursor pages for frontend; eliminate repeated ranking scans across one maintenance batch where safe.
- [x] Test query/page boundaries and catalog changes during pagination.

### Task 6: Durable maintenance and dependency update (root)
Owner files: new model/service/migration83d1f6b2c4a7; main.py; admin.py upload hooks after Task1; music_metadata.py; frontend/package*.json.
- [x] Tests for atomic job enqueue, SKIP LOCKED claiming, retry/backoff/expired lease, duplicate jobs and restart recovery.
- [x] Queue metadata/generated playlist maintenance transactionally; bounded lease worker outside request path, configurable deadlines/retries.
- [x] Update parser to11.16.1 or newer compatible audited fix; run npm audit/tests/build.

### Task 7: Migration coordination and recovery/load tooling
Owner files: migrations/env.py, Dockerfile.backend, new scripts/tooling tests and operations docs.
- [x] Test migration serialization and release migration switch; use session advisory lock on migration connection and release reliably.
- [x] Add isolated load/recovery runner and documented pool/worker/replica, backup/restore/rollback rehearsal.
- [x] Do not claim real-service/capacity certification; root runs available isolated evidence and CI.

### Task 8: Integration, review and publication
- [x] Integrate owned changes, run Ruff/Pyright/frontend build+suite and meaningful offline/DB CI tests.
- [ ] Independent review; resolve important issues; verify migration graph/data preservation and all full CI gates.
- [ ] Update reliability report, commit and publish same PR; report changes, tests and remaining operational limits.
