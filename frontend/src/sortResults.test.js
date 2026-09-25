import assert from "node:assert/strict";
import test from "node:test";

import {
  sortResultItems,
} from "./sortResults.js";


const tracks = [
  {
    id: "one",
    title: "Zulu",
    artist: "Beta",
    album: "Second",
    last_played_at:
      "2026-09-20T12:00:00Z",
  },
  {
    id: "two",
    title: "Alpha",
    artist: "Alpha",
    album: "First",
    last_played_at:
      "2026-09-23T12:00:00Z",
  },
  {
    id: "three",
    title: "Bravo",
    artist: "Alpha",
    album: "First",
    last_played_at:
      null,
  },
];


test(
  "smart sort preserves source order",
  () => {
    assert.deepEqual(
      sortResultItems(
        tracks,
        "smart",
      ).map(
        (track) => track.id,
      ),
      [
        "one",
        "two",
        "three",
      ],
    );
  },
);


test(
  "recents sorts newest first and keeps unknown recency last",
  () => {
    assert.deepEqual(
      sortResultItems(
        tracks,
        "recent",
      ).map(
        (track) => track.id,
      ),
      [
        "two",
        "one",
        "three",
      ],
    );
  },
);


test(
  "albums groups by album then artist and title",
  () => {
    assert.deepEqual(
      sortResultItems(
        tracks,
        "albums",
      ).map(
        (track) => track.id,
      ),
      [
        "two",
        "three",
        "one",
      ],
    );
  },
);


test(
  "alphabetical sorts by visible title",
  () => {
    assert.deepEqual(
      sortResultItems(
        tracks,
        "alphabetical",
      ).map(
        (track) => track.title,
      ),
      [
        "Alpha",
        "Bravo",
        "Zulu",
      ],
    );
  },
);
