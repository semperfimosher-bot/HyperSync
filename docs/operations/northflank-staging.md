# Northflank staging deployment

This guide is for a **separate staging environment**. Do not connect staging to the production database, object-storage bucket, or production API.

## Repository and branch

- Repository: `semperfimosher-bot/HyperSync`
- Branch: `Shane`
- Build from the repository root for both services.

## Backend service

Create a Northflank service from the repository with:

- Dockerfile path: `Dockerfile.backend`
- Build context: repository root
- Internal/listening port: `8000` (the image honors Northflank's `PORT` variable)
- Health/readiness path: `/api/health/ready` if the app is mounted under `/api`; otherwise verify the app's actual exposed route before configuring the probe.

Set the service's runtime environment variables in Northflank's secret/environment UI, not in Git. At minimum, configure a staging-only PostgreSQL `DATABASE_URL`, a strong random `JWT_SECRET`, `ENVIRONMENT=staging` only if the application supports that value (currently it accepts development, test, or production, so use the supported value appropriate for staging and review this constraint before deployment), and `FRONTEND_ORIGINS` / `FRONTEND_PUBLIC_URL` for the actual staging frontend origin. Also supply the storage/provider secrets required for the features being tested. If using `MIGRATION_DATABASE_URL`, it must target the same staging database, with migration privileges.

**Configuration note:** current backend settings validate `ENVIRONMENT` against `development`, `test`, or `production`; do not set it to `staging` until that validation is deliberately changed and tested.

## Frontend service

Create a second Northflank service from the same repository:

- Dockerfile path: `frontend/Dockerfile`
- Build context: repository root
- Listening port: `80`
- Health path: `/health`

The image defaults preserve the current production route. For staging, set these two runtime environment variables on the frontend service:

- `API_UPSTREAM_URL`: the staging backend's reachable origin, including scheme, for example `https://YOUR-STAGING-BACKEND-DOMAIN` or the private internal HTTP origin Northflank provides.
- `API_UPSTREAM_HOST`: the upstream hostname only, without scheme or path. Use the hostname expected by the backend service. If the URL uses a port, keep that port in `API_UPSTREAM_URL`; do not include it in the TLS server name.

The Nginx container renders `frontend/nginx.conf` at startup from these values. Browser API traffic remains same-origin at `/api/...`, but Nginx forwards it to the configured backend. Do not set these to the production API for staging.

## Before opening staging to testers

1. Confirm the frontend and backend both deploy from branch `Shane`.
2. Confirm the backend health/readiness endpoint succeeds and reports its database as healthy.
3. Confirm the frontend `/health` returns `healthy`.
4. In browser DevTools, verify API requests from the staging frontend reach the staging backend and not `api.hypersynced.app`.
5. Test login/session refresh, catalog/search, playlist isolation, uploads using test media, and playback with authorized media.
6. Only after these checks pass, run `load/k6-40-users.js` against the staging API. Never run it against production without an explicitly approved test window.

This repository configuration is not proof of a successful Northflank deployment; verify the rendered service configuration and live health endpoints after creating the services.
