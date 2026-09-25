import http from "k6/http";
import {
  check,
  sleep,
} from "k6";


const BASE_URL =
  (__ENV.TARGET_BASE_URL || "")
    .replace(
      /\/$/,
      "",
    );

if (!BASE_URL) {
  throw new Error(
    "Set TARGET_BASE_URL to a staging API URL before running this test.",
  );
}


export const options = {
  scenarios: {
    five_hundred_users: {
      executor:
        "ramping-vus",

      startVUs:
        0,

      stages: [
        {
          duration:
            "1m",
          target:
            50,
        },
        {
          duration:
            "2m",
          target:
            150,
        },
        {
          duration:
            "2m",
          target:
            300,
        },
        {
          duration:
            "2m",
          target:
            500,
        },
        {
          duration:
            "5m",
          target:
            500,
        },
        {
          duration:
            "1m",
          target:
            0,
        },
      ],

      gracefulRampDown:
        "30s",
    },
  },

  thresholds: {
    http_req_failed: [
      "rate<0.01",
    ],

    http_req_duration: [
      "p(95)<750",
      "p(99)<1500",
    ],
  },
};


export default function () {
  const catalog =
    http.get(
      `${BASE_URL}/api/catalog/tracks`,
      {
        tags: {
          route:
            "catalog",
        },
      },
    );

  check(
    catalog,
    {
      "catalog is 200":
        (response) =>
          response.status ===
          200,
    },
  );

  const search =
    http.get(
      `${BASE_URL}/api/search?q=music&sort=smart`,
      {
        tags: {
          route:
            "search",
        },
      },
    );

  check(
    search,
    {
      "search is 200":
        (response) =>
          response.status ===
          200,
    },
  );

  sleep(
    0.75
    + Math.random()
      * 1.25,
  );
}
