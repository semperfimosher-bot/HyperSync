# HyperSync Profile and Social Design

## Goal

Turn HyperSync profiles into a polished social music identity system while keeping the existing application structure understandable and safe to extend.

The profile system should make every registered account discoverable, protect detailed listening activity by default, support approval-based follow requests, and let each user optionally publish their full music activity to everyone.

## Product Rules

### Account discoverability

Every registered, active account is searchable by username and display name.

A basic profile is always visible and includes:

- profile picture or initials fallback
- display name
- username
- accepted follower count
- account age / member since information
- relationship button state for the current viewer

There is no setting that completely hides a registered account from search.

### Music activity visibility

Detailed music activity is private by default.

Detailed music activity includes:

- total plays
- total listening time
- recently played tracks
- per-track play counts
- last-played information
- top artists
- future listening-derived profile statistics

A viewer may see detailed music activity when any of these are true:

1. The viewer is looking at their own profile.
2. The profile owner has enabled `music_activity_public`.
3. The viewer has an accepted follow relationship with the profile owner.

Pending followers do not receive detailed activity access.

### Follow workflow

HyperSync uses one approval-based follow system instead of separate friendship and follower systems.

Relationship states are:

- `none`
- `pending`
- `accepted`

Flow:

1. Viewer presses Follow.
2. A `pending` relationship is created.
3. Owner sees the request in Follow Requests.
4. Owner can Accept or Decline.
5. Accept changes the relationship to `accepted`.
6. Decline removes the relationship.
7. The requester can cancel a pending request.
8. An accepted follower can unfollow.
9. The owner can remove an accepted follower.

Self-following remains prohibited.

Only accepted relationships count toward the public follower count.

## Data Model

### `UserProfile`

Keep the existing profile fields and add:

```python
music_activity_public: bool
```

Default: `False`.

The existing `is_public` field is no longer used to make an account undiscoverable. During migration it should either be removed or retained temporarily only for compatibility, but API behavior must follow the new discoverability rules.

### `UserFollow`

Extend the existing `user_follows` table with a relationship status.

Recommended enum:

```python
class FollowStatus(StrEnum):
    PENDING = "pending"
    ACCEPTED = "accepted"
```

Add:

```python
status: Mapped[FollowStatus]
```

Existing rows must migrate to `accepted` because they represent relationships that were already established under the old behavior.

`created_at` continues to represent when the request was first created. `updated_at` can represent when the state last changed.

### Account age

Use the existing `User.created_at` timestamp from `TimestampMixin` instead of adding a new column.

The API should return a stable timestamp such as:

```json
"member_since": "2026-08-28T12:34:56Z"
```

The frontend converts this into friendly text such as `Member for 8 months`.

## Backend API Design

### Profile response

Replace the current all-or-nothing public-profile response with a response that can describe both basic and full profiles.

Recommended fields:

```text
id
username
display_name
bio
avatar_url
member_since
followers_count
following_count
relationship_status
music_activity_public
can_view_music_activity
tracks_played
hours_listened
recently_played
top_artists
```

For viewers who cannot see music activity:

- `can_view_music_activity` is `false`
- protected numeric fields may be `null`
- protected list fields should be empty lists

The profile owner always receives full data.

### `GET /users/me`

Authenticated.

Returns the owner's full profile plus owner-only metadata such as pending request count.

### `GET /users/search?q=...`

Public/basic discovery endpoint.

Searches every active registered account regardless of music activity privacy.

Each search result returns only basic identity information:

- username
- display name
- bio only if we explicitly decide it is basic/public; for the first implementation, omit bio from strangers' search results
- avatar URL
- follower count
- member since

### `GET /users/{username}`

Returns a viewer-aware profile.

Authentication is optional for this route.

Anonymous viewers get basic information plus full music data only when `music_activity_public` is true.

Authenticated viewers additionally receive relationship state and may receive full music data when their relationship is accepted.

### Follow request actions

Use the existing route family where possible.

```text
POST   /users/{username}/follow
DELETE /users/{username}/follow
```

Behavior:

- POST with no relationship creates `pending`
- POST while already pending or accepted is idempotent
- DELETE removes pending or accepted relationship owned by the caller

Add owner actions:

```text
POST   /users/follow-requests/{username}/accept
DELETE /users/follow-requests/{username}
```

The DELETE request route declines the incoming request.

### Follow request list

Add:

```text
GET /users/me/follow-requests
```

Returns pending incoming requests with basic user cards.

