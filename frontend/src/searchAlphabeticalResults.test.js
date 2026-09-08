import assert from "node:assert/strict";
import {
  existsSync,
} from "node:fs";
import test from "node:test";


const moduleUrl =
  new URL(
    "./searchAlphabetical.js",
    import.meta.url,
  );


test(
  "search results are alphabetized without mutating the original arrays",
  async () => {
    assert.ok(
      existsSync(moduleUrl),
      "Expected searchAlphabetical.js to exist.",
    );

    const {
      alphabetizeSearchResults,
    } = await import(
      "./searchAlphabetical.js"
    );

    const results = {
      tracks: [
        {
          id: "3",
          title: "Zulu",
          artist: "Beta",
        },
        {
          id: "1",
          title: "Alpha",
          artist: "Zulu",
        },
        {
          id: "2",
          title: "Alpha",
          artist: "Beta",
        },
      ],

      artists: [
        { name: "Zulu" },
        { name: "alpha" },
        { name: "Beta" },
      ],

      collaborations: [
        { name: "Zulu & Beta" },
        { name: "Alpha & Beta" },
      ],

      albums: [
        {
          title: "Zulu",
          artist: "Alpha",
        },
        {
          title: "Alpha",
          artist: "Zulu",
        },
        {
          title: "Alpha",
          artist: "Beta",
        },
      ],

      people: [
        {
          display_name: "Zulu",
          username: "zulu",
        },
        {
          display_name: "Alpha",
          username: "zebra",
        },
        {
          display_name: "Alpha",
          username: "apple",
        },
      ],
    };

    const originalTracks =
      [...results.tracks];

    const sorted =
      alphabetizeSearchResults(
        results,
      );

    assert.deepEqual(
      sorted.tracks.map(
        (track) =>
          `${track.title}:${track.artist}`,
      ),
      [
        "Alpha:Beta",
        "Alpha:Zulu",
        "Zulu:Beta",
      ],
    );

    assert.deepEqual(
      sorted.artists.map(
        (artist) => artist.name,
      ),
      [
        "alpha",
        "Beta",
        "Zulu",
      ],
    );

    assert.deepEqual(
      sorted.collaborations.map(
        (item) => item.name,
      ),
      [
        "Alpha & Beta",
        "Zulu & Beta",
      ],
    );

    assert.deepEqual(
      sorted.albums.map(
        (album) =>
          `${album.title}:${album.artist}`,
      ),
      [
        "Alpha:Beta",
        "Alpha:Zulu",
        "Zulu:Alpha",
      ],
    );

    assert.deepEqual(
      sorted.people.map(
        (person) =>
          `${person.display_name}:${person.username}`,
      ),
      [
        "Alpha:apple",
        "Alpha:zebra",
        "Zulu:zulu",
      ],
    );

    assert.deepEqual(
      results.tracks,
      originalTracks,
      "Original results must not be mutated.",
    );
  },
);
