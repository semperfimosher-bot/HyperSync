import test from "node:test";
import assert from "node:assert/strict";

import {
  buildLibraryAlbums,
  buildLibraryArtists,
  mergeLibraryTracks,
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

test(
  "offline-only tracks merge into the library index without duplicating server tracks",
  () => {
    const primaryTracks = [
      {
        id: "shared-track",
        title: "Server Title",
        artist: "Primary Artist",
        album: "Primary Album",
        audio_url: "/server-audio",
      },
    ];

    const offlineTracks = [
      {
        id: "shared-track",
        title: "Cached Title",
        artist: "Cached Artist",
        album: "Cached Album",
        downloaded: true,
      },
      {
        id: "offline-only",
        title: "Legacy Download",
        artist: "Offline Artist",
        album: "Offline Album",
        downloaded: true,
      },
    ];

    const merged =
      mergeLibraryTracks(
        primaryTracks,
        offlineTracks,
      );

    assert.equal(
      merged.length,
      2,
    );

    assert.equal(
      merged[0].title,
      "Server Title",
    );

    assert.equal(
      merged.some(
        (track) =>
          track.id ===
          "offline-only",
      ),
      true,
    );

    const artists =
      buildLibraryArtists(
        merged,
      );

    const albums =
      buildLibraryAlbums(
        merged,
      );

    assert.equal(
      artists.some(
        (artist) =>
          artist.name ===
          "Offline Artist",
      ),
      true,
    );

    assert.equal(
      albums.some(
        (album) =>
          album.title ===
          "Offline Album",
      ),
      true,
    );
  },
);

test(
  "artist and album tabs stay alphabetized across mixed case and numeric names",
  () => {
    const tracks = [
      {
        id: "1",
        title: "Track",
        artist: "zebra",
        album: "Volume 10",
      },
      {
        id: "2",
        title: "Track",
        artist: "Alpha",
        album: "volume 2",
      },
      {
        id: "3",
        title: "Track",
        artist: "beta",
        album: "Alpha",
      },
      {
        id: "4",
        title: "Track",
        artist: "ALPHA 2",
        album: "alpha 10",
      },
    ];

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
        "ALPHA 2",
        "beta",
        "zebra",
      ],
    );

    assert.deepEqual(
      albums.map(
        (album) =>
          album.title,
      ),
      [
        "Alpha",
        "alpha 10",
        "volume 2",
        "Volume 10",
      ],
    );
  },
);

