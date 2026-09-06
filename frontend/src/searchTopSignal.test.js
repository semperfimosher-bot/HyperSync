import assert from
  "node:assert/strict";

import test from
  "node:test";

import {
  pickTopSignal,
} from "./searchTopSignal.js";


function results(
  overrides = {},
) {
  return {
    query: "",
    interpreted_query: "",
    intent: "general",

    tracks: [],
    artists: [],
    collaborations: [],
    albums: [],
    people: [],

    ...overrides,
  };
}


test(
  "exact artist beats track matched through that artist",
  () => {
    const top =
      pickTopSignal(
        results({
          query:
            "post malone",

          interpreted_query:
            "post malone",

          tracks: [
            {
              title:
                "Circles",

              artist:
                "Post Malone",

              album:
                "Hollywood's Bleeding",

              /*
               * Even if the track
               * was an exact backend
               * artist-field match,
               * Circles itself is not
               * the exact query.
               */
              match_label:
                "EXACT MATCH",
            },
          ],

          artists: [
            {
              name:
                "Post Malone",

              track_count: 10,

              match_label:
                "EXACT MATCH",
            },
          ],
        }),
      );

    assert.equal(
      top?.type,
      "artist",
    );

    assert.equal(
      top?.title,
      "Post Malone",
    );
  },
);


test(
  "exact track title becomes top signal",
  () => {
    const top =
      pickTopSignal(
        results({
          query: "circles",

          interpreted_query:
            "circles",

          tracks: [
            {
              title:
                "Circles",

              artist:
                "Post Malone",

              album:
                "Hollywood's Bleeding",

              match_label:
                "EXACT MATCH",
            },
          ],

          artists: [
            {
              name:
                "Post Malone",

              track_count: 10,

              match_label:
                "MATCH",
            },
          ],
        }),
      );

    assert.equal(
      top?.type,
      "track",
    );

    assert.equal(
      top?.title,
      "Circles",
    );
  },
);


test(
  "exact album title becomes top signal",
  () => {
    const top =
      pickTopSignal(
        results({
          query:
            "hollywood's bleeding",

          interpreted_query:
            "hollywood's bleeding",

          albums: [
            {
              title:
                "Hollywood's Bleeding",

              artist:
                "Post Malone",

              track_count: 17,

              match_label:
                "EXACT MATCH",
            },
          ],

          tracks: [
            {
              title:
                "Circles",

              artist:
                "Post Malone",

              album:
                "Hollywood's Bleeding",

              match_label:
                "EXACT MATCH",
            },
          ],
        }),
      );

    assert.equal(
      top?.type,
      "album",
    );

    assert.equal(
      top?.title,
      "Hollywood's Bleeding",
    );
  },
);


test(
  "explicit people search allows person to become top signal",
  () => {
    const top =
      pickTopSignal(
        results({
          query:
            "@shane",

          interpreted_query:
            "shane",

          intent:
            "people",

          people: [
            {
              username:
                "shane",

              display_name:
                "Shane Mosher",

              followers_count:
                12,

              match_label:
                "EXACT MATCH",
            },
          ],
        }),
      );

    assert.equal(
      top?.type,
      "person",
    );

    assert.equal(
      top?.item.username,
      "shane",
    );
  },
);


test(
  "person can win a normal search when it is the best direct match",
  () => {
    const top =
      pickTopSignal(
        results({
          query:
            "alex chen",

          interpreted_query:
            "alex chen",

          tracks: [
            {
              title:
                "Alex",

              artist:
                "Someone Else",

              album: null,

              match_label:
                "MATCH",
            },
          ],

          people: [
            {
              username:
                "alexchen",

              display_name:
                "Alex Chen",

              followers_count:
                4,

              match_label:
                "EXACT MATCH",
            },
          ],
        }),
      );

    assert.equal(
      top?.type,
      "person",
    );
  },
);


test(
  "history search preserves first-track top signal",
  () => {
    const top =
      pickTopSignal(
        results({
          query:
            "my most played",

          interpreted_query:
            "",

          intent:
            "my_most_played",

          tracks: [
            {
              title:
                "First Song",

              artist:
                "Artist",

              album: null,

              match_label:
                "PERSONALIZED",
            },
          ],
        }),
      );

    assert.equal(
      top?.type,
      "track",
    );

    assert.equal(
      top?.trackIndex,
      0,
    );
  },
);
