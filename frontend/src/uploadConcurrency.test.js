import assert from "node:assert/strict";
import test from "node:test";

import {
  getUploadConcurrency,
} from "./uploadConcurrency.js";


test(
  "single upload uses one worker",
  () => {
    assert.equal(
      getUploadConcurrency({
        queuedCount: 1,
      }),
      1,
    );
  },
);


test(
  "save-data and very slow links use one worker",
  () => {
    assert.equal(
      getUploadConcurrency({
        queuedCount: 5,
        connection: {
          saveData: true,
          effectiveType: "4g",
          downlink: 20,
        },
        hardwareConcurrency: 8,
      }),
      1,
    );

    assert.equal(
      getUploadConcurrency({
        queuedCount: 5,
        connection: {
          saveData: false,
          effectiveType: "2g",
          downlink: 0.5,
        },
        hardwareConcurrency: 8,
      }),
      1,
    );
  },
);


test(
  "normal connections keep two workers",
  () => {
    assert.equal(
      getUploadConcurrency({
        queuedCount: 6,
        connection: {
          saveData: false,
          effectiveType: "4g",
          downlink: 5,
        },
        hardwareConcurrency: 4,
      }),
      2,
    );
  },
);


test(
  "fast desktop connections can use three workers",
  () => {
    assert.equal(
      getUploadConcurrency({
        queuedCount: 6,
        connection: {
          saveData: false,
          effectiveType: "4g",
          downlink: 25,
        },
        hardwareConcurrency: 8,
      }),
      3,
    );
  },
);
