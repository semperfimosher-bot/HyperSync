# Authentication and session lifecycle

This document is the behavior contract for HyperSync authentication while the
subsystem is consolidated. Refactors must preserve these externally visible
features unless a separate product decision explicitly changes them.

## Public behavior

- Registered-account creation at `POST /api/auth/register`.
- Username-or-email login at `POST /api/auth/login`.
- Password recovery request, OTP verification, and reset-link flows.
- Access tokens remain short-lived bearer JWTs bound to a durable database
  session.
- The browser refresh secret remains an HttpOnly `hypersync_refresh` cookie
  scoped to `/api/auth`.
- Refresh rotates the secret while retaining the same database session id.
- The immediately previous refresh secret remains valid for the configured
  grace window so overlapping tabs do not destroy a legitimate session.
- `POST /api/auth/logout` deletes the current browser session.
- `POST /api/auth/logout-all` deletes every session for that account.
- Password reset invalidates every existing account session.
- Authentication and recovery endpoints retain their existing rate limits and
  non-enumerating error behavior.

## Session invariants

- Refresh-secret lookup has one owner in `backend/app/services/auth.py`.
- Refresh, login/register session reuse, logout, and logout-all use the same
  current/previous-secret matching rules.
- A successful refresh rotates only the secret; the durable `UserSession.id`
  stays stable.
- Concurrent refreshes using the same just-rotated secret serialize on the
  database row and remain in one session family.
- Revoked or expired session rows are removed when encountered.
- Successful access-token authentication finishes its read transaction before
  route code waits on external services.
- Cookies are Secure in production (and on HTTPS requests), HttpOnly, SameSite
  Lax, and never exposed to frontend JavaScript.

## Ownership

- `backend/app/api/routes/auth.py`: HTTP transport, endpoint rate limits,
  response/cookie wiring.
- `backend/app/services/auth.py`: account/session lifecycle rules and
  refresh-secret rotation/revocation.
- `backend/app/security/tokens.py`: JWT and opaque refresh-token primitives.
- `backend/app/security/passwords.py`: password hashing and verification.
- `backend/app/api/dependencies.py`: access-token authentication for protected
  routes.

Every consolidation change must pass the PostgreSQL backend suite, Ruff,
Pyright, frontend tests/build, security/audit checks, production image build,
Windows verification, and browser journeys before another subsystem begins.
