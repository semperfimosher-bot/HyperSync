# Project verification

Use Python 3.12 and Node 24.

Commands:

- `python -m pip install -r requirements.dev.txt`
- `npm ci --prefix frontend`
- `python scripts/verify_project.py --suite quick`
- `python scripts/verify_project.py --suite full`

Quick runs backend tests, Python lint/type checks, frontend offline regression tests,
and a production build. Full adds dependency/security checks, a backend Docker build,
and disposable PostgreSQL verification. Browser automation and separately installed
browser binaries are no longer required. Use `--list` to list checks without running them.

Full requires an explicitly disposable local PostgreSQL service with database creation
privileges. Set `HYPERSYNC_TEST_POSTGRES_URL` to its admin connection URL. Only localhost,
127.0.0.1, and ::1 endpoints without query overrides are accepted. Never use a tunnel
to a live database. The runner creates a random `hs_verify_...` database, exercises
migrations and concurrent writes, and removes only the database it owns.

Each run writes a report under `verification-results/<timestamp-run-id>/`, including
`index.html`, `summary.md`, `results.json`, and command logs. Exit codes: 0 all required
checks passed; 1 failure/interruption; 2 blocked/incomplete. Reports marked `state: running`
are incomplete.

Read-only deployed smoke:
`python scripts/verify_project.py --suite production-smoke --target https://hypersynced.app`

This requests GET `/` and GET `/health/ready` on the supplied HTTPS origin. It sends no
credentials and performs no mutations. HTTP success does not prove the deployed commit
or playback. Remaining automated tests do not certify B2 uploads, SMTP, lyrics, metadata
providers, push delivery, or internet streaming; those still need targeted/manual checks.
Verification is separate from deployment and does not modify production data.
