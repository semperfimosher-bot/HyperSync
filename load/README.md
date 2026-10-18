# HyperSync staging load tests

## Safety first

Run these tests only against a staging deployment and isolated test database that
you control. Do not point them at `https://api.hypersynced.app` or another
production system unless a load-test window has been explicitly approved. The
tests generate real requests and can cause a small deployment or database to
return retryable `503` responses.

## Requirements

- k6 installed locally: https://grafana.com/docs/k6/latest/set-up/install-k6/
- A reachable staging API origin, with no trailing path.
- Optional: a dedicated registered **staging** account's access token to test
  private library and playlist endpoints. Never use an administrator token,
  commit a token, or paste a token into chat.

## Run on Windows PowerShell

From the repository root, start with the lower-concurrency test:

```powershell
$env:TARGET_BASE_URL = "https://YOUR-STAGING-API"
$env:EXPECTED_STAGING_HOST = "YOUR-STAGING-API-HOSTNAME"
$env:CONFIRM_STAGING_ONLY = "YES" # only after verifying isolated staging
# Optional; omit this line to test public browsing only.
$env:TEST_AUTH_TOKEN = "YOUR-DEDICATED-STAGING-USER-ACCESS-TOKEN"
k6 run load/k6-40-users.js
Remove-Item Env:TEST_AUTH_TOKEN -ErrorAction SilentlyContinue
Remove-Item Env:TARGET_BASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:EXPECTED_STAGING_HOST -ErrorAction SilentlyContinue
Remove-Item Env:CONFIRM_STAGING_ONLY -ErrorAction SilentlyContinue
```

Only after the 40-user run passes and the staging service recovers cleanly, run
the 100-user / large-catalog test:

```powershell
$env:TARGET_BASE_URL = "https://YOUR-STAGING-API"
$env:EXPECTED_STAGING_HOST = "YOUR-STAGING-API-HOSTNAME"
$env:CONFIRM_STAGING_ONLY = "YES" # only after verifying isolated staging
# Optional: use only a dedicated staging user's token.
$env:TEST_AUTH_TOKEN = "YOUR-DEDICATED-STAGING-USER-ACCESS-TOKEN"
k6 run load/k6-100-users.js
Remove-Item Env:TEST_AUTH_TOKEN -ErrorAction SilentlyContinue
Remove-Item Env:TARGET_BASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:EXPECTED_STAGING_HOST -ErrorAction SilentlyContinue
Remove-Item Env:CONFIRM_STAGING_ONLY -ErrorAction SilentlyContinue
```

Use the actual staging API origin, for example
`https://staging-api.example.com`. Do not use a production URL. All three
scripts reject the known production hosts `hypersynced.app`,
`www.hypersynced.app`, and `api.hypersynced.app`; reject origins with
credentials, paths, query strings, or fragments; require
`CONFIRM_STAGING_ONLY=YES); and require the exact hostname to match
`EXPECTED_STAGING_HOST`. Set those confirmation variables only after
independently verifying the target's resolved service, database, and storage are
staging-only. These guards cannot prove that a custom hostname or DNS alias is
not routed to production; the operator must verify the destination before every
run. The scripts request `/api/...` paths from the supplied origin.

## What the tests cover

- `k6-40-users.js`: ramps through 5, 10, 20, and 40 virtual users, then holds
  40 for five minutes. It requests catalog tracks and search; with
  `TEST_AUTH_TOKEN`, it also requests the test account's library and playlists.
- `k6-100-users.js`: ramps to 100 virtual users and holds 100 for five minutes.
  It requests bounded catalog pages and search. With `TEST_AUTH_TOKEN`, it
  also requests paginated library tracks and the test account's playlists.
  Offsets span 0 through 99,000 to exercise a representative 100,000-track
  catalog. The staging fixture must actually contain 100,000 published tracks
  for those offsets to validate that dataset.
- `k6-500-users.js`: legacy, high-load scenario. It is guarded by the same
  staging checks but is **not** part of the Stage 8 acceptance sequence and
  must not be run unless a separate staging capacity plan explicitly approves
  it. Do not jump to 500 users as a substitute for the 40- then 100-user gates.

Neither script is a full browser simulation or a playback/audio-streaming test.
Passing the scripts alone does not establish offline PWA correctness, browser
playback reliability, or production readiness.

## Initial pass thresholds

- Fewer than 1% failed HTTP requests.
- API request p95 under 750 ms and p99 under 1,500 ms.
- Catalog and search p95 under 750 ms.

These are initial staging gates, not proof of production capacity. Record the
k6 summary, deployment instance size, database pool settings, and database
metrics for each run. Check whether any 503s are caused by admission control,
and confirm the app recovers after the test. Do not raise concurrency until
the lower level is stable. Run the 100-user test only after the lower-level test
passes.

## Follow-up tests still needed

- Browser sign-in and session refresh with dedicated test accounts.
- Playlist creation/editing and account-data isolation.
- Playback URL resolution and authorized audio range requests using test media.
- Offline launch, offline library/lyrics restore, and reconnection behavior.
- Database/provider outage and recovery drills.
