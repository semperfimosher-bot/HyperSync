# Playback and Realtime Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate account playback, playback devices, durable remote commands, and realtime delivery into one playback subsystem that preserves current behavior and remains correct across multiple API replicas.

**Architecture:** Keep PostgreSQL authoritative for playback state, devices, and commands. Move playback domain rules from `backend/app/api/routes/users.py` into `backend/app/services/playback.py`; keep `PlaybackRealtimeHub` process-local for socket bookkeeping only; add a small PostgreSQL `LISTEN`/`NOTIFY` bridge for cross-replica hints; keep frontend WebSocket-first with bounded reconnect backoff and low-frequency safety polling.

**Tech Stack:** Python 3 async/FastAPI, SQLAlchemy async + PostgreSQL/asyncpg, Pydantic, React 19/Vite, browser WebSocket API, Node test runner, pytest.

**Spec:** `docs/superpowers/specs/2026-10-06-playback-realtime-design.md`

## Global Constraints

- Work on branch `Shane` only; do not modify `main`.
- Preserve the existing `/api/users/me/playback-state`, `/api/users/me/playback-devices/poll`, `/api/users/me/playback-devices/{target_device_id}/commands`, and `/api/users/me/playback-devices/live` public contracts.
- Preserve registered-account restrictions, status codes, validation/error details, 500-track queue limit, 90-second device-online TTL, 32-command poll batch limit, 15-second frontend heartbeat, and 4-second realtime command ACK timeout.
- PostgreSQL remains authoritative; notifications are best-effort hints and never the only copy of a command or state change.
- Heartbeats must not become high-frequency database writes.
- Normal request traffic stays on the bounded SQLAlchemy pool; the listener uses at most one dedicated direct asyncpg connection per API process.
- No Redis and no new durable notification table.
- No Alembic/schema change is expected. If implementation discovers an unavoidable schema requirement, stop for a compatibility review before adding it.
- Keep `users.py` compatibility exports for playback schema/helper names that tests or internal callers already import while moving ownership underneath them.
- Do not begin media/offline subsystem work until the exact final playback commit passes the complete repository verification gate.

## File Structure

- Create `backend/app/api/schemas/playback.py`: playback-only Pydantic request/response types and playback literals.
- Create `backend/app/services/track_urls.py`: unchanged shared track audio/artwork URL construction extracted from `users.py` so playback service code does not import the route module.
- Create `backend/app/services/playback.py`: canonical playback state/queue building, device presence, pruning, command lifecycle, state mutation, local event handling.
- Keep `backend/app/services/playback_realtime.py`: process-local WebSocket registry and send/broadcast only.
- Create `backend/app/services/playback_events.py`: event envelope, `pg_notify`, direct asyncpg listener, decode/reconnect lifecycle.
- Modify `backend/app/api/routes/users.py`: existing HTTP and WebSocket transport adapters only; schema/helper imports remain available as compatibility exports.
- Modify `backend/app/config.py`: optional explicit direct listener URL and normalized direct asyncpg DSN property.
- Modify `backend/app/database.py`: expose the existing environment-aware PostgreSQL TLS context policy for both SQLAlchemy and the listener.
- Modify `backend/app/main.py`: listener task startup/shutdown only.
- Create `tests/test_playback_service.py`: direct playback-domain tests.
- Create `tests/test_playback_events.py`: event envelope/listener/dispatch tests.
- Extend `tests/test_account_playback_sync.py` and `tests/test_playback_websocket.py`: public-contract and transport characterization.
- Modify `frontend/src/playbackDevices.js`: reconnect policy/scheduler, polling policy, command-id recovery helpers.
- Modify `frontend/src/App.jsx`: playback connection orchestration using the extracted policy and healthy-socket safety polling.
- Extend `frontend/src/playbackDevices.test.js`: reconnect, polling, and duplicate-command recovery behavior.
- Create `docs/operations/playback-realtime.md`: runtime setting, failure/degradation behavior, and operational checks.

## Review Focus

