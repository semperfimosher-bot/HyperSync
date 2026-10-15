# Playback and Realtime Consolidation Design

Date: 2026-10-06
Branch: `Shane`
Status: Approved design, pending implementation plan

## Purpose

Consolidate HyperSync account playback, playback devices, remote commands, and realtime WebSocket delivery into one clearly owned subsystem without changing existing user-visible behavior.

The goals are:

- preserve every currently working playback feature and public contract;
- remove playback business rules from the oversized user route module;
- make HTTP and WebSocket paths call the same domain operations;
- keep PostgreSQL as the durable source of truth;
- make realtime delivery safe across multiple API processes or replicas;
- make missed notifications recoverable rather than correctness-critical;
- reduce unnecessary database connection and transaction lifetime;
- keep frontend fallback behavior robust when WebSockets or notifications fail;
- require the complete verification gate to pass before media/offline work begins.

## Non-goals

This pass does not redesign the player UI, change playback semantics, alter media delivery, replace PostgreSQL, introduce Redis, change authentication, or change public route names or response shapes.

Media streaming and offline/PWA consolidation remain a separate later subsystem.

## Existing behavior contract

The refactor must preserve the behavior currently implemented by `backend/app/api/routes/users.py`, `backend/app/services/playback_realtime.py`, `frontend/src/playbackDevices.js`, and the application playback integration.

### Public HTTP contracts

The existing playback HTTP routes remain under `/api/users/me/...` with the same request and response schemas. This includes:

- account playback state reads;
- account playback state updates;
- playback-device polling;
- playback-device command submission.

Registered-account requirements, status codes, validation rules, queue limits, track publication checks, and error details remain compatible.

### WebSocket contract

The existing `/api/users/me/playback-devices/live` endpoint remains unchanged externally.

The client continues to authenticate with an initial frame containing:

- `type: "authenticate"`;
- access token;
- device id;
- device name;
- device type.

The server continues to support the existing message families, including:

- `ready`;
- `heartbeat`;
- `command`;
- `command_ack`;
- `command_error`;
- `playback_state`;
- presence/state notifications already consumed by the frontend.

Authentication failures, registered-account restrictions, replacement-socket behavior, and cleanup semantics remain compatible.

### Device presence contract

Playback devices remain keyed per user and device id.

Presence keeps the current durable database record plus live-socket signal model:

- a connected WebSocket is a strong online signal;
- database `last_seen_at` remains a fallback presence signal;
- the existing device online TTL remains unchanged;
- stale-device pruning still removes stale device rows and their unconsumed commands;
- if a pruned device owned playback, ownership is cleared and playback is paused as it is today.

Heartbeat frames must not become high-frequency database writes.

### Playback ownership contract

Only the currently active live playback device may own audio output.

A stale controller must not reclaim playback after a completed handoff. Existing ownership/handoff checks remain behaviorally compatible, including protection against stale progress or pause writes from another device while the active device is still online.

### Playback state contract

PostgreSQL remains authoritative for durable account playback state, including:

- current catalog track;
- position;
- paused state;
- active device;
- queue track ids;
- queue index;
- playback update timestamp.

Queue synchronization continues to cap account playback queues at 500 track ids. Invalid/unpublished tracks are omitted from the canonical response using the same behavior as today.

Realtime state publication may be throttled/coalesced, but durable state semantics must remain unchanged.

### Remote command contract

Playback commands remain durable database records before they are considered safely issued.

Existing command behaviors remain compatible, including:

- targeting one device;
- source device identification;
- transfer/play-track supersession rules;
- seek/volume coalescing rules;
- command ordering;
- consumed-state handling;
- WebSocket delivery when available;
- HTTP polling fallback when realtime delivery is unavailable or missed.

A notification must never be the only copy of a command.

## Target architecture

### 1. Thin transport layer

`backend/app/api/routes/users.py` keeps the existing route and WebSocket entry points but stops owning playback business rules.

