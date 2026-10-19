import http from "k6/http";
import { check, sleep } from "k6";

// Run only against an isolated staging deployment you control. The official
// HyperSynced production hosts are explicitly rejected below.
const BASE_URL = (__ENV.TARGET_BASE_URL || "").trim().replace(/\/+$/, "");
const AUTH_TOKEN = __ENV.TEST_AUTH_TOKEN || "";
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

const targetHost = targetUrl.hostname.toLowerCase();
if (
  targetHost === "hypersynced.app" ||
  targetHost.endsWith(".hypersynced.app")
) {
  throw new Error("Refusing to load-test a HyperSynced production host or subdomain.");
}

if (CONFIRM_STAGING_ONLY !== "YES") {
  throw new Error("Set CONFIRM_STAGING_ONLY=YES only after verifying this is isolated staging.");
}
if (!EXPECTED_STAGING_HOST) {
  throw new Error("Set EXPECTED_STAGING_HOST to the exact verified staging API hostname.");
}
if (targetUrl.hostname.toLowerCase() !== EXPECTED_STAGING_HOST) {
  throw new Error("TARGET_BASE_URL hostname does not match EXPECTED_STAGING_HOST.");
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
    checks: ["rate>0.99"],
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

function checkCatalogPage(response) {
  let page;
  try {
    page = response.json();
  } catch {
    check(null, { "catalog returns a page envelope": () => false });
    return null;
  }

  check(page, {
    "catalog returns a page envelope": (value) =>
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Array.isArray(value.items),
    "catalog page is bounded to 250 tracks": (value) =>
      Array.isArray(value?.items) && value.items.length <= 250,
    "catalog cursor is null or a string": (value) =>
      value?.next_cursor === null || typeof value?.next_cursor === "string",
  });
  return page;
}

export default function () {
  const libraryOffset = ((__VU - 1) % 10) * 1000;

  // Match the real client: request a bounded first page rather than the legacy
  // full-catalog export, which would distort load and memory measurements.
  const firstPageResponse = request(
    "/api/catalog/tracks?page_size=250",
    "catalog",
  );
  if (firstPageResponse.status === 200) {
    const firstPage = checkCatalogPage(firstPageResponse);
    if (typeof firstPage?.next_cursor === "string") {
      const nextPageResponse = request(
        `/api/catalog/tracks?page_size=250&cursor=${encodeURIComponent(firstPage.next_cursor)}`,
        "catalog",
      );
      if (nextPageResponse.status === 200) {
        checkCatalogPage(nextPageResponse);
      }
    }
  }

  sleep(0.2 + Math.random() * 0.4);
  request("/api/search?q=music&sort=smart", "search");

  // Private endpoints are exercised only with a dedicated staging account.
  if (AUTH_TOKEN) {
    const libraryResponse = request(
      `/api/playlists/library/tracks?limit=1000&offset=${libraryOffset}`,
      "library",
    );
    if (libraryResponse.status === 200) {
      check(libraryResponse, {
        "library response is a bounded page": (response) => {
          try {
            const body = response.json();
            return Array.isArray(body) && body.length <= 1000;
          } catch {
            return false;
          }
        },
      });
    }
    request("/api/playlists/mine", "playlists");
  }

  sleep(0.5 + Math.random());
}
