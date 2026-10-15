# Playback realtime operations

The PostgreSQL playback event bridge is an optional low-latency hint channel. PostgreSQL playback state and command rows remain authoritative; notifications are never the only copy of a command.

## Configuration

Set PLAYBACK_REALTIME_DATABASE_URL to a direct PostgreSQL connection endpoint for LISTEN/NOTIFY. Do not use a transaction-pooled PgBouncer/Neon endpoint: LISTEN is tied to a persistent database session. The normal DATABASE_URL remains the bounded SQLAlchemy request pool. Each API process opens at most one additional direct listener connection.

If PLAYBACK_REALTIME_DATABASE_URL is empty, the API starts without the bridge. Local WebSockets and HTTP polling continue to work, but cross-replica updates may be delayed until a client poll or reconnect.

## Failure and recovery

The listener reconnects with bounded exponential backoff and jitter. A listener failure is logged and does not stop HTTP request handling. Event payloads contain identifiers only; durable state and commands are reloaded from PostgreSQL. Malformed or unsupported event versions are ignored.

The frontend must retain safety polling while the socket appears healthy. If notifications are missed during a listener outage, the next device poll or reconnect reloads authoritative state and unconsumed commands.

## Operational checks

1. Confirm each replica has PLAYBACK_REALTIME_DATABASE_URL configured with a direct endpoint.
2. Check startup logs for the playback cross-replica listener connection message.
3. Temporarily interrupt the listener connection in a non-production environment and verify the API stays available and pending commands are recoverable by polling.
4. Restore connectivity and confirm the listener reconnects without restarting the API.
5. Verify no secrets or full playback state are present in notification payloads.
