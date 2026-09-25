import assert from "node:assert/strict";
import test from "node:test";

import {
  PAGE_WARM_TTL_MS,
  pruneWarmPages,
  touchWarmPage,
  warmPageKey,
} from "./pageWarmCache.js";


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
  "warm pages survive until two hours after leaving",
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