1. **Stale writer after handoff:** a former device must not reclaim playback when the active owner is online only through a live socket. Task 4 adds a direct service test for this case.
2. **Listener outage during command commit:** the durable command must remain unconsumed and be recoverable by normal polling. Task 7 tests this explicitly.
3. **Malformed or future-version notification:** the listener must ignore it without crashing or reconnect-looping. Task 7 tests both malformed JSON and unsupported versions.
4. **Duplicate delivery path (notification plus poll):** the client must apply one durable command at most once by command id. Task 8 adds the frontend dedupe test.
5. **Reconnect storm/cancellation:** at most one reconnect timer may exist; `ready` resets attempts; cancelled playback orchestration may not schedule again. Task 8 tests all three.

---

### Task 1: Establish the Playback Domain Home

**Files:**
- Create: `backend/app/api/schemas/playback.py`
- Create: `backend/app/services/track_urls.py`
- Create: `backend/app/services/playback.py`
- Modify: `backend/app/api/routes/users.py` (playback schema/helper definitions and shared track URL helpers only)
- Create: `tests/test_playback_service.py`

**Interfaces:**
- Produces schema types: `PlaybackTrackResponse`, `PlaybackStateResponse`, `PlaybackStateUpdateRequest`, `PlaybackDevicePollRequest`, `PlaybackDeviceResponse`, `PlaybackRemoteCommandRequest`, `PlaybackRemoteCommandResponse`, `PlaybackDevicePollResponse`, `PlaybackDeviceKind`, `PlaybackRemoteAction`.
- Produces `track_urls.py` functions with unchanged behavior: `presigned_or_fallback(object_key: str, fallback_url: str) -> str`, `audio_url(track: Track) -> str | None`, `artwork_url(track: Track) -> str | None`.
- Produces service functions:
  - `require_registered_playback_user(user: User) -> None`
  - `playback_track_response(track: Track) -> PlaybackTrackResponse`
  - `playback_queue_track_response(track: Track) -> PlaybackTrackResponse`
  - `build_account_playback_queue(session, state: UserAppState | None, selected_track_id: UUID | None) -> tuple[list[PlaybackTrackResponse], int | None]`
  - `build_playback_state(session, user: User) -> PlaybackStateResponse`

- [ ] **Step 1: Write failing direct-service tests**

Add `test_queue_canonicalization_preserves_selected_track_and_omits_unpublished()` and `test_queue_canonicalization_caps_at_500()` in `tests/test_playback_service.py`. The first asserts unpublished/missing ids are omitted while the selected published track becomes the canonical index; the second asserts no more than 500 input ids are considered.

- [ ] **Step 2: Run the focused tests and verify the new module import fails**

Run: `python -m pytest tests/test_playback_service.py -q -W error`
Expected: FAIL because `backend.app.services.playback` and/or the extracted playback schema module do not yet exist.

- [ ] **Step 3: Extract shared track URL helpers without behavior changes**

Move `presigned_or_fallback`, `audio_url`, and `artwork_url` to `track_urls.py`; import them back into `users.py` and into `playback.py`. This prevents a `playback.py -> users.py -> playback.py` cycle while leaving media URL semantics unchanged.

- [ ] **Step 4: Move playback schemas and canonical response/state builders**

Move the existing schema definitions and the five playback service interfaces above without changing validation limits, response fields, queue ordering, URL behavior, or canonical-index behavior. `users.py` imports/re-exports the moved schema names rather than keeping duplicate class definitions.

- [ ] **Step 5: Run focused playback service and existing account tests**

Run: `python -m pytest tests/test_playback_service.py tests/test_account_playback_sync.py -q -W error`
Expected: PASS.

- [ ] **Step 6: Commit**

Commit message: `Consolidate playback state helpers`

---

### Task 2: Move Device Presence and Pruning Behind the Service

**Files:**
- Modify: `backend/app/services/playback.py`
- Modify: `backend/app/api/routes/users.py`
- Modify: `tests/test_playback_service.py`
- Preserve/extend: `tests/test_account_playback_sync.py`

**Interfaces:**
- Produces:
  - `PLAYBACK_DEVICE_ONLINE_TTL = timedelta(seconds=90)`
  - `PLAYBACK_DEVICE_LIST_LIMIT = 20`
  - `playback_device_is_online(last_seen_at: datetime, *, now: datetime | None = None) -> bool`
  - `touch_playback_device(session, user: User, *, device_id: str, name: str, device_type: PlaybackDeviceKind, now: datetime | None = None) -> None`
  - `prune_offline_playback_devices(session, user: User, *, now: datetime | None = None) -> list[str]`
  - `list_playback_devices(session, user: User, *, active_device_id: str | None, now: datetime | None = None) -> list[PlaybackDeviceResponse]`

