# HyperSync

HyperSync is a mobile-first, full-stack music streaming platform designed to provide fast playback, synchronized lyrics, personal libraries, public playlists, listening statistics, administrative tools, background media processing, and a future worker bot that can discover and ingest authorized media.

This repository is intended to become a production-quality application rather than a visual demo. Every feature described in this document should eventually be backed by real database records, real authentication, real storage, real APIs, permission checks, tests, and deployment configuration.

> **Media ownership rule:** HyperSync may only ingest, process, store, or stream media that the project owner owns, licenses, or has explicit permission to use. Search and discovery tools may inspect public metadata, but media ingestion must remain limited to authorized content.

---

## 1. Project Identity

- **Project name:** HyperSync
- **Repository:** `https://github.com/semperfimosher-bot/HyperSync.git`
- **Primary branch:** `main`
- **Frontend production domain:** `https://hypersynced.app`
- **Backend production domain:** `https://api.hypersynced.app`
- **Frontend framework:** React with Vite
- **Backend framework:** FastAPI
- **Database:** Neon PostgreSQL
- **Object storage:** Backblaze B2
- **Object transfer tool:** rclone
- **Lyrics provider:** LRCLIB
- **Deployment platform:** Northflank
- **DNS and edge layer:** Cloudflare
- **Primary development environment:** Windows 11, VS Code, PowerShell
- **Backend language:** Python
- **Frontend language:** JavaScript and JSX

---

## 2. One-Sentence Product Definition

HyperSync is a responsive music streaming application where guests can immediately browse and listen, registered users can build a persistent music identity and library, administrators can manage the catalog and processing system, and a background worker can safely process authorized media into a database-backed, B2-hosted streaming catalog.

---

## 3. Product Vision

The finished application should feel immediate, polished, and highly responsive on both mobile and desktop.

HyperSync is not intended to be:

- A static music-themed interface
- A frontend-only mockup
- A collection of hardcoded tracks
- A fake login system
- A local-only music player
- A direct clone of another streaming service
- A tool for downloading media without permission

HyperSync is intended to be:

- A real multi-user streaming application
- A database-backed catalog
- A secure account and guest-session system
- A private-storage-backed media service
- A synchronized lyrics experience
- A personal music library and playlist platform
- A listening analytics platform
- An administratively manageable system
- A background-job-driven media pipeline
- A progressive web application
- A codebase that can be maintained and extended over time

---

## 4. Core Product Principles

### 4.1 Real data only

Temporary sample data may be used during isolated development, but a feature is not complete until the visible UI is connected to real backend data.

Examples:

- A displayed user must come from the authentication API.
- A track list must come from the catalog API.
- A playlist must come from PostgreSQL.
- A profile statistic must come from recorded listening events.
- A media file must come from authorized storage.
- A job status must come from the job system.
- Lyrics must come from the lyrics cache or LRCLIB integration.

### 4.2 One vertical slice at a time

Each feature should be completed through all layers before the next large feature begins.

A completed vertical slice includes:

1. Database model
2. Alembic migration
3. Pydantic schemas
4. Service or repository logic
5. FastAPI route
6. Authorization rules
7. Automated tests
8. Frontend API client
9. UI states
10. Error handling
11. Production configuration

### 4.3 Guests should be useful but limited

Guests should be able to:

- Open the application
- Browse the catalog
- Search
- Stream public tracks
- Use the queue
- View public playlists
- View available lyrics
- Navigate the application

Guests should not be able to permanently:

- Create playlists
- Save playlists
- Like tracks
- Save a personal library
- Send messages
- View account statistics
- Access administrative tools

When a guest attempts a protected action, the application should explain that an account is required and show the login or registration interface.

### 4.4 The backend is the authority

The frontend may hide or show buttons for convenience, but all permissions must also be enforced by FastAPI.

Never trust the browser to decide:

- Whether a user is an admin
- Whether a playlist can be edited
- Whether a track can be deleted
- Whether a job can be retried
- Whether a user can view private content
- Whether a guest can save data

### 4.5 Private credentials never reach the browser

The frontend must never receive:

- Neon credentials
- B2 application keys
- rclone configuration
- JWT signing secrets
- Bot authentication secrets
- Administrative service credentials
- Private storage management credentials

### 4.6 Destructive actions should be reversible where practical

Tracks, playlists, and user-generated content should generally use soft deletion before permanent cleanup.

Permanent object deletion should be performed by a separate cleanup job after database state is safely updated.

---

## 5. User Types and Roles

HyperSync has several user states.

### 5.1 Anonymous visitor

An anonymous visitor has not yet received a guest session or authenticated session.

Expected behavior:

- The first application load presents a translucent login/create-account overlay.
- The visitor may close the overlay.
- Closing it creates or begins a guest experience.
- The application remains usable for public browsing and playback.

### 5.2 Guest account

A guest account is represented by a real backend identity and session, but it does not have permanent account credentials.

A guest account may have:

- A UUID
- An account type of `guest`
- A session record
- Temporary client preferences
- A temporary queue
- Limited listening events where appropriate

