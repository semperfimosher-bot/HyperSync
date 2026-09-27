import assert from "node:assert/strict";
import test from "node:test";

import {
  sortPinnedPlaylists,
  togglePinnedPlaylistId,
} from "./playlistPins.js";


test(
  "pinned playlists stay ahead of the selected sort order",
  () => {
    const sorted = [
      { id: "a" },
      { id: "b" },
      { id: "c" },
      { id: "d" },
    ];

    assert.deepEqual(
      sortPinnedPlaylists(
        sorted,
        [
          "c",
          "a",
        ],
      ).map(
        (playlist) =>
          playlist.id,
      ),
      [
        "a",
        "c",
        "b",
        "d",
      ],
    );
  },
);


test(
  "playlist pin toggles without duplicates",
  () => {
    assert.deepEqual(
      togglePinnedPlaylistId(
        [
          "one",
          "one",
        ],
        "two",
      ).sort(),
      [
        "one",
        "two",
      ],
    );

    assert.deepEqual(
      togglePinnedPlaylistId(
        [
          "one",
          "two",
        ],
        "one",
      ),
      [
        "two",
      ],
    );
  },
);