- [ ] **Step 1: Add presence/pruning service tests**

Add tests asserting: a stale DB device with a locally connected socket is retained; a truly stale device is deleted; its unconsumed commands are deleted; and if it owned playback the state is paused, owner cleared, and timestamp advanced.

- [ ] **Step 2: Run the new tests and verify they fail before extraction**

Run: `python -m pytest tests/test_playback_service.py -q -W error`
Expected: FAIL because presence/pruning functions are not yet exported from the service.

- [ ] **Step 3: Move the current upsert, TTL, pruning, and listing logic into `playback.py`**

Keep PostgreSQL upsert semantics and the local-hub connected-device signal exactly as today. Do not add DB writes to WebSocket heartbeat frames.

- [ ] **Step 4: Run focused service/account tests**

Run: `python -m pytest tests/test_playback_service.py tests/test_account_playback_sync.py -q -W error`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `Consolidate playback device presence`

---

### Task 3: Centralize Durable Command Issue, Coalescing, and Poll Consumption

**Files:**
- Modify: `backend/app/services/playback.py`
- Modify: `backend/app/api/routes/users.py`
- Modify: `tests/test_playback_service.py`
- Extend: `tests/test_account_playback_sync.py`

**Interfaces:**
- Produces:
  - `PLAYBACK_COMMAND_BATCH_LIMIT = 32`
  - `playback_command_response(command: PlaybackCommand, *, queue: list[PlaybackTrackResponse] | None = None, queue_index: int | None = None) -> PlaybackRemoteCommandResponse`
  - `poll_playback_device(payload: PlaybackDevicePollRequest, user: User, session) -> PlaybackDevicePollResponse`
  - `send_playback_device_command(target_device_id: str, payload: PlaybackRemoteCommandRequest, user: User, session) -> PlaybackRemoteCommandResponse`

- [ ] **Step 1: Add command-lifecycle tests**

Pin the existing rules with tests for: account scoping/404, transfer and `play_track` superseding obsolete target commands, seek/volume coalescing, previous-owner pause fallback, ascending command order, 32-command batch cap, and a second poll returning no already-consumed commands.

- [ ] **Step 2: Run focused tests and verify missing service interfaces fail**

Run: `python -m pytest tests/test_playback_service.py tests/test_account_playback_sync.py -q -W error`
Expected: FAIL until command lifecycle functions live behind the service.

- [ ] **Step 3: Move command persistence and poll-consume rules into `playback.py`**

Keep the current durable-row-before-delivery behavior and current command response shape. Keep local WebSocket delivery behavior for now; cross-replica signaling is added only in Task 7.

- [ ] **Step 4: Run focused tests**

Run: `python -m pytest tests/test_playback_service.py tests/test_account_playback_sync.py tests/test_playback_websocket.py -q -W error`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `Consolidate playback command lifecycle`

---

### Task 4: Centralize Playback State Mutation and Ownership

**Files:**
- Modify: `backend/app/services/playback.py`
- Modify: `backend/app/api/routes/users.py`
- Modify: `tests/test_playback_service.py`
- Extend: `tests/test_account_playback_sync.py`

**Interfaces:**
- Produces dataclass `PlaybackStateMutationResult` with fields `state: PlaybackStateResponse` and `changed: bool`.
- Produces `update_playback_state(payload: PlaybackStateUpdateRequest, user: User, session) -> PlaybackStateMutationResult`.
- HTTP and WebSocket callers broadcast state only when `changed` is true.

- [ ] **Step 1: Add state-mutation tests**

Add direct service tests for duration clamping, clearing state when `track_id` is null, queue/index normalization, 404 for unpublished/missing track, and **Review Focus #1**: an old device write is rejected when the current owner is DB-stale but still connected in `PlaybackRealtimeHub`.

- [ ] **Step 2: Run tests and verify the new service API fails**

Run: `python -m pytest tests/test_playback_service.py -q -W error`
Expected: FAIL until `PlaybackStateMutationResult` and `update_playback_state` exist.

- [ ] **Step 3: Move the current PATCH ownership and mutation rules into `playback.py`**

A rejected stale writer returns the authoritative current state with `changed=False`; a successful write commits, rebuilds the canonical response, and returns `changed=True`.