A guest account does not have:

- Email
- Username
- Password hash
- Permanent library ownership

A future account-conversion flow may convert a guest into a registered user without losing allowed session state.

### 5.3 Registered user

A registered user has:

- Email
- Username
- Secure password hash
- Profile
- Sessions
- Personal library
- Playlists
- Saved public playlists
- Listening history
- Statistics
- Messaging access when messaging is implemented
- Recommendation data

### 5.4 Administrator

An administrator has all normal registered-user abilities plus access to protected administrative APIs and interfaces.

Administrators may manage:

- Users
- Music catalog
- Media uploads
- Jobs
- Storage records
- Reports
- Moderation
- Audit logs
- System health

Administrative access must be checked by the backend on every protected request.

### 5.5 Bot or worker identity

The bot is not a normal user account.

It should authenticate as a service identity using:

- A dedicated bot secret
- Short-lived JWTs
- A bot-specific audience
- Hourly reauthentication
- Heartbeats
- Explicit job-claim permissions

The bot must not use a human administrator password.

---

## 6. User Experience

## 6.1 First contact

On first load, HyperSync should display a translucent authentication overlay containing:

- Log in
- Create account
- Continue as guest
- Close button

Closing the overlay should not make the application unusable.

The guest experience should begin immediately and should not pretend that a permanent account exists.

## 6.2 Mobile layout

The mobile application should include:

- A compact top area
- Main content screen
- Persistent mini-player
- Bottom navigation
- Expandable full-screen player
- Touch-friendly controls
- Responsive search
- Mobile playlist pages
- Mobile library pages
- Mobile lyrics view

The mobile bottom navigation should provide the main destinations, such as:

- Home
- Search
- Library
- Additional profile or navigation access as the design evolves

## 6.3 Desktop layout

The desktop layout should use three floating panels on a jet-black background.

### Left panel

The left panel contains navigation and library-related controls, such as:

- Home
- Search
- Library
- User playlists
- Saved playlists
- Quick account access

### Center panel

The center panel contains the active page, such as:

- Home
- Search
- Playlist
- Album
- Artist
- Library
- Recent uploads
- Recommendations
- Empty and error states

### Right panel

The right panel contains Now Playing information and queue-related content:

- Current artwork
- Track title
- Artist
- Album where available
- Playback state
- Queue
- Synchronized lyrics below the artwork
- Contextual controls

### Bottom desktop player

The desktop application should have a persistent bottom player containing:

- Current track summary
- Previous
- Play or pause
- Next
- Shuffle
- Repeat
- Scrubber
- Elapsed time
- Duration
- Volume
- Queue access
- Device or playback state where relevant

---

## 7. Main Screens

## 7.1 Home

The home page should eventually be generated from real catalog and listening data.

Possible sections:

- Recently played
- Recent uploads
- Continue listening
- Popular public playlists
- Recommended tracks
- Recommended artists
- New catalog additions
- Generated mixes

No section should display fabricated statistics or fake users in production.

## 7.2 Search

Search should support real server-side results for:

- Tracks
- Artists
- Albums
- Playlists
- Public users or profiles when enabled

Search should support:

- Debounced input
- Pagination
- Loading state
- Empty state
- Error state
- Stable sorting
- Normalized search text
- Indexed database fields
- Filter tabs

The backend must control result visibility.

## 7.3 Library

A registered user’s library may contain:

- Liked tracks
- Saved playlists
- Created playlists
- Followed artists later
- Recently played
- Downloaded content later
- Generated playlists saved as snapshots

A guest should see an explanation that permanent library features require an account.

## 7.4 Playlist page

A playlist page should support:

- Title
- Description
- Owner
- Artwork
- Visibility
- Track count
- Total duration
- Play
- Shuffle
- Add to queue
- Save
- Edit controls for authorized owners
- Reordering
- Removal
- Sharing
- Public discovery where allowed

Playlist visibility types should include:

- Private
- Unlisted
- Public
- Generated

## 7.5 Artist page

An artist page may include:

- Artist name
- Image
- Biography
- Popular tracks
- Albums
- Singles
- Related public playlists
- Follow action later

## 7.6 Album page

An album page may include:

- Album title
- Artwork
- Artist
- Release information
- Track list
- Total duration
- Play
- Shuffle
- Save to library

## 7.7 Profile

The profile menu or profile page should contain:

- Avatar
- Display name
- Username
- Account settings
- Listening statistics
- Log out
- Administrative dashboard link for administrators

The profile should never display a fake identity after real authentication is implemented.

---

## 8. Authentication and Session Design

Authentication should use:

- Argon2 password hashing
- Short-lived access tokens
- Rotating refresh tokens
- Hashed refresh tokens in PostgreSQL
- Revocable sessions
- Session family tracking
- Guest sessions
- Role checks
- Account status checks

### 8.1 Registration

Registration should:

