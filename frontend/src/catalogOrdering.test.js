import assert from "node:assert/strict";
import test from "node:test";

import {
  isCatalogSingle,
  sortCatalogFolderTracks,
} from "./catalogOrdering.js";


test(
  "catalog folders sort albums first and singles last alphabetically",
  () => {
    const tracks = [
      {
        id: "single-z",
        title: "Zebra",
        artist: "Artist",
        album: "Zebra - Single",
      },
      {
        id: "album-b-2",
        title: "Second",
        artist: "Artist",
        album: "Beta",
      },
      {
        id: "single-a",
        title: "Alpha",
        artist: "Artist",
        album: null,
      },
      {
        id: "album-a-2",
        title: "Zulu",
        artist: "Artist",
        album: "Alpha Album",
      },
      {
        id: "album-a-1",
        title: "Apple",
        artist: "Artist",
        album: "Alpha Album",
      },
      {
        id: "album-b-1",
        title: "First",
        artist: "Artist",
        album: "Beta",
      },
      {
        id: "single-title-album",
        title: "Middle",
        artist: "Artist",
        album: "Middle",
      },
    ];

    const sorted =
      sortCatalogFolderTracks(
        tracks,
      );

    assert.deepEqual(
      sorted.map(
        (track) =>
          track.id,
      ),
      [
        "album-a-1",
        "album-a-2",
        "album-b-1",
        "album-b-2",
        "single-a",
        "single-title-album",
        "single-z",
      ],
    );
  },
);


test(
  "single detection handles common catalog metadata forms",
  () => {
    assert.equal(
      isCatalogSingle({
        title: "Song",
        album: null,
      }),
      true,
    );

    assert.equal(
      isCatalogSingle({
        title: "Song",
        album: "Song",
      }),
      true,
    );

    assert.equal(
      isCatalogSingle({
        title: "Song",
        album: "Song - Single",
      }),
      true,
    );

    assert.equal(
      isCatalogSingle({
        title: "Song",
        album: "Song (Single)",
      }),
      true,
    );

    assert.equal(
      isCatalogSingle({
        title: "Song",
        album: "Actual Album",
      }),
      false,
    );
  },
);


test(
  "catalog ordering does not mutate the source array",
  () => {
    const tracks = [
      {
        id: "b",
        title: "B",
        album: null,
      },
      {
        id: "a",
        title: "A",
        album: "Album",
      },
    ];

    const snapshot =
      tracks.map(
        (track) =>
          track.id,
      );

    sortCatalogFolderTracks(
      tracks,
    );

    assert.deepEqual(
      tracks.map(
        (track) =>
          track.id,
      ),
      snapshot,
    );
  },
);
