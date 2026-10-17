# Server memory budgets and measurements

This pass removes known whole-audio and whole-catalog Python allocations. It does not set a universal server RSS maximum or certify capacity for an unknown deployment.

## Defaults per process

| Resource | Bound |
| --- | --- |
| Expensive upload/finalize/backfill requests | 1; excess503 before multipart parsing |
| Audio/artwork streams | 4; permit held through producer cleanup |
| Legacy full catalog exports | 1;250-row database partitions,64KiB response reads |
| Paged catalog | 500 rows maximum; frontendrequests250 |
| Audio upload copy | 1MiB chunks into disk-backed temporary storage |
| Embedded metadata | 8MiB cumulative parser reads; complex/compressed/nested ID3 skipped |
| Artwork | 5MiB |
| Artist ranking | 256-row stream,500 winning IDs |
| Smart refresh | 64 targets per page,120 candidates per distinct query |
| Provider success bodies | 2MiB; identity encoding required; error bodies discarded |
| B2 SDK | 1upload,1copy,2download workers;1stream/file;256KiB save buffer |
| Lyrics cooldown cache | 1024 entries; expired entries evicted |

`MEDIA_MAX_CONCURRENT_UPLOADS`, `MEDIA_MAX_CONCURRENT_STREAMS`, and `CATALOG_MAX_CONCURRENT_EXPORTS` must be positive. Raise after measuring, not to hide503s. Multiply process-local budgets by Uvicorn workers and replicas. Database admission and connection budgets remain separate. The browser serializes server upload/finalize work within each tab while direct-to-B2 network transfers may overlap. Other clients can receive503 and retry; ambiguous POST failures are not automatically replayed.

Temporary storage must be a real disk volume with free space: configure `TMPDIR` on Unix or `TEMP`/`TMP` on Windows before starting the server. A tmpfs `/tmp` charges file spools to container RAM. Uploads may temporarily occupy the parsed upload, source copy and converted result; large legacy exports occupy their JSON size. Disk exhaustion fails setup instead of sending partial success. Slow clients retain their export/media slot until close; request or SDK timeouts, process shutdown and disconnect cleanup bound resource lifetimes.

Legacy catalog responses preserve the sorted JSON array contract but prepare it on disk before sending headers. All database and presigning work finishes before the download starts. Paged clients avoid this full-export disk and setup cost. The frontend still retains its assembled catalog in browser memory. Metadata parser read limits and skipped expanding tags reduce memory risk; they are not an RSS sandbox for every codec. FFmpeg, runtime imports, allocator high-water marks, database sort/aggregate work, kernel page cache and concurrent ordinary requests are outside the fixture allocation numbers.

## Reproduce measurements

Run `python -m scripts.memory_profile`. It creates six fresh Python processes and writes `verification-results/memory.json`; CI uploads this with the usual verification artifact. Fixtures use a synthetic streaming session and real disk file copying, with compression disabled. SHA256 verifies the old bulk-reference and new legacy responses are byte-identical. No network credentials or production data are used.

Initial local result:

| Fixture | Bulk Python peak | New Python peak | New process peak RSS |
| --- | --- | --- | --- |
| 1,000 catalog tracks | 3.21MiB | 0.83MiB | 77.9MiB |
| 10,000 catalog tracks | 32.13MiB | 0.83MiB | 78.4MiB |
| 8MiB audio copy, compression disabled | — | 2.01MiB | 91.6MiB |
| 64MiB audio copy, compression disabled | — | 2.01MiB | 92.0MiB |

At10,000 tracks the traced allocation peak is about97% lower. RSS includes imports and varies by machine; it is not deployment total memory. Database-backed and FFmpeg/B2 workloads require separate deployment measurements.

The CI operational rehearsal passed on commit2a52d5f using real pg_dump/pg_restore and a killed worker against disposable PostgreSQL17. See isolated-recovery-evidence.md. Live B2 interruptions, realistic soak tests and production backup restoration remain deployment rehearsals, never inferred from mock tests or small fixture timing.