1. Validate email
2. Normalize email
3. Validate username
4. Preserve display casing where desired
5. Store a normalized username for uniqueness
6. Validate password strength
7. Hash the password with Argon2
8. Create the user
9. Create the profile
10. Create a session
11. Return an access token
12. Set or return the refresh-token mechanism according to the final client design

### 8.2 Login

Login should:

1. Accept email or supported login identifier
2. Locate the user
3. Verify the password hash
4. Reject inactive accounts
5. Create a new session
6. Update `last_login_at`
7. Issue a short-lived access token
8. Issue a refresh token
9. Store only the refresh-token hash

### 8.3 Refresh

Refresh should:

1. Hash the submitted refresh token
2. Locate the session
3. Verify that the session is active
4. Verify expiration
5. Rotate the refresh token
6. Revoke or replace the old token
7. Issue a new access token
8. Detect suspicious token reuse
9. Revoke the session family when reuse is detected

### 8.4 Logout

Logout should revoke the current session.

A “log out everywhere” feature should revoke all active sessions for the user.

### 8.5 Access-token lifetime

The target access-token lifetime is approximately one hour.

The client should refresh credentials without forcing the user to log in every hour.

### 8.6 Bot authentication

The bot should also use short-lived JWTs and reauthenticate hourly, but bot tokens must use separate secrets, claims, and permissions from user tokens.

---

## 9. Music Catalog

The catalog is stored in PostgreSQL as metadata.

PostgreSQL should store:

- Artists
- Albums
- Tracks
- Genres or tags
- Durations
- Release metadata
- Availability
- Visibility
- Explicit-content flag where relevant
- Storage-object references
- Artwork references
- Processing status
- Checksums
- Soft-deletion state

PostgreSQL should not store full audio files.

Backblaze B2 should store:

- Final audio files
- Artwork
- Profile images
- Future downloadable assets

---

## 10. Audio Playback

HyperSync should use a single global HTML `<audio>` element on the client.

The player must persist while the user navigates between pages.

Required player features:

- Play
- Pause
- Seek
- Previous
- Next
- Queue
- Shuffle
- Repeat off
- Repeat queue
- Repeat one
- Volume
- Mute
- Duration
- Current time
- Playback loading state
- Playback error state
- Media Session API
- Mobile lock-screen controls where supported
- Queue persistence across page navigation
- Controlled restoration after browser refresh

The application must not falsely claim that audio continued playing through a full refresh if the browser stopped it.

### 10.1 Audio transport

Audio bytes should be delivered using one of these controlled designs:

- A FastAPI streaming endpoint with HTTP Range support
- Short-lived authorized B2 URLs
- Another secure method that supports seeking and private objects

The persistent WebSocket architecture should be used for real-time control, state synchronization, events, heartbeats, and future device coordination. Audio byte transfer itself should remain compatible with browser media playback and seeking.

### 10.2 Player state

Shared player state includes:

- Current track
- Queue
- Queue position
- Playback state
- Current time
- Duration
- Volume
- Shuffle mode
- Repeat mode
- Loading state
- Error state

Mobile and desktop controls must read and modify the same player state.

---

## 11. Queue

The queue should support:

- Play next
- Add to end
- Remove item
- Reorder
- Clear
- Start from playlist
- Start from album
- Start from search result
- Start from generated mix
- Shuffle without destroying the original source ordering
- Repeat modes

Queue state may be stored client-side initially, but authenticated cross-device queue synchronization may be added later.

---

## 12. Lyrics

HyperSync should integrate with LRCLIB for plain and synchronized lyrics.

The browser should not call LRCLIB directly.

The backend lyrics flow should be:

1. Receive track ID
2. Load track metadata
3. Check the local PostgreSQL lyrics cache
4. Return cached lyrics when available
5. Call LRCLIB when missing or stale
6. Identify HyperSync in the client header
7. Handle rate limits and `Retry-After`
8. Parse synchronized lyrics
9. Normalize timestamped lines
10. Store the result in PostgreSQL
11. Return a stable HyperSync response format

The frontend should support:

- Active lyric line based on player time
- Automatic scrolling
- Click lyric to seek
- Manual-scroll pause
- Plain-lyrics fallback
- Instrumental state
- Lyrics-unavailable state
- Loading state
- Provider failure state

Desktop lyrics appear below the Now Playing artwork.

Mobile lyrics appear inside the expanded full-screen player.

---

## 13. Playlists

A playlist should include:

- UUID
- Owner
- Title
- Description
- Visibility
- Artwork
- Created date
- Updated date
- Ordered track entries
- Generated-playlist metadata where relevant
- Soft-deletion status

Playlist operations include:

- Create
- Read
- Update
- Delete
- Add track
- Remove track
- Reorder tracks
- Save public playlist
- Unsave playlist
- Change visibility
- Share
- Duplicate later
- Regenerate generated playlist only through an explicit action

A saved generated playlist should remain an immutable snapshot unless the user explicitly regenerates or edits it.

---

## 14. Personal Library

A registered user should be able to maintain:

- Liked tracks
- Saved playlists
- Created playlists
- Recent listening history
- Generated playlists
- Future followed artists
- Future offline downloads

