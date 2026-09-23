import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveMediaUrl,
} from "./mediaCache.js";


test(
  "blob media URLs pass through unchanged",
  () => {
    const url =
      "blob:http://localhost:5173/73730be7-ac2f-4912-ab3c-6ca55311cfa1";

    assert.equal(
      resolveMediaUrl(url),
      url,
    );
  },
);


test(
  "data media URLs pass through unchanged",
  () => {
    const url =
      "data:audio/mpeg;base64,SUQz";

    assert.equal(
      resolveMediaUrl(url),
      url,
    );
  },
);
