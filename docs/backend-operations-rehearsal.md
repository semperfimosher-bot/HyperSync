# Backend migration, load, and recovery rehearsal

This procedure targets an isolated local PostgreSQL database, local application,
and disposable storage fixtures. It does not establish production capacity or
validate live B2 access. Do not use a tunnel or local proxy to production.

## Migrations once per release

The image keeps `MIGRATE_ON_START=true` as its default. It retries failed
migrations up to `MIGRATION_MAX_ATTEMPTS` (default 12) and starts the server only
after a successful upgrade. For a release-managed deployment:

1. Back up the database and record the application image and current Alembic
   revision. Rehearse the restore in a disposable database before the release.
2. Run `python -m alembic -c /app/alembic.ini upgrade head` once as the release
   command using the new image and the **direct** `MIGRATION_DATABASE_URL`.
   Session advisory locks require a session-preserving direct connection; do
   not use a transaction pooler for migrations.
3. Require the release command to succeed, then start all application replicas
   with `MIGRATE_ON_START=false`. That switch assumes release orchestration has
   already migrated the database; it does not itself check the schema version.
4. Check readiness and application journeys before routing traffic to replicas.

All online Alembic paths acquire the same PostgreSQL session advisory lock on
the actual migration connection before inspecting/applying revisions. The lock
survives individual transaction commits. The lock-acquisition SELECT is
committed before Alembic starts its own transaction, so SQLAlchemy autobegin
cannot silently turn migration DDL/version writes into a rollback-on-close.
Unlock runs in `finally`; a failed unlock invalidates the physical connection.
Caller-managed transactions retain an additional same-key transaction lock until
the caller commits or rolls back, so competitors cannot enter during the gap
between session unlock and the caller's final commit. A crashed process releases
its lock when PostgreSQL closes its session; operators should investigate a
stuck migration/session rather than bypassing the lock or changing its key.

Offline `alembic --sql` generates SQL without connecting or locking. Executing
that SQL manually requires equivalent coordination by the operator.

## Connection and request budgets

Compute a budget before increasing workers or replicas. For application replicas
`R`, Uvicorn processes per replica `W`, SQLAlchemy `DB_POOL_SIZE=P`, and
`DB_MAX_OVERFLOW=O`, the maximum application connections are:

`R * W * (P + O)`

Add release migrations, verification, backup/monitoring/admin connections and
headroom below the provider's connection ceiling. The defaults are one Uvicorn
process, pool size 3, overflow 2: five connections per replica/process, before
those reservations. Durable maintenance shares the process database pool;
include its concurrency and lease work when assessing request admission. Adding
processes multiplies workers as well as pools. Queue leases coordinate ownership
across processes; they do not add database capacity.

`UVICORN_LIMIT_CONCURRENCY` defaults to 32 per process, backlog to 256 and
keep-alive to 10 seconds. Admission exhaustion can return HTTP 503 rather than
queueing work without bound. Account for database admission limits, timeouts,
worker batch/lease/deadline configuration and storage latency together. A larger
HTTP concurrency setting alone does not improve database throughput. Record
replica/process counts, pool values, CPU/RAM limits, dataset size and active jobs
alongside each benchmark; health-only throughput does not measure catalog,
upload, storage or maintenance capacity.

## Repeatable HTTP load and recovery

Start an isolated backend with an owned local database and disposable fixture
storage. The verification harness (`python scripts/verify_project.py --suite
full`) provisions isolated test databases when given an explicitly local test
PostgreSQL service; see the existing verification documentation for setup.

Run from the repository root, saving output in an ignored results directory:

```sh
mkdir -p verification-results
python scripts/load_recovery.py \
  --url http://127.0.0.1:8000/health \
  --requests 200 --concurrency 8 --timeout 2 \
  --recovery-requests 20 --max-seconds 60 \
  > verification-results/load-recovery.json
```

The runner sends unauthenticated GET requests in sequential baseline, concurrent
load, and sequential recovery phases. Each report contains completed requests,
status counts, 503 count, HTTP errors, timeouts, transport errors, request rate
and p50/p95/max time to response headers. It closes responses without reading
bodies, so these latencies do not include media download completion. Percentiles
include failed and timed-out attempts. All paths must be safe GET endpoints;
choose a fixture route representative of the intended workload when measuring
more than readiness. No credentials or response bodies are printed.

Safety limits are enforced before the first request: HTTP literal loopback only
(`127.0.0.1` or `[::1]`), no credentials/query/fragment, no proxies or redirects,
at most 10,000 requests per phase, concurrency 64, socket timeout 30 seconds and
whole-run wall-clock deadline 300 seconds (default 60). A separate process is
terminated at that deadline, including when a server trickles headers. Exit 124
means deadline exhaustion; exit 1 means the recovery phase still had HTTP errors,
timeouts or transport failures. Inspect every phase: a successful recovery exit
does not mean load had no rejections. Never expose a production service through
a loopback tunnel to circumvent these limits.