Guest attempts to save content should trigger authentication.

---

## 15. Listening Events and Statistics

HyperSync should record meaningful listening events rather than treating every UI interaction as a completed listen.

Possible event types:

- `play_started`
- `thirty_seconds_reached`
- `play_completed`
- `skipped`
- `replayed`
- `liked`
- `unliked`
- `added_to_playlist`
- `removed_from_playlist`
- `search_to_play`

The backend should defend against:

- Duplicate events
- Rapid spam
- Impossible timestamps
- Replayed client requests
- Guest abuse
- Fabricated listening duration

User statistics may include:

- Total listening minutes
- Top tracks
- Top artists
- Top albums
- Top genres
- Recently played
- Completion rate
- Skip rate
- Listening by day or month

Statistics must be calculated from stored events, not invented in the frontend.

---

## 16. Recommendations and Generated Playlists

The first recommendation system should be rule-based, not machine-learning-based.

Possible signals:

- Recently played tracks
- Repeated tracks
- Likes
- Playlist additions
- Artist frequency
- Genre frequency
- Skip behavior
- Completion behavior
- Search-to-play behavior

A generated playlist should store:

- User
- Original prompt
- Selected tracks
- Selection reasons
- Algorithm version
- Creation date
- Snapshot status

Future recommendation systems may become more advanced, but the first version should remain understandable and testable.

---

## 17. Administrative Dashboard

The admin dashboard is private and protected by backend role checks.

Planned sections:

### 17.1 Overview

- User count
- Track count
- Active jobs
- Failed jobs
- Storage totals
- Recent uploads
- System warnings
- API health

### 17.2 Users

- Search users
- View account state
- Activate or deactivate account
- Change role through controlled workflows
- Review reports
- Review moderation status
- View safe profile information
- Never view passwords

### 17.3 Music catalog

- Search tracks
- Preview tracks
- View artist and album metadata
- Edit metadata
- Soft-delete track
- Restore track
- Inspect storage records
- Inspect lyrics state

### 17.4 Uploads

- Upload authorized source files
- Create processing jobs
- Review validation failures
- Review duplicate detection
- View upload progress

### 17.5 Jobs

- View queued jobs
- View claimed jobs
- View running jobs
- View completed jobs
- View failed jobs
- Retry safe jobs
- Cancel jobs
- Inspect job events

### 17.6 Storage

- Inspect B2 object records
- Compare B2 and PostgreSQL
- Find missing objects
- Find orphaned objects
- Schedule cleanup
- Inspect checksums

### 17.7 Reports and moderation

- User reports
- Playlist reports
- Message reports
- Content moderation
- Blocking
- Administrative notes

### 17.8 Audit log

Every sensitive admin mutation should create an audit record including:

- Administrator
- Action
- Target
- Timestamp
- Before state where appropriate
- After state where appropriate
- Request or correlation ID
- Reason where required

---

## 18. Job System

The API owns jobs.

Job states should include:

- `queued`
- `claimed`
- `running`
- `completed`
- `failed`
- `cancelled`

A job should include:

- UUID
- Job type
- Payload
- Status
- Priority
- Attempt count
- Maximum attempts
- Claimed-by identity
- Claim expiration
- Progress
- Error summary
- Created time
- Started time
- Completed time
- Updated time

Job events should preserve a history of state changes and important processing messages.

The system should support:

- Atomic claiming
- Expired-claim recovery
- Idempotent retries
- Cancellation
- Progress reporting
- Crash recovery
- Structured error reporting

---

## 19. Background Bot and Worker

The bot should run as a separate service, likely on Northflank.

The bot’s responsibilities may include:

- Authenticate with FastAPI
- Maintain a persistent WebSocket
- Send heartbeats
- Reauthenticate hourly
- Claim jobs
- Receive job commands
- Search YouTube through Playwright
- Inspect public search results
- Send discovered metadata to HyperSync
- Process authorized media
- Run FFmpeg
- Read metadata with Mutagen
- Generate or normalize artwork
- Upload finalized objects using rclone
- Verify B2 uploads
- Report progress
- Clean temporary files
- Mark jobs complete or failed

### 19.1 YouTube discovery

The Playwright bot may enter arbitrary queries into YouTube’s search interface and inspect result metadata.

Discovery does not automatically authorize ingestion.

The bot may only download, process, upload, or store media when the project owner owns it, licenses it, or has permission to use it.

### 19.2 Worker WebSocket

The worker WebSocket should support:

- Authentication
- Heartbeat
- Job offer
- Job claim
- Claim acknowledgment
- Progress update
- Log event
- Completion
- Failure
- Cancellation
- Token refresh or reauthentication
- Reconnection with backoff

### 19.3 Temporary files

Temporary processing files should use controlled folders and be removed after success or failure.

Temporary files must not accumulate forever.

---

## 20. Media Processing Pipeline

The intended authorized ingestion flow is:

