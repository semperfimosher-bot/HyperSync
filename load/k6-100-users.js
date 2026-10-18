import http from "k6/http";
import { check, sleep } from "k6";

// Run only against a staging deployment you control. This script intentionally
// requires an explicit target so it cannot accidentally load-test production.
const BASE_URL = (__ENV.TARGET_BASE_URL || "").trim().replace(/\/+$/, "");
const AUTH_TOKEN = __ENV.TEST_AUTH_TOKEN || "";

if (!BASE_URL) {
  throw new Error("Set TARGET_BASE_URL to your staging API origin.");
}

let targetUrl;
try {
  targetUrl = new URL(BASE_URL);
} catch {
  throw new Error("TARGET_BASE_URL must be a valid staging API origin.");
}

const blockedProductionHosts = new Set([
  "hypersynced.app",
  "www.hypersynced.app",
  "api.hypersynced.app",
]);

if (blockedProductionHosts.has(targetUrl.hostname.toLowerCase())) {
  throw new Error("Refusing to load-test a known HyperSynced production host.");
}

if (
  !["http:", "https:"].includes(targetUrl.protocol) ||
  targetUrl.username ||
  targetUrl.password ||
  targetUrl.pathname !== "/" ||
  targetUrl.search ||
  targetUrl.hash
) {
  throw new Error(
    "TARGET_BASE_URL must be an HTTP(S) origin only, with no credentials, path, query, or fragment.",
  );
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
  // Exercise both the beginning and later offsets of a large catalog while
  // keeping each response bounded. The test fixture should contain 100,000
  // published tracks for the offsets to represent the target workload.
  const offset = ((__VU - 1) % 100) * 1000;
  request(
    `/api/catalog/tracks?limit=1000&offset=${offset}`,
    "catalog",
  );
  sleep(0.2 + Math.random() * 0.4);
  request("/api/search?q=music&sort=smart", "search");

  // Private endpoints are tested only with a dedicated staging test account.
  if (AUTH_TOKEN) {
    request(
      `/api/playlists/library/tracks?limit=1000&offset=${offset}`,
      "library",
    );
    request("/api/playlists/mine", "playlists");
  }

  sleep(0.5 + Math.random());
}