Its playback responsibilities become limited to:

- FastAPI route declarations;
- dependency injection;
- WebSocket frame parsing and validation;
- translating domain results to existing response schemas;
- mapping domain errors to existing HTTP/WebSocket responses.

No new public playback URLs are introduced.

### 2. Playback domain service

A dedicated backend playback service becomes the single owner of playback state, device presence, command lifecycle, and ownership rules.

The service owns operations equivalent to:

- require registered playback account;
- build canonical playback state;
- normalize/build playback queue;
- update durable playback state;
- touch device presence;
- prune stale devices;
- list devices;
- poll and consume durable commands;
- validate/issue remote commands;
- apply supersession/coalescing rules;
- determine active-device ownership and stale-writer rejection.

HTTP and WebSocket handlers call these same operations. Rules must not be duplicated between transports.

Schema/serialization helpers may remain separate from persistence logic where that improves clarity, but no extra abstraction layer is added solely for style.

### 3. Local WebSocket hub

`PlaybackRealtimeHub` remains process-local and owns only live socket bookkeeping and delivery to sockets connected to that process.

Its responsibilities remain:

- register a `(user_id, device_id)` socket;
- replace a previous socket for the same user/device and close the previous socket;
- prevent stale disconnect cleanup from removing a replacement socket;
- query local connected device ids;
- deliver to a local target socket;
- broadcast to local sockets;
- remove failed/dead sockets.

It must not become the source of truth for command or playback state.

### 4. Cross-replica PostgreSQL event bridge

A small event service provides best-effort, low-latency process-to-process signaling using PostgreSQL `LISTEN`/`NOTIFY`.

The notification channel is fixed and application-owned, for example:

`hypersync_playback_events`

Notification payloads stay intentionally small and contain identifiers/event metadata only, such as:

- schema version;
- event kind;
- user id;
- target or source device id when relevant;
- optional durable command id.

Durable playback state and command bodies stay in database tables. The listener reads authoritative state when necessary rather than encoding large state in notification payloads.

PostgreSQL notifications are delivered only after the transaction that issued them commits. This allows an event to signal already-durable work.

### 5. Direct listener connection

The long-lived `LISTEN` session must use one dedicated direct PostgreSQL connection per API process.

It must not use a transaction-pooled PgBouncer/Neon pooled endpoint, because `LISTEN` is session-scoped and depends on one persistent database session.

A specifically named runtime setting will represent the direct listener connection URL instead of overloading migration configuration. The normal SQLAlchemy request/session pool continues using the existing application database URL.

Operational requirements:

- listener connection starts during application lifespan;
- listener commits `LISTEN` before relying on notifications;
- disconnects trigger bounded exponential reconnect with jitter;
- shutdown cancels the listener and closes the direct connection cleanly;
- listener failure is logged and does not stop the API;
- one process consumes at most one dedicated listener connection;
- normal HTTP/WS database work does not use the listener connection.

### 6. Notification semantics

Notifications are hints, not durable messages.

A writer follows this order:

1. validate and mutate durable PostgreSQL state/commands;
2. issue `pg_notify(...)` inside the same transaction where appropriate;
3. commit;
4. optionally perform immediate local-socket delivery when useful.

A receiving process maps a notification to its local WebSocket hub and, when necessary, reloads authoritative data from PostgreSQL before sending it to clients.

Duplicate notifications and a sender receiving its own notification are harmless. Handlers must be idempotent at the event level.

Missed notifications are acceptable because durable state/commands are recovered by polling/reconnect state synchronization.

### 7. Frontend realtime strategy

The frontend remains WebSocket-first.

Existing behavior stays intact:

- persistent per-tab playback device id;
- authentication using the access token;
- 15-second heartbeat;
- request ids for realtime commands;
- command ACK/error handling;
- bounded command ACK timeout;
- pending requests rejected on close;
- socket close owns reconnect behavior;
- HTTP command fallback if realtime command delivery cannot be used;
- realtime playback-state publication when connected.

