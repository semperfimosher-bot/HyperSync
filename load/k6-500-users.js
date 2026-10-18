import http from "k6/http";
import { check, sleep } from "k6";

// This legacy 500-user scenario is not part of the Stage 8 acceptance gate.
// Keep it guarded so it cannot be launched accidentally against production.
const BASE_URL = (__ENV.TARGET_BASE_URL || "").trim().replace(/\/+$/, "");
const EXPECTED_STAGING_HOST = (__ENV.EXPECTED_STAGING_HOST || "")
  .trim()
  .toLowerCase();
const CONFIRM_STAGING_ONLY = __ENV.CONFIRM_STAGING_ONLY || "";

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
if (CONFIRM_STAGING_ONLY !== "YES") {
  throw new Error(
    "Set CONFIRM_STAGING_ONLY=YES only after verifying this is isolated staging.",
  );
}
if (!EXPECTED_STAGING_HOST) {
  throw new Error(
    "Set EXPECTED_STAGING_HOST to the exact verified staging API hostname.",
  );
}
if (targetUrl.hostname.toLowerCase() !== EXPECTED_STAGING_HOST) {
  throw new Error(
    "TARGET_BASE_URL hostname does not match EXPECTED_STAGING_HOST.",
  );
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

export const options = {
  scenarios: {
    five_hundred_users: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "1m", target: 50 },
        { duration: "2m", target: 150 },
        { duration: "2m", target: 300 },
        { duration: "2m", target: 500 },
        { duration: "5m", target: 500 },
        { duration: "1m", target: 0 },
      ],
      gracefulRampDown: "30s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<750", "p(99)<1500"],
  },
};

export default function () {
  const requestOptions = {
    tags: { route: "catalog" },
    timeout: "10s",
  };
  const catalog = http.get(`${BASE_URL}/api/catalog/tracks`, requestOptions);
  check(catalog, {
    "catalog is 200": (response) => response.status === 200,
  });

  const search = http.get(`${BASE_URL}/api/search?q=music&sort=smart`, {
    tags: { route: "search" },
    timeout: "10s",
  });
  check(search, {
    "search is 200": (response) => response.status === 200,
  });

  sleep(0.75 + Math.random() * 1.25);
}
