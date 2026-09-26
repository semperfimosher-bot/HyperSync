import assert from "node:assert/strict";
import test from "node:test";

import {
  filterPlaylistTracks,
} from "./playlistTrackSearch.js";


const tracks = [
  {
    id:
      "1",
    title:
      "Midnight Drive",
    artist:
      "Nova",
    album:
      "Neon Roads",
  },
  {
    id:
      "2",
    title:
      "Ocean Eyes",
    artist:
      "Luna",
    album:
      "Blue",
  },
  {
    id:
      "3",
    title:
      "Café Lights",
    artist:
      "Nova",
    album:
      "After Hours",
  },
];


test(
  "playlist search matches title artist and album",
  () => {
    assert.deepEqual(
      filterPlaylistTracks(
        tracks,
        "nova",
      ).map(
        (track) =>
          track.id,
      ),
      [
        "1",
        "3",
      ],
    );

    assert.deepEqual(
      filterPlaylistTracks(
        tracks,
        "blue",
      ).map(
        (track) =>
          track.id,
      ),
      [
        "2",
      ],
    );

    assert.deepEqual(
      filterPlaylistTracks(
        tracks,
        "midnight",
      ).map(
        (track) =>
          track.id,
      ),
      [
        "1",
      ],
    );
  },
);


test(
  "playlist search is case and accent insensitive",
  () => {
    assert.deepEqual(
      filterPlaylistTracks(
        tracks,
        "CAFE",
      ).map(
        (track) =>
          track.id,
      ),
      [
        "3",
      ],
    );
  },
);


test(
  "blank playlist search preserves the original ordered list",
  () => {
    assert.equal(
      filterPlaylistTracks(
        tracks,
        "   ",
      ),
      tracks,
    );
  },
);
