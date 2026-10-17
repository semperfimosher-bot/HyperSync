# Server Memory Implementation Plan

**Goal:** Bound known server allocations and demonstrate isolated recovery and memory scaling.
**Architecture:** Keep FastAPI/PostgreSQL/B2; replace whole-file/full-list allocations with disk or fixed batches. Add lifecycle admission and measured fixture rehearsals.
**Spec:** docs/superpowers/specs/2026-10-17-server-memory-design.md

Global constraints: preserve API arrays/compression/data; no live operations; no local PostgreSQL installation. Use existing branch and disposable full CI. Request ceiling remains64MiB. Test-first behavior changes and independent review.

- [x] Upload: admin.py, audio_metadata.py/audio_compression.py and thread_work.py; failing bounded-copy, metadata budget, disk compression, artwork ceiling, cancellation/ack-loss tests; preserve successful and retry behavior.
- [x] Ranking: generated_playlists.py and focused tests; streaming top500 artist candidates, scalar freshness,64-target smart keyset pages, no live cursor across commits; preserve ranking and membership.
- [x] Admission/catalog: memory_admission.py, main.py/config.py, disk_response.py/catalog.py; before-body503, full-response permit lifetime,250-row legacy spool, DB closed before headers, cancellation cleanup.
- [x] Provider/storage: bounded_http.py and provider callers;2MiB actual response limit, identity encoding, status/retry compatibility; explicit SDK pools/buffers; bounded cooldown cache.
- [x] Evidence: scripts/memory_profile.py fresh-process fixture allocations/RSS and output-size equivalence; operational_rehearsal.py real dump/restore and killed worker in CI; strict disposable ownership/cleanup/deadlines.
- [ ] Run scoped regression tests, full lint/types, independent review; publish same PR via leased ref and require both complete CI workflows on final revision. Report measured results with deployment limits.

Review focus: slow/disconnected clients; repeated cancellation while thread mutates objects; compressed malicious tags/provider replies; legacy JSON shape/order/header compatibility; deadline cleanup and stale job tokens after actual process death.
