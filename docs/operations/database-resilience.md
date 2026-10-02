# Database resilience and capacity

This guide applies to the HyperSync FastAPI service using SQLAlchemy async and
PostgreSQL/Neon. These controls reduce overload risk; they do not make a database
failure impossible.

## Connection budget comes first

SQLAlchemy's pool is **per process**, not global. Calculate the maximum possible
application connections as:

`replicas × workers_per_replica × (DB_POOL_SIZE + DB_MAX_OVERFLOW)`

Add connections used by migration commands, administrative scripts, and any
other service sharing the database. Keep the total below the database/provider
limit with room for provider operations and emergency access.

`API_MAX_CONCURRENT_REQUESTS` is also per process. It must be chosen with the
pool settings and workload, not copied unchanged when scaling replicas or
workers. The settings validator requires at least two pool slots beyond the
admission limit for non-request work, but that local check cannot calculate the
global budget across replicas.

Prefer a small, explicit `DB_MAX_OVERFLOW` in production rather than allowing
large connection bursts. Do not raise pool size to treat slow queries as a
capacity problem; inspect query duration and pool wait first.

## Runtime safeguards

- `pool_pre_ping` checks pooled connections before use.
- `pool_recycle` replaces aged connections.
- `pool_use_lifo` favors recently used connections.
- `DB_POOL_TIMEOUT_SECONDS` bounds how long a request waits for a pool slot.
- `DB_COMMAND_TIMEOUT_SECONDS` bounds client-side database command waits.
- `DB_STATEMENT_TIMEOUT_MS` asks PostgreSQL to cancel long-running statements.
- `DB_LOCK_TIMEOUT_MS` bounds time waiting to acquire a database lock.
- `DB_IDLE_TRANSACTION_TIMEOUT_MS` closes sessions left idle inside a transaction.
- Admission control rejects excess work with a retryable 503 instead of allowing
  an unbounded queue of requests to accumulate. Liveness remains independent of
  database readiness; readiness is admission-controlled because it queries DB.

The PostgreSQL server-side settings are applied to runtime connections. They
do not change migration connections, which should use the separate direct
`MIGRATION_DATABASE_URL`.

## Production deployment checklist

1. Confirm `DATABASE_URL` is the provider's pooled runtime URL and
   `MIGRATION_DATABASE_URL` is the direct/non-pooled migration URL.
2. Determine the actual Neon connection limit and all consumers.
3. Set pool size, overflow, API concurrency, replica count, and worker count
   using the connection-budget formula above.
4. Keep secrets out of frontend variables and logs.
5. Run migrations as a controlled, single deployment step; do not run migrations
   independently in every web worker.
6. Deploy to a staging database first and run the automated suite and load test.
7. Watch pool timeouts, PostgreSQL statement cancellations, lock timeouts,
   connection counts, request latency, and 5xx rates during rollout.
8. Roll back the application release if error rates rise. Do not run destructive
   database changes as an automatic rollback.

## When the database is under pressure

1. Check provider connection usage and database health.
2. Check whether pool timeouts or server-side statement/lock timeouts dominate.
3. Reduce incoming application replicas/concurrency if connection demand exceeds
   the budget; do not increase pool settings blindly.
4. Identify slow or blocked SQL before changing indexes or query plans.
5. Let bounded requests fail fast and recover as capacity returns. Avoid adding
   immediate retries to every request, which can amplify an outage.
6. Verify readiness recovers and liveness remained available.

## Known limits

Admission control is process-local. It does not coordinate capacity across
multiple replicas, and it does not cap independent background jobs. The current
background maintenance tasks and catalog workers must be included in load and
multi-replica testing. A distributed job lease/queue may be needed before
running multiple API replicas if those jobs are not already coordinated.
