import assert from "node:assert/strict";
import test from "node:test";

import {
  orderSearchResultsForDisplay,
} from "./searchAlphabetical.js";


function resultsFor(
  intent,
  overrides = {},
) {
  return {
    intent,
    tracks: [],
    artists: [],
    collaborations: [],
    albums: [],
    people: [],
    ...overrides,
  };
}


test(
  "ranked track commands preserve backend order",
  () => {
    for (const intent of [
      "my_most_played",
      "new_releases",
      "recent",
    ]) {
      const ordered =
        orderSearchResultsForDisplay(
          resultsFor(
            intent,
            {
              tracks: [
                {
                  title: "Zulu",
                  artist: "Artist B",
                },
                {
                  title: "Alpha",
                  artist: "Artist A",
                },
              ],
            },
          ),
        );

      assert.deepEqual(
        ordered.tracks.map(
          (track) => track.title,
        ),
        [
          "Zulu",
          "Alpha",
        ],
      );
    }
  },
);


test(
  "people directory preserves backend username order",
  () => {
    const ordered =
      orderSearchResultsForDisplay(
        resultsFor(
          "people",
          {
            people: [
              {
                username: "alex",
                display_name: "Zulu",
              },
              {
                username: "bravo",
                display_name: "Alpha",
              },
            ],
          },
        ),
      );

    assert.deepEqual(
      ordered.people.map(
        (person) => person.username,
      ),
      [
        "alex",
        "bravo",
      ],
    );
  },
);


test(
  "top entity commands preserve backend ranking",
  () => {
    const artists =
      orderSearchResultsForDisplay(
        resultsFor(
          "top_artists",
          {
            artists: [
              {
                name: "Zulu Artist",
              },
              {
                name: "Alpha Artist",
              },
            ],
          },
        ),
      );

    assert.deepEqual(
      artists.artists.map(
        (artist) => artist.name,
      ),
      [
        "Zulu Artist",
        "Alpha Artist",
      ],
    );

    const albums =
      orderSearchResultsForDisplay(
        resultsFor(
          "top_albums",
          {
            albums: [
              {
                title: "Zulu Album",
                artist: "Artist B",
              },
              {
                title: "Alpha Album",
                artist: "Artist A",
              },
            ],
          },
        ),
      );

    assert.deepEqual(
      albums.albums.map(
        (album) => album.title,
      ),
      [
        "Zulu Album",
        "Alpha Album",
      ],
    );
  },
);
