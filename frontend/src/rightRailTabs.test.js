import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeRightRailTab,
} from "./rightRailTabs.js";


test(
  "right rail defaults invalid tabs to queue",
  () => {
    assert.equal(
      normalizeRightRailTab(),
      "queue",
    );

    assert.equal(
      normalizeRightRailTab(
        "something-else",
      ),
      "queue",
    );
  },
);


test(
  "right rail accepts lyrics",
  () => {
    assert.equal(
      normalizeRightRailTab(
        "lyrics",
      ),
      "lyrics",
    );
  },
);
