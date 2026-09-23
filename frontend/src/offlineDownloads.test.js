import test from "node:test";
import assert from "node:assert/strict";

import {
  getMissingDownloadBytes,
} from "./offlineDownloads.js";


test(
  "resume storage math counts only missing bytes",
  () => {
    assert.equal(
      getMissingDownloadBytes(
        1_000_000,
        {
          cachedBytes:
            750_000,
        },
      ),
      250_000,
    );
  },
);


test(
  "resume storage math clamps stale cached-byte metadata",
  () => {
    assert.equal(
      getMissingDownloadBytes(
        1_000_000,
        {
          cachedBytes:
            2_000_000,
        },
      ),
      0,
    );

    assert.equal(
      getMissingDownloadBytes(
        1_000_000,
        {
          cachedBytes:
            -100,
        },
      ),
      1_000_000,
    );
  },
);


test(
  "resume storage math rejects invalid file sizes safely",
  () => {
    assert.equal(
      getMissingDownloadBytes(
        0,
        {
          cachedBytes:
            10,
        },
      ),
      0,
    );

    assert.equal(
      getMissingDownloadBytes(
        Number.NaN,
        null,
      ),
      0,
    );
  },
);