1. Administrator submits an authorized source
2. API validates request
3. API creates a job
4. Worker claims the job
5. Worker obtains the authorized source
6. Worker validates file type and size
7. Worker calculates checksums
8. Worker extracts metadata
9. Worker transcodes or normalizes audio with FFmpeg
10. Worker extracts or creates artwork
11. Worker uploads audio to B2 with rclone
12. Worker uploads artwork to B2 with rclone
13. Worker verifies the uploaded objects
14. API or worker records storage metadata
15. Track, album, and artist records are committed
16. Job is completed
17. Temporary files are removed

The workflow should avoid partially visible tracks.

A track should not become publicly playable until required database and storage records are valid.

---

## 21. Backblaze B2 Storage

The B2 bucket should remain private.

Suggested logical object prefixes:

```text
audio/
artwork/
profiles/
exports/
temporary/
```

Object keys should be deterministic and avoid user-controlled unsafe paths.

A storage record should include:

- UUID
- Provider
- Bucket
- Object key
- MIME type
- Size
- Checksum
- Created time
- Verification state
- Soft-deletion state
- Deletion time where applicable

B2 credentials should only exist in protected backend or worker environments.

---

## 22. Database

Neon PostgreSQL is the source of truth for application metadata.

The running API should use the pooled Neon URL.

Alembic migrations should use the direct Neon URL.

### 22.1 Initial account tables

- `users`
- `user_profiles`
- `user_sessions`

### 22.2 Planned catalog tables

- `artists`
- `albums`
- `tracks`
- `track_artists`
- `storage_objects`
- `genres`
- `track_genres`

### 22.3 Planned playlist and library tables

- `playlists`
- `playlist_tracks`
- `saved_playlists`
- `liked_tracks`
- `user_library`

### 22.4 Planned listening tables

- `listening_events`
- `recently_played`
- Aggregated-statistics tables only if later needed

### 22.5 Planned lyrics tables

- `lyrics`
- Potential normalized lyric lines or JSON payload depending on final design

### 22.6 Planned job tables

- `jobs`
- `job_events`
- `worker_instances`

### 22.7 Planned administrative tables

- `audit_events`
- `reports`
- `moderation_actions`

### 22.8 Planned messaging tables

- `conversations`
- `conversation_members`
- `messages`
- `message_reports`
- `user_blocks`

All schema changes must use Alembic migrations.

Do not manually edit production tables as the normal development method.

---

## 23. Backend Architecture

Suggested backend structure:

```text
backend/
└── app/
    ├── api/
    │   ├── router.py
    │   ├── dependencies/
    │   └── routes/
    ├── models/
    ├── schemas/
    ├── services/
    ├── repositories/
    ├── security/
    ├── storage/
    ├── jobs/
    ├── websockets/
    ├── config.py
    ├── database.py
    └── main.py
```

### Responsibilities

- **Routes:** HTTP request and response handling
- **Schemas:** Input validation and output serialization
- **Services:** Business rules
- **Repositories:** Database access patterns where useful
- **Models:** SQLAlchemy persistence models
- **Security:** Passwords, tokens, sessions, permissions
- **Storage:** B2 and object-key logic
- **Jobs:** Job creation and state transitions
- **WebSockets:** Bot and real-time player/control communication
- **Config:** Environment-based settings
- **Database:** Engine and sessions

Routes should remain thin.

Business logic should not be buried inside route functions.

---

## 24. Planned API Surface

The exact API may evolve, but the intended areas are:

### Authentication

```text
POST /api/auth/register
POST /api/auth/login
POST /api/auth/refresh
POST /api/auth/logout
POST /api/auth/logout-all
POST /api/auth/guest
GET  /api/auth/me
```

### Profiles

```text
GET   /api/profiles/me
PATCH /api/profiles/me
GET   /api/profiles/{username}
```

### Catalog

```text
GET /api/tracks
GET /api/tracks/{track_id}
GET /api/artists
GET /api/artists/{artist_id}
GET /api/albums
GET /api/albums/{album_id}
GET /api/search
```

### Lyrics

```text
GET /api/tracks/{track_id}/lyrics
```

### Playlists

```text
POST   /api/playlists
GET    /api/playlists/{playlist_id}
PATCH  /api/playlists/{playlist_id}
DELETE /api/playlists/{playlist_id}

POST   /api/playlists/{playlist_id}/tracks
DELETE /api/playlists/{playlist_id}/tracks/{playlist_track_id}
PATCH  /api/playlists/{playlist_id}/tracks/order

POST   /api/playlists/{playlist_id}/save
DELETE /api/playlists/{playlist_id}/save
```

### Library

```text
GET    /api/library
POST   /api/library/tracks/{track_id}
DELETE /api/library/tracks/{track_id}
```

### Listening

```text
POST /api/listening/events
GET  /api/listening/recent
GET  /api/listening/stats
```

### Streaming

```text
GET /api/tracks/{track_id}/stream
```

### Admin

