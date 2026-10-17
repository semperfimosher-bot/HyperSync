# PERFECT baseline scope and verification plan

## Purpose

Create a conservative, smaller HyperSync baseline that preserves the existing core music app while removing Jam sessions and live cross-device playback control.

This branch is an isolated work area. Do not merge it, deploy it, change Northflank/VPS configuration, or delete the original repository as part of this work.

## Preserve

- Account registration, login, sessions, and normal use of the same account on multiple devices.
- Catalog, metadata, search, lyrics, audio upload, artwork, streaming/playback, playlists, library, profile, admin upload/catalog flows, and existing media storage integration.
- Local playback controls and local queue behavior.
- Existing production database data and migration history.

## Remove

- Jam session creation/join/invite/leave/end and Jam-specific UI, API routes, services, models, and frontend code once all references are accounted for.
- Live cross-device playback control: device chooser/control panel, remote commands, device polling/heartbeats, live playback WebSocket, cross-replica playback event bridge, and only the database fields/tables exclusively required by those features.
- Tests and documentation that exclusively describe removed features; replace them with tests proving normal local playback and account/library behavior remain available.

## Safety constraints

- Do not remove account sessions or ordinary account authentication.
- Do not remove normal audio playback, upload, library, queue, or playlists.
- Do not drop production tables or delete user data. Existing migrations are historical records; any schema cleanup must be a new forward migration and must not run against production during this baseline work.
- Do not remove a dependency based on name alone. Verify all imports, scripts, runtime use, and tests first.
- Do not change secrets, deployment accounts, Northflank, or VPS configuration.
- Keep this branch unmerged and undeployed until the checks below pass.

## Required verification before calling this baseline stable

1. Frontend production build and offline/frontend tests.
2. Backend lint, type checks where configured, and full test suite.
3. Migration graph/head check without applying migrations to production.
4. Search for stale imports, routes, settings, UI labels, polling loops, and WebSocket references related to Jam/live device control.
5. Manual local checks: login/logout, upload a permitted audio file, metadata/artwork display, search, library, playlist actions, and playback/seek/next/queue.
6. Confirm ordinary same-account login on multiple devices still works, while no device can control another device's playback.
7. Record any checks that cannot be run and do not claim they passed.

## Hosting migration is a separate phase

Only after the local baseline is verified should a separate plan move the backend to the existing VPS while leaving the static frontend on Northflank. Production routing and deployment remain unchanged until explicitly authorized.

## Cleanup implementation status — 2026-10-16

Jam remnants and live device-control transports/services/UI are removed. Local-player
regressions and endpoint/socket rejection checks are in place. Historical migrations,
legacy playback schema mappings and existing data are retained; there is no destructive
schema cleanup in this change. Generic proxy/CSP compatibility is unchanged.

See [the reliability review](PERFECT-RELIABILITY-REVIEW.md) for executed checks and
remaining risks. The baseline is **not certified stable**: the full PostgreSQL suite,
same-account integration regression, migration execution, real browser/device journeys,
Windows verification and backend image build still need to pass in a suitable environment.