### Followers and following

Add:

```text
GET /users/{username}/followers
GET /users/{username}/following
```

These endpoints return accepted relationships only.

For the first implementation, follower/following lists are visible wherever the basic profile is visible.

### Music activity setting

Replace the old whole-profile privacy behavior with:

```text
PATCH /users/me/privacy
```

Payload:

```json
{
  "music_activity_public": true
}
```

This keeps the existing endpoint path while changing its semantics.

## Backend Authorization Rules

All music-activity authorization is computed on the backend. The frontend must never be relied on to hide protected activity.

A helper should centralize the rule:

```text
viewer is owner
OR profile.music_activity_public
OR accepted relationship exists from viewer -> owner
```

The dashboard builder should be split so basic profile construction and protected music-stat construction are separate. This prevents accidentally calculating or serializing protected data for unauthorized viewers.

Search endpoints must never expose protected listening activity.

## Avatar System

Keep the existing Backblaze B2 storage design:

```text
profiles/{user_id}/{uuid}.{extension}
```

Supported types remain JPG, PNG, and WebP with a 5 MB maximum.

### Upload UX

The edit-profile modal supports:

- click-to-upload
- drag and drop
- local preview before upload
- file type validation
- file size validation
- visible uploading state
- success/error feedback
- replace existing avatar
- remove avatar

Add a backend endpoint for removal:

```text
DELETE /users/me/avatar
```

Removal clears the database key first, then attempts B2 cleanup. Cleanup errors are logged rather than silently ignored.

### Cache busting

The frontend appends a version token after profile-picture changes, for example:

```text
/api/users/alex/avatar?v=1724870000000
```

This avoids stale browser-cached avatars while retaining normal server caching.

## Frontend Architecture

The current profile implementation is moved out of `App.jsx`.

### Pages

```text
frontend/src/components/pages/ProfilePage.jsx
frontend/src/components/pages/PublicProfilePage.jsx
```

`ProfilePage.jsx` handles the current user's profile.

`PublicProfilePage.jsx` handles another user's profile and viewer relationship state.

### Profile components

Create:

```text
frontend/src/components/profile/ProfileHeader.jsx
frontend/src/components/profile/ProfileAvatar.jsx
frontend/src/components/profile/EditProfileModal.jsx
frontend/src/components/profile/FollowRequestsModal.jsx
frontend/src/components/profile/FollowersModal.jsx
frontend/src/components/profile/RecentlyPlayed.jsx
frontend/src/components/profile/TopArtists.jsx
frontend/src/components/profile/ProfileStats.jsx
frontend/src/components/profile/PrivateActivityPanel.jsx
```

Each component has one responsibility and receives data/actions through props.

### API module

Keep `frontend/src/profileApi.js` as the profile data boundary and extend it with:

```text
removeProfileAvatar
getFollowRequests
acceptFollowRequest
declineFollowRequest
getFollowers
getFollowing
```

Existing `getMyProfile`, `getPublicProfile`, `followUser`, `unfollowUser`, `uploadProfileAvatar`, and search helpers remain.

## Edit Profile Experience

The existing inline editor is replaced by a modal/drawer that works on desktop and mobile.

### Header

- title: `Edit Profile`
- short subtitle describing the public identity
- close button

### Avatar editor

Large circular avatar preview with a subtle HyperSync blue glow.

Actions:

- `Upload New Photo`
- `Remove Photo`
- drag-and-drop zone

The upload button should be visually prominent and include an upload icon.

### Identity fields

Display Name:

- max 80 characters
- live character count

Bio:

- max 500 characters
- live character count

### Privacy control

Setting label:

`Public Music Activity`

Description:

`Let anyone see your listening stats, recently played tracks, and top artists. Accepted followers can always see this activity.`

A preview card explains what strangers can see when the switch is off.

### Actions

- secondary `Cancel`
- primary `Save Changes`

During save:

- controls disable appropriately
- button shows saving state
- modal stays open on error
- successful save updates profile UI without a page reload

## Profile Visual Design

The page should look like a premium music/social product while keeping the existing HyperSync blue visual language.

### Profile hero

Large centered or responsive two-column header containing:

- glowing circular avatar
- display name
- username
- account age
- optional role badge for the owner/admin
- profile actions

Owner actions:

- Edit Profile
- Follow Requests with pending-count badge
- Copy Profile Link

Viewer actions:

- Follow
- Requested
- Following
- Copy Profile Link

