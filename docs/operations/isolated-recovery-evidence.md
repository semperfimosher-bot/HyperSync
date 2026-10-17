# Disposable recovery evidence

The full Project verification workflow runs `scripts.operational_rehearsal`
against its PostgreSQL 17 service. It uses the matching `pg_dump`/`pg_restore`
clients inside that service container; no host client installation is needed.
The service must be explicitly disposable and local, without a production tunnel.

The rehearsal creates two randomly named databases with ownership comments. It
migrates the source through the real application migrations, inserts a fixture
account, three tracks, an ordered playlist and a pending playlist-maintenance
job, then takes a custom-format logical dump. It restores into the other empty
owned database without `--clean` or `--create`. Application table counts,
Alembic revision, playlist membership/order and pending job identities must
match exactly. Separate disposable media files are copied and SHA-256 checked;
the database dump contains no media bytes.

A spawned Python process claims the restored job and is killed after confirming
its claim committed. A new process waits for the real lease timestamp to expire,
reclaims the same job with a new token, executes the application playlist
handler and completes it. The old token must fail acknowledgement. The final
database must contain exactly one completed job and no duplicate memberships.
Only rehearsal children shorten the lease to two seconds; production retains
its normal lease. This tests actual process death and durable database state,
using a deliberately shortened wait.

The workflow saves `verification-results/operations.json` in its existing
verification artifact. The JSON includes backup/restore/restart timings, dump
size, restored counts, media hashes, fencing results and cleanup status. Dumps
and fixture objects stay in a restricted temporary directory and are removed.
Cleanup drops databases only when their ownership comments match. Process,
client and overall deadlines bound the work. Credentials enter PostgreSQL
clients through environment variables and are never logged or included in
command arguments.

The exercise has a 180-second budget. Cancellation waits for the active blocking
operation to settle before closing its files or removing databases: dump/restore
clients have 45-second deadlines, while worker exchanges have 25-second
deadlines plus bounded process termination/join. Ownership-checked database
cleanup has a further 20-second budget per database. The workflow grants five
minutes for the exercise, settlement and cleanup together. A timeout fails the
report even when later cleanup succeeds.

To repeat on an already running disposable local PostgreSQL Docker service:

```sh
export HYPERSYNC_TEST_POSTGRES_URL='postgresql://fixture:fixture@127.0.0.1:5432/fixture'
python -m scripts.operational_rehearsal --postgres-container YOUR_CONTAINER_ID
```

Offline safety checks run with:

```sh
python -m pytest scripts/tests/test_operational_rehearsal.py -q
```

Successful CI evidence establishes recovery for these fixture data and this
process failure. It does not restore an actual deployment backup, contact B2,
exercise provider network partitions, establish production capacity, or
guarantee recovery times for a larger dataset. Restore duration measures local
replay and validation; restart duration includes child startup and lease expiry.
