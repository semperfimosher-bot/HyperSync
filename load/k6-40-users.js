import http from "k6/http";
import { check, sleep } from "k6";

// Run only against a staging deployment you control. Never point this at
// production without an explicitly approved maintenance/load-test window.
const BASE_URL = (__ENV.TARGET_BASE_URL || "").replace(/\/$/, "");
const AUTH_TOKEN = __ENV.TEST_AUTH_TOKEN || "";

if (!BASE_URL) {
  throw new Error("Set TARGET_BASE_URL to your staging API URL.");
}

const headers = AUTH_TOKEN
  ? { Authorization: `Bearer ${AUTH_TOKEN}` }
  : {};

export const options = {
  scenarios: {
    steady_40_users: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 5 },
        { duration: "1m", target: 5 },
        { duration: "30s", target: 10 },
        { duration: "1m", target: 10 },
        { duration: "30s", target: 20 },
        { duration: "2m", target: 20 },
        { duration: "30s", target: 40 },
        { duration: "5m", target: 40 },
        { duration: "30s", target: 0 },
      ],
      gracefulRampDown: "30s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<750", "p(99)<1500"],
    "http_req_duration{route:catalog}": ["p(95)<750"],
    "http_req_duration{route:search}": ["p(95)<750"],
  },
};

function request(path, route, expectedStatus = 200) {
  const response = http.get(`${BASE_URL}${path}`, {
    headers,
    tags: { route },
    timeout: "10s",
  });

  check(response, {
    [`${route} returns ${expectedStatus}`]: (r) =>
      r.status === expectedStatus,
  });
  return response;
}

export default function () {
  // Public browsing paths used by guest and signed-in users.
  request("/api/catalog/tracks", "catalog");
  sleep(0.2 + Math.random() * 0.4);
  request("/api/search?q=music&sort=smart", "search");

  // Supply a dedicated staging user's access token to exercise private data
  // endpoints too. Without it, this run deliberately tests public browsing only.
  if (AUTH_TOKEN) {
    request("/api/playlists/library/tracks", "library");
    request("/api/playlists/mine", "playlists");
  }

  sleep(0.5 + Math.random());
}