### Stats

Basic public stats:

- followers
- member age

Full activity stats when authorized:

- total plays
- hours listened
- following count if retained as a profile stat

### Recently played

Use album-art cards with:

- artwork
- title
- artist
- play-count badge (`×12`)
- friendly play count text
- click-to-play behavior using the existing audio player

Repeated plays remain one card because the backend already groups listening events by track.

### Top artists

Ranked rows with:

- rank number
- artist
- play count
- click action that opens/searches the artist in HyperSync

### Private activity state

Unauthorized viewers see a polished locked panel rather than missing sections.

Example copy:

`Music activity is private`

`Follow this listener and wait for approval to unlock recently played tracks and listening stats.`

If the viewer has a pending request, the panel mentions that the request is waiting for approval.

## Search and Navigation

Search continues to query music and people together.

User result cards navigate to the public profile page using the app's existing navigation model rather than relying on an unmanaged `window.location.hash` side effect.

`App.jsx` remains responsible for high-level navigation/page selection, but profile rendering lives in dedicated page components.

Do not introduce React Router as part of this profile project.

## Loading, Empty, and Error States

### Loading

Use profile skeletons instead of blank panels.

Skeletons cover:

- avatar
- name/username
- stats
- recent cards

### Empty listening history

Owner copy:

`Nothing played yet. Play a song and your listening history will appear here.`

Authorized viewer copy:

`No listening history yet.`

### Not found

Show a profile-not-found panel for missing/inactive users.

### Request errors

Follow, profile-save, and avatar-upload failures remain visible near the action that failed.

No failed request should silently change UI state.

## Accessibility

- all icon-only buttons have `aria-label`
- avatar image has useful alt text where appropriate
- modal traps focus and closes with Escape
- follow/request status is conveyed with text, not color alone
- upload drop zone is keyboard accessible
- controls have visible focus states

## Migration Plan

Create one new Alembic migration after the current avatar migration.

Migration responsibilities:

1. Add `music_activity_public` to `user_profiles`, default false.
2. Add `status` to `user_follows`.
3. Backfill all existing follow rows as `accepted`.
4. Make status non-null with a default appropriate for new code.
5. Preserve existing data.

The old `is_public` column should not be dropped in the same migration unless all code references are removed and verified. Safer first pass: keep it temporarily but stop using it for discoverability.

## Testing

### Backend tests

Add coverage for:

- every active registered account appears in search
- anonymous/basic profile visibility
- private music activity hidden from strangers
- public music activity visible to strangers
- pending request cannot see protected activity
- accepted follower can see protected activity
- follow request creation
- request acceptance
- request decline
- pending request cancellation
- accepted unfollow
- owner removal of follower
- follower count includes accepted only
- migration/backfill assumptions
- avatar upload
- avatar removal
- repeated track plays remain grouped with correct `play_count`

### Frontend verification

Verify:

- profile page builds
- avatar preview works before upload
- FormData upload still works through `apiRequest`
- edit modal works on desktop/mobile
- follow buttons move through correct states
- request modal updates immediately
- protected/public activity panels switch correctly
- recently played cards start playback
- search result opens the correct profile
- no stale avatar after replacement

## Verification Commands

Backend:

```powershell
python -m compileall backend/app
python -m pytest -q -W error
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-project.ps1
```

Frontend:

```powershell
cd frontend
npm run build
```

Run the repository's existing lint/test verification after every major phase rather than waiting until the entire profile feature is complete.

## Implementation Order

1. Data-model and migration changes.
2. Backend privacy helper and viewer-aware profile response.
3. Follow request state/actions and list endpoints.
4. Followers/following endpoints.
5. Avatar removal and cleanup logging.
6. Extend `profileApi.js`.
7. Extract current profile UI from `App.jsx`.
8. Build reusable `ProfileAvatar` and profile header/stat components.
9. Build the new edit-profile modal and avatar workflow.
10. Build current-user profile page.
11. Build public profile page and locked activity state.
12. Wire follow request UI.
13. Wire followers/following UI.
14. Fix user-search navigation to use app navigation state.
15. Add final responsive styling, skeletons, and polish.
16. Run backend tests, frontend build, and project verification.

## Non-Goals for This Project

To keep this implementation reliable, this profile project does not include:

- direct messages
- comments on profiles
- reactions/likes on listening activity
- activity feeds
- badges/achievements system
- recommendation algorithms
- React Router migration

Those can be added later without redesigning the profile permission model.
