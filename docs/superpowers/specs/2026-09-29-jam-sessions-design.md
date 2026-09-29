# HyperSync Jam Sessions Design

## Goal

Registered HyperSync users can invite friends into a temporary shared listening session. The host chooses whether the audio plays only on the host's device or on every participant's device. Participants can add published catalog tracks to a shared queue; the host can control membership and guest playback permissions. Existing solo playback, device handoff, offline downloads, and catalog behavior stay intact.

## Boundaries

- Jam uses HyperSync accounts and existing authorized catalog streams. It neither imports Spotify content nor shares B2 URLs or on-demand stream tokens in invitations.
- One active Jam per user. A Jam has one host, at most 20 participants and 200 queued tracks. The host can end it; ending invalidates invitations and all mutations.
- The initial invite is an opaque, expiring 32-byte secret, stored only as a SHA-256 digest in the database. Joining requires an authenticated registered account and the unexpired secret. The host may rotate the invite, remove a member, or end the Jam.
- A registered participant may add published tracks. Only the host may skip, pause, seek, change modes, reorder/remove queue entries, and toggle guest control. When guest control is enabled, participants may pause, resume, and skip. Volume remains local to each device.
- Host-device mode sends playback commands to the host's participating browser. Guests see the shared track and queue without starting audio. In everyone mode, each participant explicitly enables local audio once; browsers may require this gesture after reload or backgrounding.

## State and concurrency

`JamSession` stores host, mode, state, current track, timeline anchor position and UTC time, paused state, revision, invite digest/expiry, and guest control flag. `JamMember` stores user and join time; local audio opt-in remains in the browser. `JamQueueItem` stores track, contributor and stable ordering. An atomic revision update serializes mutations across backend replicas. The host cannot start a second Jam until ending the first. Invitations expire after 24 hours; an existing Jam remains active until the host ends it.

The server is authoritative for membership, queue and playback timeline. Mutations increment `revision`. Clients poll a compact snapshot every two seconds with a monotonically increasing revision and server time; a failed poll retries without replacing the last good state. This works across backend replicas without relying on process-local WebSocket state. A future push channel may reduce latency but is not required for correctness.

For remote audio, the client estimates the host position from server anchor and time, seeks when drift exceeds 1.5 seconds and otherwise leaves playback undisturbed. It never auto-starts a guest's audio before opt-in. A fresh snapshot after reconnect repairs missed changes. A member leaving or being removed stops Jam-controlled local audio and returns the app to solo controls. Media Session metadata and lock-screen controls continue through the existing player.

## API and UI

The `/api/jams` router offers create, current, join, leave, end, rotate-invite, mode/permission changes, add/remove/reorder queue items, playback control and snapshot. Mutations require authenticated membership and reject stale revisions; create, join and queue addition have per-user rate limits. Track additions validate publication. The invite secret is only returned to the host on create/rotate and is never in regular snapshots or logs.

The player has a Jam entry point for registered users. A panel supports create, copy invite, join from link, participant list, queue, mode, guest control, leave/end and clear error states. The UI distinguishes host and guest permissions. Jam controls call the Jam API, while ordinary playback stays on the existing path outside a Jam.

## Verification and rollout

Backend tests cover joining, invite expiry/rotation, membership denial, host permissions, queue bounds, unpublished tracks, concurrent revision conflicts, timeline state, end/leave and no leak of the invite. Frontend tests cover opt-in, mode transitions, drift correction, reconnect and solo playback isolation. Run full backend, frontend, Ruff, Pyright, migration, image and build checks. Merge to main only after CI passes and review; verify Northflank deploy and `/health/ready` afterward. Physical device lock-screen/background behavior remains a separate device acceptance check.
