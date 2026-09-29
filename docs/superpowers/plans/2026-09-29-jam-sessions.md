# HyperSync Jam Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add secure invite-only group listening in host-device and each-device modes while preserving solo playback.

**Architecture:** A durable Jam aggregate owns membership, queue and timeline. Authenticated REST snapshots and mutations run through a service layer with DB transactions; frontend polling reconciles each device with the authoritative revision.

**Tech Stack:** FastAPI, SQLAlchemy async, Alembic, pytest, React, Node tests, Vite.

**Spec:** `docs/superpowers/specs/2026-09-29-jam-sessions-design.md`

## Global Constraints

- Registered accounts only; no invitation secret in snapshots or logs.
- Maximum 20 participants and 200 queued published catalog tracks.
- Host owns membership and permissions; solo playback remains unchanged outside Jam.
- No audio autoplay without explicit opt-in; drift correction threshold is 1.5 seconds.
- Support backend replicas through durable snapshots; do not depend on process-local sockets.

## Review Focus

- Expired or rotated invitation must reject a new join; test both.
- Removed participant cannot read or mutate the Jam; test with a second account.
- Two simultaneous queue mutations cannot lose an entry; test revision conflict.
- Unpublished track cannot enter shared queue; test authorization response.
- Reconnect or background wake must not start audio before opt-in; test client controller.

---

### Task 1: Durable Jam state and migration

**Files:** Create `backend/app/models/jam.py`, `migrations/versions/<revision>_add_jam_sessions.py`; modify `backend/app/models/__init__.py`; test `tests/test_jam_sessions.py`.

**Interfaces:** `JamSession`, `JamMember`, `JamQueueItem` keyed by UUID and protected by DB constraints. The migration follows the current Alembic head.

- [ ] Write failing model/table tests for keys, expiry and unique membership.
- [ ] Run focused pytest and confirm failure.
- [ ] Implement models and forward/backward migration.
- [ ] Run focused tests and offline migration validation.
- [ ] Commit model and migration.

### Task 2: Secure Jam service and API

**Files:** Create `backend/app/services/jam_sessions.py`, `backend/app/api/routes/jams.py`; modify `backend/app/api/router.py`; test `tests/test_jam_sessions.py`.

**Interfaces:** create, join, current snapshot, leave/end, rotate invite, queue addition/removal, permissions/mode, and playback actions. Revision conflict is HTTP 409; unauthorized reads are 404, invalid/expired invite 404. Snapshot includes server time and timeline anchor but no invite secret.

- [ ] Write failing tests for host/guest permissions, invitation expiry/rotation, cap, unpublished track, revision conflict, and playback position.
- [ ] Run tests and confirm failures.
- [ ] Implement transaction boundaries and endpoints with registered account dependency and rate limits.
- [ ] Run focused tests and full backend suite, Ruff and Pyright.
- [ ] Commit service and API.

### Task 3: Client Jam state and synchronization

**Files:** Create `frontend/src/jamSessions.js`, `frontend/src/jamSync.js` and tests; modify `frontend/src/api/client.js` if protected path detection needs it.

**Interfaces:** fetch/mutate API functions; pure `expectedJamPosition(snapshot, now)` and `reconcileJamPlayback` return commands. Polling refreshes revision and repairs reconnects; local audio opt-in is explicit.

- [ ] Write failing tests for clock anchor, drift threshold, mode transition, opt-in and ended/removed states.
- [ ] Run Node tests and confirm failures.
- [ ] Implement pure synchronization and polling API.
- [ ] Run all frontend tests and build.
- [ ] Commit client controller.

### Task 4: Player Jam UI and integration

**Files:** Create `frontend/src/components/player/JamPanel.jsx` and styles; modify `frontend/src/components/player/PlayerBar.jsx`, `frontend/src/App.jsx`; test UI/controller interactions.

**Interfaces:** Jam panel receives current user, snapshot, operations, and status; App owns Jam polling and translates timeline to existing player operations. Host-device guests do not play locally; each-device members opt in.

- [ ] Write failing tests for host/guest controls, invitations, queue edits, mode switch, and solo playback isolation.
- [ ] Implement minimal accessible Jam panel and App integration.
- [ ] Run all frontend tests, build, backend suite, Ruff and Pyright.
- [ ] Commit UI and integration.

### Task 5: Review, merge and deployment verification

**Files:** Update README feature/use and operational notes.

- [ ] Check migration chain and production image, audit diff and obtain independent review.
- [ ] Publish branch and verify every GitHub CI job is green.
- [ ] Merge to main as authorized by the user, preserving history and features.
- [ ] Check Northflank rollout and production health endpoints; report access limits honestly.