The refactor adds two resilience improvements:

#### Reconnect backoff

Replace the near-fixed reconnect delay with bounded exponential backoff plus jitter. A successful `ready` resets the backoff.

The reconnect algorithm must:

- reconnect quickly after the first transient loss;
- avoid synchronized reconnect storms across clients;
- cap the maximum delay;
- never schedule duplicate reconnect timers;
- stop cleanly when the owning effect/session is cancelled.

#### Safety polling while realtime is healthy

Keep a low-frequency device poll even while the WebSocket reports healthy.

This poll is not the primary realtime channel. It exists to recover durable commands/state if:

- a notification was missed;
- a listener was reconnecting;
- a client socket looked healthy while a command was persisted on another replica;
- presence/state notification delivery was interrupted.

The safety poll interval should be slow enough to avoid meaningful database churn and faster polling may resume when realtime is unavailable.

## Database and connection ownership

Normal request/query traffic continues through the bounded SQLAlchemy async pool and existing API admission controls.

The event listener owns exactly one direct asyncpg connection per API process and does not participate in request transactions.

Playback heartbeat traffic stays in memory unless a normal presence refresh is needed by existing device-poll behavior.

Playback state writes remain throttled/coalesced so client position ticks do not translate one-for-one into database writes.

No new database table is required for notifications. Existing durable playback state and command tables remain the authority. Alembic changes are only introduced if implementation discovers an unavoidable schema requirement; such a change requires its own compatibility review before being made.

## Failure handling

### Listener unavailable

The API continues serving normally. Local WebSockets still work within each process. Durable commands and playback state remain recoverable through safety polling and reconnect synchronization.

### Notification dropped or duplicated

No correctness failure occurs. Duplicate events may cause a harmless extra state read/send. Missed events are recovered from PostgreSQL.

### Target socket on another replica

The durable command is committed first. The notification reaches all listening API processes; only the process holding the target socket delivers to it. If no process delivers, the target later receives the durable command through polling/reconnect recovery.

### Target socket send fails

The local hub removes the failed socket. The durable command remains recoverable unless the implementation has positively completed the same existing consumed-state transition that current realtime delivery uses.

### API process restart

The listener and local sockets are ephemeral. Durable playback state and unconsumed commands survive in PostgreSQL. Clients reconnect and recover state.

### Direct database listener reconnect

The listener re-establishes `LISTEN`, then performs a reconciliation step sufficient to avoid depending on notifications that may have occurred during the disconnected window. Client safety polling remains the final recovery path.

## Security

- Notification payloads contain ids/event metadata only, not access tokens or secrets.
- WebSocket authentication remains access-token based.
- Playback commands remain scoped to the authenticated user.
- Device ids remain validated and length-bounded.
- The listener connection uses the same database trust boundary as the backend and is never exposed to clients.
- Existing HTTP/WebSocket authorization behavior remains unchanged.

## Testing strategy

Implementation is test-first at each ownership boundary.

### Characterization tests before extraction

Add or strengthen tests covering:

- playback queue canonicalization;
- active-device stale-writer rejection;
- device TTL and live-socket presence interaction;
- stale-device pruning side effects;
- command supersession/coalescing;
- polling consumes the correct durable command batch;
- realtime successful delivery and failed delivery behavior;
- reconnect/recovery contract expected by the frontend.

### Local hub tests

Preserve and extend tests for:

- replacement socket closes old socket;
- stale disconnect cannot remove replacement;
- failed send removes dead socket;
- broadcast cleanup;
- target-only send behavior.

### Cross-replica bridge tests

Use isolated bridge/hub instances to model separate API replicas and verify:

- a command persisted by replica A can be signaled to a socket on replica B;
- only the process with the target socket sends the command;
- duplicate notification handling is harmless;
- listener loss does not delete or consume durable commands;
- reconnect/reconciliation recovers authoritative state;
- malformed/unknown event payloads are ignored safely;
- event payload versioning rejects unsupported future formats without crashing the listener.