- [ ] **Step 4: Run playback service and account synchronization tests**

Run: `python -m pytest tests/test_playback_service.py tests/test_account_playback_sync.py -q -W error`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `Consolidate playback ownership rules`

---

### Task 5: Reduce Playback HTTP Routes to Transport Adapters

**Files:**
- Modify: `backend/app/api/routes/users.py`
- Modify: imports in `tests/test_account_playback_sync.py` only if monkeypatch targets moved
- Test: `tests/test_account_playback_sync.py`

**Interfaces:**
- Consumes all service APIs from Tasks 1-4.
- Public FastAPI route paths, request/response models, status codes, and error detail strings remain unchanged.

- [ ] **Step 1: Add a route-boundary characterization test**

Add a test that exercises GET state, PATCH state, device poll, and command submission through HTTP and asserts the exact existing response field families. This guards against accidentally changing transport contracts while deleting route-owned domain code.

- [ ] **Step 2: Run the new route test before cleanup**

Run: `python -m pytest tests/test_account_playback_sync.py -q -W error`
Expected: PASS as characterization.

- [ ] **Step 3: Remove duplicated playback domain logic from `users.py`**

The four HTTP handlers validate/depend on FastAPI, call `playback.py`, perform only required local-hub broadcast wiring, and return the existing schema objects. Remove playback-specific SQL/ORM imports no longer used elsewhere in `users.py` while preserving compatibility imports for moved playback names.

- [ ] **Step 4: Run backend playback tests plus Ruff on touched modules**

Run: `python -m pytest tests/test_playback_service.py tests/test_account_playback_sync.py tests/test_playback_websocket.py -q -W error`
Run: `python -m ruff check backend/app/api/routes/users.py backend/app/api/schemas/playback.py backend/app/services/track_urls.py backend/app/services/playback.py tests/test_playback_service.py tests/test_account_playback_sync.py tests/test_playback_websocket.py`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `Thin playback HTTP routes`

---

### Task 6: Reduce the WebSocket Handler to Authentication, Frame Validation, and Dispatch

**Files:**
- Modify: `backend/app/api/routes/users.py`
- Modify: `backend/app/services/playback.py`
- Extend: `tests/test_playback_websocket.py`

**Interfaces:**
- WebSocket endpoint stays `/api/users/me/playback-devices/live`.
- Initial authentication frame and close codes remain compatible.
- `command` frames delegate to `send_playback_device_command`.
- `playback_state` frames delegate to `update_playback_state`.
- `heartbeat` remains in-memory/no DB write.
- `ready`, `command_ack`, `command_error`, presence notifications, and cleanup remain wire-compatible.

- [ ] **Step 1: Add WebSocket transport tests**

Add tests asserting command frames invoke the service once, playback-state frames invoke the service once, heartbeat does not write a presence row, replacement socket still closes the old socket with code 4001, and stale disconnect cannot remove its replacement.

- [ ] **Step 2: Run WebSocket tests**

Run: `python -m pytest tests/test_playback_websocket.py -q -W error`
Expected: FAIL for the new service-delegation assertions until the handler is simplified.

- [ ] **Step 3: Remove durable state/command business rules from the socket loop**

Keep only auth/frame parsing, Pydantic validation, service calls, ACK/error mapping, heartbeat handling, and local hub connect/disconnect/broadcast transport behavior.

- [ ] **Step 4: Run all backend playback tests**

Run: `python -m pytest tests/test_playback_service.py tests/test_account_playback_sync.py tests/test_playback_websocket.py -q -W error`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `Thin playback WebSocket transport`

---

### Task 7: Add the Cross-Replica PostgreSQL Event Bridge

**Files:**
- Create: `backend/app/services/playback_events.py`
- Modify: `backend/app/services/playback.py`
- Modify: `backend/app/config.py`
- Modify: `backend/app/database.py`
- Modify: `backend/app/main.py`
- Create: `tests/test_playback_events.py`
- Extend: `tests/test_playback_service.py`
- Create: `docs/operations/playback-realtime.md`

