export const WS_BASE_URL = (
  import.meta.env.VITE_WS_URL || "ws://127.0.0.1:8000"
).replace(/\/$/, "");

export function createHyperSyncSocket(path) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  return new WebSocket(`${WS_BASE_URL}${normalizedPath}`);
}