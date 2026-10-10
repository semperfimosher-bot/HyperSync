#!/bin/sh
set -eu

# Render the CSP with the frontend's own WebSocket origin before Nginx starts.
# Keep this as an entrypoint hook so the official Nginx template renderer
# still runs for /etc/nginx/templates/default.conf.template.
: "${FRONTEND_WS_ORIGIN:=wss://hypersynced.app}"
export FRONTEND_WS_ORIGIN

envsubst '${FRONTEND_WS_ORIGIN}' \
  < /etc/nginx/security-headers.conf.template \
  > /etc/nginx/security-headers.conf