**Interfaces:**
- Constants: `PLAYBACK_EVENT_CHANNEL = "hypersync_playback_events"`, `PLAYBACK_EVENT_VERSION = 1`.
- Event kinds: `command_ready`, `playback_state_changed`, `presence_changed`.
- Event envelope fields: version, kind, user id, optional target/source device id, optional durable command id.
- Produces:
  - `encode_playback_event(event: PlaybackEvent) -> str`
  - `decode_playback_event(payload: str) -> PlaybackEvent | None`
  - `notify_playback_event(session, event: PlaybackEvent) -> None`
  - `run_playback_event_listener(handler: Callable[[PlaybackEvent], Awaitable[None]]) -> None`
- `Settings` gains `playback_realtime_database_url: str = ""` and property `asyncpg_playback_realtime_url: str`; empty means bridge disabled with normal local WebSocket + polling degradation, not startup failure.
- `database.py` exposes `database_ssl_context() -> ssl.SSLContext | bool`; `get_engine()` and the direct listener both use it so test/production TLS policy cannot drift.
- Direct listener reconnect policy: base 1 second, exponential growth, maximum 30 seconds, jitter multiplier 0.75-1.25.
- `playback.py` produces `handle_playback_event(event: PlaybackEvent, *, hub: PlaybackRealtimeHub = playback_realtime_hub) -> None`; `playback_events.py` stays generic and never imports `playback.py`, preventing an event/service import cycle.

- [ ] **Step 1: Write event-envelope and listener failure tests**

Add tests for round-trip version-1 payloads, **Review Focus #3** malformed JSON returning `None`, unsupported future version returning `None`, duplicate event dispatch being harmless, shared TLS-context selection, and listener connection loss entering bounded reconnect rather than crashing the API task.

- [ ] **Step 2: Add cross-replica command recovery tests**

Model two `PlaybackRealtimeHub` instances and call `handle_playback_event(..., hub=...)` separately. Assert a `command_ready` event created by replica A can deliver to a target socket held by replica B; only the hub with the target socket sends. Add **Review Focus #2**: when listener delivery is absent/fails, the durable command remains unconsumed and the normal device poll later returns it.

- [ ] **Step 3: Run event tests and verify they fail before implementation**

Run: `python -m pytest tests/test_playback_events.py tests/test_playback_service.py -q -W error`
Expected: FAIL because the event bridge does not exist.

- [ ] **Step 4: Implement direct DSN/TLS sharing and event encoding**

Normalize `postgres://`, `postgresql://`, and `postgresql+asyncpg://` to an asyncpg-compatible direct PostgreSQL DSN for the new setting; remove connection-string options already handled explicitly by the backend TLS policy. Validate only PostgreSQL schemes. Reuse `database_ssl_context()` for listener connections.

- [ ] **Step 5: Implement transactional `pg_notify` and the direct listener**

Use SQLAlchemy only to execute `pg_notify` inside existing write transactions. Use `asyncpg` directly for the long-lived `LISTEN` session. Listener callbacks enqueue decoded events for async handling; malformed/unsupported payloads are ignored. Errors are logged/retried and cancellation closes the connection cleanly.

- [ ] **Step 6: Wire playback mutations/commands to durable-then-notify ordering**

Issue `pg_notify` inside the same transaction as the authoritative mutation/command insert, commit, then invoke `handle_playback_event` locally for immediate same-process delivery. `command_ready` delivery marks a durable command consumed only after a successful target send; failed/no local send leaves it recoverable by another replica or polling. State/presence events reload authoritative state before local broadcasts where needed.

- [ ] **Step 7: Wire listener lifespan in `main.py`**

Start at most one listener task per process when `PLAYBACK_REALTIME_DATABASE_URL` is configured. Pass `handle_playback_event` into the generic listener. Cancel/await it before database shutdown. An unset or temporarily unavailable listener must not stop API startup/request handling.

- [ ] **Step 8: Document operations**

Document the direct Neon/Postgres endpoint requirement, one direct listener connection per API process, disabled/degraded behavior, reconnect behavior, and how to verify the bridge without treating notifications as durable data.

- [ ] **Step 9: Run backend playback/event tests and static checks**

Run: `python -m pytest tests/test_playback_events.py tests/test_playback_service.py tests/test_account_playback_sync.py tests/test_playback_websocket.py -q -W error`
Run: `python -m ruff check backend/app/services/playback.py backend/app/services/playback_events.py backend/app/services/playback_realtime.py backend/app/services/track_urls.py backend/app/api/routes/users.py backend/app/config.py backend/app/database.py backend/app/main.py tests/test_playback_events.py tests/test_playback_service.py`
Expected: PASS.

