# Server memory and recovery design

Goal: reduce peak and retained server memory as audio, catalog and refresh fanout grow, preserve API/data behavior, and replace documented-only recovery claims with disposable PostgreSQL evidence. No live infrastructure changes.

Use disk-backed upload/compression/backfill paths with bounded metadata reads and 5 MiB artwork, preserving optional compression policy. Keep temporary files/admission permits alive until blocking work settles after cancellation. Keep legacy sorted catalog arrays by spooling bounded 250-row partitions to disk before headers; send disk chunks without a DB connection. Paged responses remain unchanged.

Fail fast before body parsing when one expensive upload/backfill or one legacy export is active. Cap simultaneous media streams at four per process. Explicitly bound B2 SDK worker pools and buffers. Configuration can raise these only after measurement; process/replica counts multiply budgets. Temporary storage must be disk-backed to realize the RAM benefit.

Stream artist candidates, retain only 500 winners, and page smart targets at 64 to bound 120-candidate heaps. Preserve exact artist/collaboration matching, sort order, lock discipline and freshness. Listening-history aggregation remains database work; broad fanout can still exceed job deadlines.

Bound external provider JSON to 2 MiB, requesting identity encoding and rejecting unexpected compression before decoding. Bound transient lyrics cooldown entries. Measure fresh-process RSS and traced Python allocations for scaled catalog fixtures and disk-backed audio, clearly separate from real deployment capacity.

Exercise real pg_dump/pg_restore between ownership-marked disposable databases and copy fixture media with hash verification. Kill a process after its job claim, restart a replacement with an explicitly shortened test lease, prove reclaim, token fencing and completion. Keep production lease unchanged. Never touch production credentials, buckets or databases.
