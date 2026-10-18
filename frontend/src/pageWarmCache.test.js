import assert from "node:assert/strict";
import test from "node:test";

import {
  PAGE_WARM_TTL_MS,
  pruneWarmPages,
  touchWarmPage,
  warmPageKey,
} from "./pageWarmCache.js";

test("a thousand profile visits retain only the eight most recent profiles", () => {
  let pages = touchWarmPage([], { page: "admin-uploads", ownerKey: "user:1", now: 1 });
  const uploadInstance = pages[0].instanceKey;
  for (let i = 0; i < 1000; i += 1) {
    pages = touchWarmPage(pages, {
      page: "public-profile", profileUsername: `person-${i}`, ownerKey: "user:1", now: 2 + i,
    });
  }
  assert.equal(pages.length, 9);
  assert.equal(pages.find((page) => page.key === "admin-uploads").instanceKey, uploadInstance);
  assert.deepEqual(pages.filter((page) => page.page === "public-profile").map((page) => page.profileUsername),
    Array.from({ length: 8 }, (_, i) => `person-${992 + i}`));
});

test("profile pruning preserves the active profile even if its timestamp is oldest", () => {
  const pages = Array.from({ length: 12 }, (_, i) => ({
    key: `public-profile:person-${i}`, page: "public-profile", ownerKey: "user:1", lastVisitedAt: i,
  }));
  const kept = pruneWarmPages(pages, { activeKey: pages[0].key, ownerKey: "user:1", now: 100 });
  assert.equal(kept.length, 8);
  assert.ok(kept.includes(pages[0]));
  assert.deepEqual(kept.slice(1), pages.slice(5));
  assert.equal(pages.length, 12, "pruning does not mutate its input");
});

test("revisiting a retained profile promotes it without remounting", () => {
  let pages = [];
  for (let i = 0; i < 8; i += 1) {
    pages = touchWarmPage(pages, { page: "public-profile", profileUsername: `person-${i}`, ownerKey: "user:1", now: i });
  }
  const firstInstance = pages[0].instanceKey;
  pages = touchWarmPage(pages, { page: "public-profile", profileUsername: "person-0", ownerKey: "user:1", now: 10 });
  pages = touchWarmPage(pages, { page: "public-profile", profileUsername: "person-8", ownerKey: "user:1", now: 11 });
  assert.equal(pages.length, 8);
  assert.equal(pages.find((page) => page.key === "public-profile:person-0").instanceKey, firstInstance);
  assert.equal(pages.some((page) => page.key === "public-profile:person-1"), false);
});

test("visits sharing a timestamp still evict the least recently touched profile", () => {
  let pages = [];
  for (let i = 0; i < 9; i += 1) {
    pages = touchWarmPage(pages, { page: "public-profile", profileUsername: `person-${i}`, ownerKey: "user:1", now: 100 });
  }
  assert.deepEqual(pages.map((page) => page.profileUsername),
    Array.from({ length: 8 }, (_, i) => `person-${i + 1}`));
});


test(
  "public profiles get stable page-specific warm keys",
  () => {
    assert.equal(
      warmPageKey(
        "public-profile",
        "  Alice  ",
      ),
      "public-profile:alice",
    );

    assert.equal(
      warmPageKey(
        "library",
        "ignored",
      ),
      "library",
    );
  },
);


test(
  "warm pages survive until twelve hours after leaving",
  () => {
    const ownerKey =
      "user:1";

    const touched =
      touchWarmPage(
        [],
        {
          page:
            "admin-uploads",
          ownerKey,
          now:
            1_000,
        },
      );

    const beforeExpiry =
      pruneWarmPages(
        touched,
        {
          activeKey:
            "home",
          ownerKey,
          now:
            1_000 +
            PAGE_WARM_TTL_MS -
            1,
        },
      );

    assert.equal(
      beforeExpiry.length,
      1,
    );

    const afterExpiry =
      pruneWarmPages(
        touched,
        {
          activeKey:
            "home",
          ownerKey,
          now:
            1_000 +
            PAGE_WARM_TTL_MS,
        },
      );

    assert.equal(
      afterExpiry.length,
      0,
    );
  },
);


test(
  "touching a page refreshes its warm lifetime without duplicating it",
  () => {
    const ownerKey =
      "user:1";

    const first =
      touchWarmPage(
        [],
        {
          page:
            "search",
          ownerKey,
          now:
            100,
        },
      );

    const second =
      touchWarmPage(
        first,
        {
          page:
            "search",
          ownerKey,
          now:
            500,
        },
      );

    assert.equal(
      second.length,
      1,
    );

    assert.equal(
      second[0]
        .lastVisitedAt,
      500,
    );
  },
);


test(
  "warm pages never carry across account identities",
  () => {
    const firstOwner =
      touchWarmPage(
        [],
        {
          page:
            "library",
          ownerKey:
            "user:1",
          now:
            100,
        },
      );

    const secondOwner =
      touchWarmPage(
        firstOwner,
        {
          page:
            "home",
          ownerKey:
            "user:2",
          now:
            200,
        },
      );

    assert.deepEqual(
      secondOwner.map(
        (entry) =>
          entry.ownerKey,
      ),
      [
        "user:2",
      ],
    );
  },
);


test(
  "expired pages receive a fresh instance key when revisited",
  () => {
    const ownerKey =
      "user:1";

    const first =
      touchWarmPage(
        [],
        {
          page:
            "admin-catalog",
          ownerKey,
          now:
            100,
        },
      );

    const revisited =
      touchWarmPage(
        first,
        {
          page:
            "admin-catalog",
          ownerKey,
          now:
            100 +
            PAGE_WARM_TTL_MS,
        },
      );

    assert.notEqual(
      revisited[0]
        .instanceKey,
      first[0]
        .instanceKey,
    );
  },
);
