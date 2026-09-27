import assert from "node:assert/strict";
import test from "node:test";

import {
  duplicateTrackIdsToDelete,
} from "./duplicateCleanup.js";


test(
  "duplicate cleanup keeps one canonical track per group",
  () => {
    assert.deepEqual(
      duplicateTrackIdsToDelete({
        groups: [
          {
            keep_track_id:
              "keep-one",
            tracks: [
              {
                id:
                  "delete-one",
              },
              {
                id:
                  "keep-one",
              },
              {
                id:
                  "delete-two",
              },
            ],
          },
          {
            keep_track_id:
              "keep-two",
            tracks: [
              {
                id:
                  "keep-two",
              },
              {
                id:
                  "delete-three",
              },
            ],
          },
        ],
      }),
      [
        "delete-one",
        "delete-two",
        "delete-three",
      ],
    );
  },
);


test(
  "duplicate cleanup falls back to the first track when keeper metadata is absent",
  () => {
    assert.deepEqual(
      duplicateTrackIdsToDelete({
        groups: [
          {
            tracks: [
              {
                id:
                  "keep",
              },
              {
                id:
                  "delete",
              },
            ],
          },
        ],
      }),
      [
        "delete",
      ],
    );
  },
);