```text
GET  /api/admin/overview
GET  /api/admin/users
GET  /api/admin/tracks
POST /api/admin/uploads
GET  /api/admin/jobs
POST /api/admin/jobs/{job_id}/retry
POST /api/admin/jobs/{job_id}/cancel
GET  /api/admin/storage
GET  /api/admin/audit
```

### Worker and WebSocket

```text
POST /api/worker/token
WS   /ws/worker
WS   /ws/player
```

---

## 25. Frontend Architecture

The current frontend began as a large prototype component.

It should be gradually refactored into maintainable modules without changing the visual design during the refactor.

Suggested structure:

```text
frontend/src/
├── api/
├── components/
├── hooks/
├── layouts/
├── pages/
├── player/
├── state/
├── utils/
├── App.jsx
├── main.jsx
└── styles.css
```

Suggested responsibilities:

### `api/`

- HTTP client
- Token refresh
- API error normalization
- Typed or documented response helpers
- WebSocket client

### `components/`

- Buttons
- Inputs
- Track rows
- Playlist cards
- Artwork
- Loading indicators
- Empty states
- Error states
- Login overlay
- Profile menu

### `layouts/`

- Desktop three-panel layout
- Mobile layout
- Navigation
- Application shell

### `pages/`

- Home
- Search
- Library
- Playlist
- Artist
- Album
- Profile
- Admin

### `player/`

- Global audio element
- Player provider
- Desktop player
- Mobile mini-player
- Mobile expanded player
- Queue
- Lyrics synchronization

### `state/`

- Authentication state
- Player state
- UI state
- Queue state where not owned by player state

---

## 26. Messaging

Messaging is a later milestone and should not delay the streaming core.

Planned messaging features:

- Conversations
- Direct messages
- Unread counts
- Blocking
- Reporting
- Privacy controls
- Rate limits
- Moderation
- Audit trail

Messaging must include teen-safe moderation and abuse-prevention features before public release.

---

## 27. Progressive Web Application

HyperSync should eventually become installable as a PWA.

Required PWA elements:

- Web app manifest
- Application icons
- Service worker
- Install prompt
- Offline application shell
- Cache versioning
- Update notification
- Safe fallback pages

Audio should not be automatically cached in bulk.

Offline track downloads should be an explicit feature with:

- User action
- Storage limit handling
- Expiration or cleanup
- Authorization checks
- Clear offline status

---

## 28. Deployment Topology

```text
User browser
    |
    v
Cloudflare
    |
    +--> https://hypersynced.app
    |        |
    |        v
    |    Northflank frontend service
    |    Nginx + built Vite assets
    |
    +--> https://api.hypersynced.app
             |
             v
         Northflank FastAPI service
             |
             +--> Neon PostgreSQL
             +--> Backblaze B2
             +--> LRCLIB
             +--> Worker WebSocket
```

The bot runs as a separate Northflank service and communicates with the API.

---

## 29. Environment Variables

The project should use local `.env` files and production secret variables.

Example categories:

```env
APP_NAME=
APP_VERSION=
ENVIRONMENT=

BACKEND_HOST=
BACKEND_PORT=
FRONTEND_ORIGINS=

DATABASE_URL=
MIGRATION_DATABASE_URL=

JWT_SECRET=
JWT_ALGORITHM=
ACCESS_TOKEN_TTL_MINUTES=
REFRESH_TOKEN_TTL_DAYS=

BOT_JWT_SECRET=
BOT_JWT_AUDIENCE=
BOT_TOKEN_TTL_MINUTES=

RCLONE_REMOTE=
B2_BUCKET_NAME=
B2_AUDIO_PREFIX=
B2_ARTWORK_PREFIX=
B2_PROFILE_PREFIX=

LOCAL_TEMP_ROOT=
LOCAL_UPLOAD_ROOT=
LOCAL_LOG_ROOT=

LRCLIB_BASE_URL=
LRCLIB_CLIENT_NAME=

CLIENT_CACHE_HOURS=
```

Rules:

- `.env` must never be committed.
- `.env.example` contains placeholders only.
- Frontend variables must never contain private secrets.
- Production secrets belong in Northflank secret configuration.
- Exposed secrets must be rotated.

---

## 30. Health Checks

The backend should expose:

```text
GET /health/live
GET /health/ready
GET /health
```

### Liveness

`/health/live` confirms that the API process is running.

### Readiness

`/health/ready` confirms that the API can reach required dependencies such as Neon.

Northflank should use:

- Liveness path: `/health/live`
- Readiness path: `/health/ready`
- Backend port: `8000`

---

## 31. Testing Strategy

A feature is incomplete without tests.

### Backend tests

- Model registration
- Schema constraints
- Authentication
- Refresh rotation
- Revocation
- Permission checks
- Playlist ownership
- Guest restrictions
- Catalog queries
- Search
- Listening-event validation
- Job transitions
- Admin authorization
- Health endpoints

### Frontend tests

- Authentication UI
- Protected actions
- Player state
- Queue behavior
- Search states
- Playlist editing
- Lyrics synchronization
- Error states

### Integration tests

