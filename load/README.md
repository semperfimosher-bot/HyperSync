# HyperSync staging load test

## Safety first

Run this only against a staging deployment and test database that you control.
Do not run it against `https://api.hypersynced.app` or another production system
unless you have explicitly scheduled and approved a load-test window. The test
generates real requests and can cause a small deployment or database to return
retryable `503` responses.

## Requirements

- k6 installed locally: https://grafana.com/docs/k6/latest/set-up/install-k6/
- A reachable staging API URL.
- Optional: a dedicated registered **staging** account's access token to test
  its private library and playlist endpoints. Never use an administrator token
  or paste tokens into source control.

## Run on Windows PowerShell

From the repository root:

```powershell
$env:TARGET_BASE_URL = "https://YOUR-STAGING-API"
# Optional; omit this line to test public browsing only.
$env:TEST_AUTH_TOKEN = "YOUR-DEDICATED-STAGING-USER-ACCESS-TOKEN"
k6 run load/k6-40-users.js
Remove-Item Env:TEST_AUTH_TOKEN -ErrorAction SilentlyContinue
Remove-Item Env:TARGET_BASE_URL -ErrorAction SilentlyContinue
```

Use your actual staging API origin without a trailing path, for example
`https://staging-api.example.com`. Do not substitute the production domain.

## What it tests

The run ramps through 5, 10, 20, and 40 virtual users, then holds 40 for five
minutes. Every virtual user requests catalog tracks and search. When
`TEST_AUTH_TOKEN` is set, it also requests that test account's library tracks
and playlists. This is a repeatable initial API-capacity check, not a full
browser simulation or a playback/audio-streaming test.

Initial pass thresholds:
- Fewer than 1% failed HTTP requests.
- API request p95 under 750 ms and p99 under 1,500 ms.
- Catalog and search p95 under 750 ms.

These are initial staging gates, not proof of production capacity. Record the
k6 summary, deployment instance size, database pool settings, and database
metrics for each run. Check whether any 503s are caused by admission control,
and confirm the app recovers after the test. Do not raise concurrency until
the lower level is stable.

## Follow-up tests still needed

- Browser sign-in and session refresh with dedicated test accounts.
- Playlist creation/editing and account-data isolation.
- Playback URL resolution and authorized audio range requests using test media.
- Database/provider outage and recovery drills.
