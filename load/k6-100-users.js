import http from "k6/http";
import { check, sleep } from "k6";

// Run only against a staging deployment you control. This script intentionally
// requires an explicit target so it cannot accidentally load-test production.
const BASE_URL = (__ENV.TARGET_BASE_URL || "").replace(/\/$/, "");
const AUTH_TOKEN = __ENV.TEST_AUTH_TOKEN || "";

if (!BASE_URL) {
  throw new Error("Set TARGET_BASE_URL to a staging API URL.");
}

const headers = AUTH_TOKEN
  ? { Authorization: `Bearer ${AUTH_TOKEN}` }
  : {};

export const options = {
  scenarios: {
    steady_100_users: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "1m", target: 10 },
        { duration: "1m", target: 25 },
        { duration: "1m", target: 50 },
        { duration: "2m", target: 100 },
        { duration: "5m", target: 100 },
        { duration: "1m", target: 0 },
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
  request("/api/catalog/tracks", "catalog");
  sleep(0.2 + Math.random() * 0.4);
  request("/api/search?q=music&sort=smart", "search");

  // Private endpoints are tested only with a dedicated staging test account.
  if (AUTH_TOKEN) {
    request("/api/playlists/library/tracks", "library");
    request("/api/playlists/mine", "playlists");
  }

  sleep(0.5 + Math.random());
}