### Frontend tests

Add tests for:

- exponential reconnect growth and maximum cap;
- jitter staying inside defined bounds;
- successful `ready` resets reconnect attempts;
- only one reconnect timer exists;
- safety polling continues at low frequency while realtime is healthy;
- faster fallback behavior when realtime is unavailable;
- durable command recovered by poll is handled once;
- existing command ACK timeout and close cleanup remain unchanged.

### Full verification gate

Before this subsystem is declared complete, the exact final `Shane` commit must pass all repository verification, including:

- PostgreSQL backend tests;
- playback/account concurrency tests;
- WebSocket tests;
- Ruff/Pyright/static checks;
- security/audit checks;
- frontend unit/regression tests;
- frontend build/image checks;
- offline/PWA checks;
- Windows runner;
- isolated browser journeys;
- production backend image checks.

No media/offline subsystem changes begin until this gate is green.

## Migration sequence

Implementation should proceed in small green checkpoints:

1. add missing playback characterization tests;
2. extract pure playback response/queue/state helpers into the playback domain home;
3. move device presence/pruning/list operations behind the playback service;
4. move durable command issue/poll/consume logic behind the playback service;
5. move playback-state mutation/ownership rules behind the playback service;
6. reduce HTTP routes to transport adapters;
7. reduce WebSocket handler business logic to transport/event dispatch;
8. add the PostgreSQL cross-replica event bridge and lifecycle management;
9. add frontend reconnect backoff and healthy-socket safety polling;
10. run and repair the complete verification gate.

Each checkpoint should preserve existing behavior and run the most relevant focused tests. The complete gate is mandatory before the subsystem is considered done.

## Expected code ownership after consolidation

The exact filenames may be adjusted to follow existing repository conventions, but ownership must remain clear:

- `backend/app/api/routes/users.py`: existing user HTTP/WS transport only;
- `backend/app/services/playback.py` or equivalent: playback domain/state/device/command operations;
- `backend/app/services/playback_realtime.py`: local WebSocket hub only;
- `backend/app/services/playback_events.py` or equivalent: cross-replica PostgreSQL notification bridge;
- `backend/app/main.py`: event-listener lifecycle startup/shutdown only;
- `backend/app/config.py`: explicit direct realtime-listener database setting;
- `frontend/src/playbackDevices.js`: WebSocket transport, reconnect/backoff, HTTP fallback/safety polling primitives;
- higher-level frontend integration: orchestration only, with existing player behavior preserved.

## Source constraints verified during design

The event-bridge design relies on these PostgreSQL properties:

- `LISTEN` registrations belong to a database session and are cleared when that session ends;
- `LISTEN` takes effect at transaction commit;
- `NOTIFY` sent inside a transaction is delivered only if/when the transaction commits;
- notifications support small payload strings; PostgreSQL documents a default payload limit below 8000 bytes and recommends storing larger data in tables and notifying by key.

References:

- https://www.postgresql.org/docs/18/sql-listen.html
- https://www.postgresql.org/docs/current/sql-notify.html
- https://neon.com/docs/connect/connection-pooling

The runtime design therefore uses a dedicated direct session for `LISTEN`, keeps notification payloads small, and leaves authoritative data in PostgreSQL tables.

## Completion criteria

The playback/realtime subsystem is complete only when all of the following are true:

- existing playback HTTP and WebSocket contracts remain compatible;
- playback business rules have one obvious backend owner;
- routes no longer duplicate playback domain logic;
- WebSocket handlers no longer own durable command/state rules;
- playback works correctly when sockets for the same user are connected to different API processes;
- loss of the event bridge degrades latency but not correctness;
- durable commands cannot be stranded solely because a notification was missed;
- frontend reconnect behavior is bounded and non-storming;
- database heartbeat/state write pressure remains controlled;
- the complete repository verification gate passes on the exact final commit.
