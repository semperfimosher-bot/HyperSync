import assert from "node:assert/strict";
import test from "node:test";

import {
  accountPlaybackPosition,
  playbackUpdatedAtMs,
} from "./playbackClock.js";


test(
  "paused account playback position stays fixed",
  () => {
    assert.equal(
      accountPlaybackPosition({
        paused:
          true,
        position_seconds:
          42.5,
        updated_at:
          new Date(
            Date.now() -
              20_000,
          ).toISOString(),
        track: {
          duration_seconds:
            180,
        },
      }),
      42.5,
    );
  },
);


test(
  "playing account position advances and clamps to duration",
  () => {
    const now =
      Date.now();

    const originalNow =
      Date.now;

    Date.now = () =>
      now;

    try {
      const updatedAt =
        new Date(
          now -
            5_000,
        ).toISOString();

      assert.equal(
        Math.round(
          accountPlaybackPosition({
            paused:
              false,
            position_seconds:
              10,
            updated_at:
              updatedAt,
            track: {
              duration_seconds:
                180,
            },
          }),
        ),
        15,
      );

      assert.equal(
        accountPlaybackPosition({
          paused:
            false,
          position_seconds:
            179,
          updated_at:
            updatedAt,
          track: {
            duration_seconds:
              180,
          },
        }),
        180,
      );
    } finally {
      Date.now =
        originalNow;
    }
  },
);


test(
  "invalid playback timestamps are treated as zero age",
  () => {
    assert.equal(
      playbackUpdatedAtMs(
        "not-a-date",
      ),
      0,
    );

    assert.equal(
      accountPlaybackPosition({
        paused:
          false,
        position_seconds:
          12,
        updated_at:
          "not-a-date",
        track: {
          duration_seconds:
            180,
        },
      }),
      12,
    );
  },
);
