import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeSharedMusicItem,
  trackShareItem,
} from "./musicShare.js";


test(
  "normalizes shared music payloads",
  () => {
    assert.deepEqual(
      normalizeSharedMusicItem({
        kind:
          "playlist",
        id:
          "playlist-1",
        title:
          "Road Trip",
        subtitle:
          "listener",
        artworkUrl:
          "/cover.jpg",
      }),
      {
        kind:
          "playlist",
        key:
          "playlist-1",
        title:
          "Road Trip",
        subtitle:
          "listener",
        artwork_url:
          "/cover.jpg",
      },
    );
  },
);


test(
  "track shares include artist and album context",
  () => {
    assert.deepEqual(
      trackShareItem({
        id:
          "track-1",
        title:
          "Midnight",
        artist:
          "Nova",
        album:
          "Roads",
        artwork_url:
          "/art.jpg",
      }),
      {
        kind:
          "track",
        key:
          "track-1",
        title:
          "Midnight",
        subtitle:
          "Nova • Roads",
        artwork_url:
          "/art.jpg",
      },
    );
  },
);


test(
  "invalid share payloads are rejected",
  () => {
    assert.equal(
      normalizeSharedMusicItem({
        kind:
          "unknown",
        key:
          "1",
        title:
          "Nope",
      }),
      null,
    );

    assert.equal(
      normalizeSharedMusicItem({
        kind:
          "artist",
        title:
          "Missing key",
      }),
      null,
    );
  },
);