- FastAPI plus test database
- Migration upgrade
- Migration downgrade where safe
- B2 storage abstraction with controlled test behavior
- Worker job lifecycle
- WebSocket authentication

### Production verification

- Frontend build
- API liveness
- API readiness
- Neon connection
- Migration revision
- Storage access
- Domain routing
- Cloudflare behavior

---

## 32. Code Quality

Python quality tools:

- Ruff linting
- Ruff formatting
- pytest
- Python compilation checks

Frontend quality tools should eventually include:

- ESLint
- Prettier
- Component tests
- Build verification

Before a normal push:

```powershell
cd C:\Users\TrojanIV\Desktop\HyperSync

.\.venv\Scripts\python.exe -m ruff check backend tests
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m compileall -q backend

powershell -ExecutionPolicy Bypass `
    -File .\scripts\verify-project.ps1

git diff --check
git status
git add -A
git commit -m "Describe the completed vertical slice"
git push origin main
```

---

## 33. Security Requirements

HyperSync must include:

- Argon2 password hashing
- Refresh-token hashing
- Token rotation
- Session revocation
- Role-based authorization
- Input validation
- Upload size limits
- File-type validation
- MIME validation
- Checksum validation
- Rate limiting
- CORS restrictions
- Private B2 bucket
- Secret rotation
- Audit logs
- Soft deletion
- Abuse reporting
- Messaging moderation
- Safe error responses
- Structured logs without secrets

Never log:

- Passwords
- Raw refresh tokens
- JWT secrets
- B2 keys
- Database passwords
- Entire authorization headers

---

## 34. Observability

The production application should eventually provide:

- Structured logs
- Request IDs
- Job correlation IDs
- Error tracking
- Health metrics
- Job failure counts
- Storage reconciliation reports
- Database connection monitoring
- Worker heartbeat status
- API latency monitoring
- Playback failure reporting without collecting unnecessary personal data

---

## 35. Data Privacy

The application should collect only what is needed.

Future privacy features should include:

- Account deletion
- Data export
- Session management
- Clear listening-history controls
- Messaging privacy controls
- Report and block tools
- Data retention policy
- Soft-delete and cleanup policy
- Privacy policy
- Terms of service

---

## 36. Development Milestones

### Milestone 0 — Foundation

- FastAPI
- Configuration
- Neon connection
- Health routes
- Tests
- Ruff
- Frontend build
- Deployment routing

### Milestone 1 — Account schema

- Users
- Profiles
- Sessions
- Alembic migration
- Schema verification

### Milestone 2 — Authentication

- Registration
- Login
- Guest sessions
- Access tokens
- Refresh rotation
- Logout
- `/api/auth/me`
- Permission dependencies

### Milestone 3 — Frontend authentication

- API client
- Auth provider
- Real login form
- Real registration form
- Guest creation
- Profile menu
- Protected actions

### Milestone 4 — Catalog

- Artists
- Albums
- Tracks
- Search
- Pagination
- Real home data

### Milestone 5 — Storage and upload

- B2 abstraction
- Storage records
- Admin upload
- Job creation
- Worker processing
- Authorized media only

### Milestone 6 — Player

- Global audio element
- Queue
- Seeking
- Repeat
- Shuffle
- Volume
- Media Session API
- Streaming authorization

### Milestone 7 — Lyrics

- LRCLIB
- Cache
- Synchronized display
- Plain lyrics fallback

### Milestone 8 — Playlists and library

- CRUD
- Reordering
- Visibility
- Saving
- Likes
- Guest restrictions

### Milestone 9 — Listening data

- Events
- History
- Statistics
- Rule-based recommendations

### Milestone 10 — Admin

- Dashboard
- Catalog management
- Users
- Jobs
- Storage
- Audit

### Milestone 11 — Bot

- WebSocket
- Heartbeats
- Hourly reauthentication
- Job claiming
- Playwright discovery
- FFmpeg
- Mutagen
- rclone
- Cleanup

### Milestone 12 — Generated playlists

- Prompt
- Selection reasons
- Algorithm version
- Saved snapshots

### Milestone 13 — Messaging

- Conversations
- Messages
- Blocking
- Reports
- Moderation

### Milestone 14 — PWA

- Manifest
- Service worker
- Install
- Offline shell
- Updates

### Milestone 15 — Production hardening

- Rate limits
- Security review
- Monitoring
- Backup and restore
- B2 reconciliation
- Privacy tools
- Full test coverage

---

## 37. Current State

At the time this README was written, the project has been working through the backend foundation and first account-model milestone.

The expected foundation includes:

```text
backend/app/main.py
backend/app/config.py
backend/app/database.py
backend/app/api/router.py
backend/app/api/routes/health.py
tests/test_health.py
scripts/verify-project.ps1
requirements.backend.txt
requirements.dev.txt
pyproject.toml
```

The frontend is still primarily a visual prototype and contains hardcoded or simulated behavior that must be replaced incrementally.

The current implementation status must always be confirmed using:

```powershell
git status
.\.venv\Scripts\python.exe -m ruff check backend tests
.\.venv\Scripts\python.exe -m pytest -q
powershell -ExecutionPolicy Bypass -File .\scripts\verify-project.ps1
```

This README describes the target system. It must not be interpreted as proof that every described feature is already implemented.

---

## 38. Immediate Next Work

The next intended work sequence is:

1. Confirm backend foundation files exist
2. Confirm Ruff passes
3. Confirm pytest passes
4. Confirm Neon readiness passes
5. Create account models
6. Initialize Alembic
7. Generate the first migration
8. Inspect the migration
9. Apply it to Neon
10. Verify account tables
11. Commit and push
12. Begin real authentication

Do not begin B2, LRCLIB, the worker bot, messaging, or recommendations before the account schema and authentication are stable.

---

## 39. Instructions for AI Assistants

An AI assistant helping with HyperSync should follow these rules.

### 39.1 Read before changing

Before suggesting code:

1. Inspect the current project tree
2. Inspect the relevant existing files
3. Confirm what is already implemented
4. Confirm current errors or test output
5. Avoid assuming that an earlier file still exists

### 39.2 Preserve the intended architecture

Do not redesign away:

- FastAPI backend
- React/Vite frontend
- Neon PostgreSQL
- Backblaze B2
- rclone
- LRCLIB
- Persistent WebSocket architecture
- Hourly worker reauthentication
- Separate bot service
- Guest mode
- Admin dashboard
- Mobile-first UI
- Desktop three-panel layout

### 39.3 Give copy-pasteable chunks

The project owner wants to write and understand the application but prefers help with major chunks.

Responses should usually provide:

- Exact file path
- Complete file content when replacing a file
- Exact commands
- Expected output
- Clear stop conditions
- One milestone at a time

Avoid giving dozens of unrelated files at once.

### 39.4 Do not claim success without evidence

An AI assistant should not claim:

- A migration worked without output
- Neon connected without a successful check
- A frontend build passed without build output
- A deployment succeeded without checking its health
- A route exists without inspecting the file or API

### 39.5 Protect secrets

Never ask the project owner to paste:

- Database passwords
- Full Neon URLs
- JWT secrets
- B2 keys
- rclone config
- Raw refresh tokens

When a secret is pasted into chat, instruct the owner to rotate it.

### 39.6 Respect media authorization

Do not provide instructions that expand the ingestion system into unauthorized downloading.

The bot may search broadly, but ingestion must be limited to owned, licensed, or explicitly permitted media.

### 39.7 Keep mock behavior clearly isolated

During development, mock data may remain only as a temporary UI placeholder.

Do not describe mock behavior as finished.

Remove mock data only when a real endpoint is ready to replace it.

### 39.8 Follow the build order

The preferred sequence is:

1. Foundation
2. Database
3. Authentication
4. Frontend authentication
5. Catalog
6. Storage
7. Player
8. Lyrics
9. Playlists
10. Listening data
11. Admin
12. Worker
13. Recommendations
14. Messaging
15. PWA
16. Hardening

---

## 40. Definition of Done

A HyperSync feature is done only when:

- It uses real data
- The database schema exists
- The migration exists
- Backend validation exists
- Authorization exists
- Tests pass
- Frontend states exist
- Loading is handled
- Errors are handled
- Empty states are handled
- Production configuration exists
- Secrets remain private
- Documentation is updated
- The feature works on mobile and desktop where relevant

A visual button connected only to local React state is not a finished backend feature.

---

## 41. Non-Goals for the Early Versions

The early application should not prioritize:

- Machine-learning recommendations
- Large-scale social networking
- Complex offline licensing
- Multi-region infrastructure
- Massive distributed transcoding
- Advanced creator monetization
- Automatic ingestion of arbitrary copyrighted media
- Native iOS or Android applications

The first objective is a reliable web application with real accounts, real catalog data, authorized storage, stable playback, playlists, lyrics, and administration.

---

## 42. Final End Goal

The finished HyperSync experience should allow a new visitor to:

1. Open `hypersynced.app`
2. Log in, register, or continue as a guest
3. Search a real music catalog
4. Start playback immediately
5. Navigate without interrupting the player
6. Manage a queue
7. View synchronized lyrics
8. Create and save playlists after authentication
9. Build a real library
10. Review listening statistics
11. Receive understandable recommendations
12. Use the application comfortably on mobile or desktop
13. Install the application as a PWA

An administrator should be able to:

1. Log in securely
2. View system health
3. Manage users
4. Search and manage the catalog
5. Submit authorized media
6. Track processing jobs
7. Inspect storage
8. Retry recoverable failures
9. Review audit events
10. Moderate reports

A worker should be able to:

1. Authenticate as a service
2. Maintain a WebSocket
3. Reauthenticate hourly
4. Claim jobs safely
5. Discover requested metadata
6. Process only authorized media
7. Use FFmpeg and Mutagen
8. Upload through rclone
9. Verify storage
10. Report progress
11. Recover from failure
12. Clean temporary data

That complete system is the target represented by this repository.
