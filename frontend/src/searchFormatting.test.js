import assert from "node:assert/strict";
import test from "node:test";

import {
  formatDuration,
} from "./searchFormatting.js";


test(
  "formatDuration formats positive whole and fractional durations",
  () => {
    assert.equal(formatDuration(0.9), "--:--");
    assert.equal(formatDuration(1), "0:01");
    assert.equal(formatDuration(59.9), "0:59");
    assert.equal(formatDuration(60), "1:00");
    assert.equal(formatDuration(183), "3:03");
    assert.equal(formatDuration(3600), "60:00");
  },
);


test(
  "formatDuration handles invalid and non-positive values",
  () => {
    assert.equal(formatDuration(0), "--:--");
    assert.equal(formatDuration(-1), "--:--");
    assert.equal(formatDuration(Number.NaN), "--:--");
    assert.equal(formatDuration(Number.POSITIVE_INFINITY), "--:--");
    assert.equal(formatDuration("not a duration"), "--:--");
    assert.equal(formatDuration(null), "--:--");
  },
);