- [ ] **Step 10: Commit**

Commit message: `Add cross-replica playback events`

---

### Task 8: Add Bounded Frontend Reconnect and Healthy-Socket Safety Polling

**Files:**
- Modify: `frontend/src/playbackDevices.js`
- Modify: `frontend/src/App.jsx`
- Extend: `frontend/src/playbackDevices.test.js`

**Interfaces:**
- Preserve heartbeat interval at 15 seconds and realtime command timeout at 4 seconds.
- Reconnect base delay: 750 ms.
- Reconnect max delay: 15,000 ms.
- Reconnect jitter multiplier: 0.75-1.25.
- Fallback device poll interval while realtime is unavailable: 15,000 ms.
- Safety poll interval while realtime is ready: 60,000 ms.
- Add a reconnect scheduler/helper in `playbackDevices.js` that owns one timer, exponential attempt state, `ready` reset, and cancellation.
- Add bounded command-id dedupe shared by realtime and poll handling; retain the most recent 256 command ids for the active session.

- [x] **Step 1: Add reconnect-policy tests**

In `playbackDevices.test.js`, assert delay growth from the 750 ms base, 15 s cap, jitter bounds, successful `ready` reset, **Review Focus #5** only one pending reconnect timer, and cancellation preventing a later reconnect callback.

- [x] **Step 2: Add safety-poll and dedupe tests**

Assert ready realtime selects 60 s polling, disconnected/unavailable realtime selects 15 s polling, and **Review Focus #4** the same command id arriving once through realtime and once through a later poll is accepted only once.

- [x] **Step 3: Run the focused frontend test and verify failures**

From `frontend`: `node --test src/playbackDevices.test.js`
Expected: FAIL until the new helpers/policy exist.

- [x] **Step 4: Implement policy helpers in `playbackDevices.js`**

Keep `connectPlaybackDeviceLive` wire behavior unchanged. The close event remains the sole owner of reconnect scheduling; `error` does not schedule independently.

- [x] **Step 5: Replace fixed reconnect/poll orchestration in `App.jsx`**

Use the scheduler/helper, reset attempts on `ready`, switch between 60 s safety polling and 15 s fallback polling, and run all recovered commands through the same 256-id dedupe before applying them.

- [x] **Step 6: Run focused and full frontend unit tests**

From `frontend`:
- `node --test src/playbackDevices.test.js`
- `npm run test:offline`
- `npm run build`
Expected: PASS.

- [x] **Step 7: Commit**

Commit message: `Harden playback realtime recovery`

---

### Task 9: Complete the Playback Verification Gate

**Files:**
- Modify only files required to repair regressions discovered by verification.
- Update `docs/superpowers/specs/2026-10-06-playback-realtime-design.md` status to implemented only after the exact final commit is green.

**Interfaces:**
- No new feature interfaces. This task proves the completed subsystem preserves all public contracts and repository-wide behavior.

- [ ] **Step 1: Run the complete backend suite**

Run: `python -m pytest -q -W error`
Expected: all tests pass.

- [ ] **Step 2: Run repository static/security verification commands used by CI**

Run the repository's configured Ruff, Pyright, verification/audit scripts, backend image checks, and any command surfaced by the current Project Verification workflow. Fix only regressions caused by this subsystem before proceeding.

- [ ] **Step 3: Run the complete frontend unit/build gate**

From `frontend`: `npm run test:offline` and `npm run build`.
Expected: PASS.

- [ ] **Step 4: Push the exact checkpoint and require both GitHub workflows green**

Require **Project Verification** and **Offline PWA checks** to complete successfully on the exact same `Shane` commit, including Windows runner, backend regression/static/audits, production image, frontend regression/image, and isolated browser journeys.

- [ ] **Step 5: Repair failures before moving on**

Straightforward regression/test/format issues are fixed and the full gate rerun. If a failure requires changing user-visible playback behavior or the approved architecture, stop and ask before changing it.

- [ ] **Step 6: Mark the design implemented and commit the green checkpoint**

Commit message: `Complete playback realtime consolidation`

- [ ] **Step 7: Confirm subsystem boundary**

Verify `Shane` is still not behind `main`, `main` was not modified, and no media/offline consolidation work has started. Only then is the playback subsystem complete and the next subsystem eligible to begin.