Repeat a small concurrency ladder (1, 4, 8, 16, 32) with the same fixture and
record p95, 503, timeout, pool-wait and maintenance queue depth. Stop escalating
when rejections or latency exceed the deployment's explicit service objective.
The tool does not modify or restart infrastructure. During a separate controlled
local outage rehearsal, use a bounded run while stopping/restarting only the
owned local backend/database, then run it again after readiness returns. Capture
outage timing, first successful readiness after restart and queue drain time
alongside the reports. The three HTTP phases alone do not simulate a database
crash or prove durable-job recovery.

## Controlled backup, restore and worker restart

1. Create a uniquely named, owned disposable source database and fixture bucket
   or local storage adapter. Assert it is not a live account/database before
   mutating anything. Insert fixture users, playlists, tracks and queued jobs
   through the local application and record counts, memberships, media hashes,
   pending job identities and Alembic revision without credentials or PII.
2. Take a logical `pg_dump --format=custom` backup to a restricted temporary
   directory. Supply database credentials through the PostgreSQL password file
   mechanism or your secret manager, never CLI URLs or checked-in files. Back up
   fixture object bytes and their object-key manifest separately; a database
   dump does not contain audio/artwork bytes.
3. Restore with `pg_restore --exit-on-error --no-owner --no-acl` into a **new,
   empty owned database**. Do not use `--clean` against a shared/live target.
   Reconnect the isolated app to that database and the copied fixture objects.
   Compare revision, table counts, playlist order/membership, pending jobs and
   media hashes. Run the same application journeys and HTTP rehearsal.
4. Queue fixture maintenance, record job identifiers, stop the owning worker
   after claim, then restart it. Verify the durable job remains in PostgreSQL,
   the expired lease becomes reclaimable within the configured lease/poll
   window, retries/backoff persist, and one completed outcome is visible without
   duplicated playlist membership. Exercise a simulated provider failure and
   verify retries preserve committed audio. Record observed lease and drain
   timings; an HTTP health success alone does not prove these properties.
5. Time the backup and restore/restart separately for an observed rehearsal RPO
   (age of the restored backup) and RTO (outage to verified service recovery).
   Record dataset size and the missing-media check. These observations are not
   guarantees for a larger deployment.
6. Clean up only resources whose ownership markers match this rehearsal. Treat
   dumps/object copies as sensitive; remove them according to the data policy.

Prefer rolling the application image back only when the prior image is known
compatible with the new schema. Data-repair migrations can be irreversible in
practice; inspect each downgrade before considering it. If compatibility is
uncertain, stop writes and rehearse restoring the pre-release database plus its
matching object snapshot into an isolated target, then explicitly plan cutover.
Restoring a database alone cannot recover deleted B2 objects. Never claim that a
DB rollback restored storage bytes after a partially successful media deletion.

## Evidence boundaries

Offline tests use fake migration connections and an actual local HTTP test
server to check transaction ordering, cleanup, startup gating, metrics and
safety bounds. Real PostgreSQL tests in
`tests/test_migration_coordination_postgres.py` check simultaneous migrations,
committed schema/version and lock lifetime/release on disposable databases.
They require the CI/local PostgreSQL service and are not evidence until run.
Production TLS, provider limits, B2 deletion consistency, network partitions,
restore throughput and real deployment load remain separate operator exercises.

## Durable track maintenance

Uploads insert metadata and generated-playlist jobs in the same transaction as the track. A successful upload means audio/catalog persistence succeeded and maintenance was queued; enrichment completion still depends on provider matches. Each enabled API process executes at most one job at a time. `MAINTENANCE_WORKER_ENABLED=false` makes an API-only replica; retain at least one enabled process. Idle workers poll every two seconds.

Claims use PostgreSQL `FOR UPDATE SKIP LOCKED` and a unique ownership token. Work has a 240-second deadline and a 600-second lease. Process termination leaves the claim recoverable after lease expiry. Failed work retries with exponential delay, up to eight claims; exhausted jobs stay in the database. Playlist work has a generation counter: metadata updates reopen completed work or request another generation after an active lease, preventing an old worker from acknowledging newer changes. Provider exceptions are recorded by class, without credential-bearing URLs.

Administrators can inspect aggregate counts at `GET /api/admin/maintenance/jobs`. Exhausted IDs are included in backend warning logs and can be retried through `POST /api/admin/maintenance/jobs/{id}/retry`; active leases cannot be stolen by that endpoint. Operators can also inspect the `maintenance_jobs` table on their authorized database. Retry after addressing the provider/configuration error. Jobs for deleted tracks cascade away; completed records currently remain as an audit trail.

The isolated CI suite exercises atomic enqueue/rollback, expired leases, stale acknowledgements, retry/backoff, newer-generation handoff, concurrent playlist writes, migration preservation/serialization, and API burst/failure/recovery. The standalone HTTP runner reports measured latency/503/transport counts. Neither establishes a production user limit, real-provider SLA, or a successful restore of your actual backups.
