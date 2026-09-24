import test from "node:test";
import assert from "node:assert/strict";

import {
  buildLibraryAlbums,
  buildLibraryArtists,
} from "./libraryEntities.js";


test(
  "artists group normalized names and deduplicate tracks",
  () => {
    const tracks = [
      {
        id: "track-1",
        title: "One",
        artist: "  Example   Artist ",
        album: "First Album",
        artwork_url: null,
      },
      {
        id: "track-1",
        title: "One",
        artist: "example artist",
        album: "First Album",
        artwork_url: "/art/duplicate.jpg",
      },
      {
        id: "track-2",
        title: "Two",
        artist: "EXAMPLE ARTIST",
        album: "Second Album",
        artwork_url: "/art/two.jpg",
      },
    ];

    const artists =
      buildLibraryArtists(
        tracks,
      );

    assert.equal(
      artists.length,
      1,
    );

    assert.equal(
      artists[0].name,
      "Example Artist",
    );

    assert.equal(
      artists[0].track_count,
      2,
    );

    assert.equal(
      artists[0].album_count,
      2,
    );

    assert.equal(
      artists[0].artwork_url,
      "/art/two.jpg",
    );
  },
);


test(
  "albums are scoped by artist and skip tracks without album metadata",
  () => {
    const tracks = [
      {
        id: "track-a",
        title: "A",
        artist: "Artist One",
        album: "Shared Title",
      },
      {
        id: "track-b",
        title: "B",
        artist: "Artist Two",
        album: "Shared Title",
      },
      {
        id: "track-c",
        title: "Single",
        artist: "Artist One",
        album: null,
      },
    ];

    const albums =
      buildLibraryAlbums(
        tracks,
      );

    assert.equal(
      albums.length,
      2,
    );

    assert.deepEqual(
      albums.map(
        (album) =>
          album.artist,
      ),
      [
        "Artist One",
        "Artist Two",
      ],
    );

    assert.equal(
      albums.some(
        (album) =>
          album.title ===
          "Unknown Album",
      ),
      false,
    );
  },
);


test(
  "artist and album collections are sorted without mutating source tracks",
  () => {
    const tracks = [
      {
        id: "z",
        title: "Zed",
        artist: "Zulu",
        album: "Beta",
      },
      {
        id: "a",
        title: "Alpha",
        artist: "Alpha",
        album: "Alpha",
      },
    ];

    const snapshot =
      JSON.stringify(
        tracks,
      );

    const artists =
      buildLibraryArtists(
        tracks,
      );

    const albums =
      buildLibraryAlbums(
        tracks,
      );

    assert.deepEqual(
      artists.map(
        (artist) =>
          artist.name,
      ),
      [
        "Alpha",
        "Zulu",
      ],
    );

    assert.deepEqual(
      albums.map(
        (album) =>
          album.title,
      ),
      [
        "Alpha",
        "Beta",
      ],
    );

    assert.equal(
      JSON.stringify(
        tracks,
      ),
      snapshot,
    );
  },
);
