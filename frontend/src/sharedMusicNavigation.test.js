import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveSharedMusicLibraryTarget,
  sharedMusicSearchQuery,
} from "./sharedMusicNavigation.js";


const tracks = [
  {
    id:
      "track-1",
    title:
      "Midnight",
    artist:
      "Nova",
    album:
      "Roads",
  },
];


test(
  "shared track resolves to the viewer library by id",
  () => {
    const target =
      resolveSharedMusicLibraryTarget(
        {
          kind:
            "track",
          key:
            "track-1",
          title:
            "Midnight",
        },
        {
          tracks,
        },
      );

    assert.equal(
      target?.kind,
      "track",
    );

    assert.equal(
      target?.track?.id,
      "track-1",
    );
  },
);


test(
  "artist and album resolve from viewer library metadata",
  () => {
    assert.deepEqual(
      resolveSharedMusicLibraryTarget(
        {
          kind:
            "artist",
          key:
            "nova",
          title:
            "Nova",
        },
        {
          tracks,
        },
      ),
      {
        kind:
          "artist",
        key:
          "nova",
        title:
          "Nova",
      },
    );

    assert.deepEqual(
      resolveSharedMusicLibraryTarget(
        {
          kind:
            "album",
          key:
            "roads",
          title:
            "Roads",
          subtitle:
            "Nova",
        },
        {
          tracks,
        },
      ),
      {
        kind:
          "album",
        key:
          "nova::roads",
        title:
          "Roads",
        artist:
          "Nova",
      },
    );
  },
);


test(
  "playlist resolves only when owned or saved",
  () => {
    assert.equal(
      resolveSharedMusicLibraryTarget(
        {
          kind:
            "playlist",
          key:
            "playlist-2",
          title:
            "Mix",
        },
        {
          savedPlaylists: [
            {
              id:
                "playlist-2",
              title:
                "Mix",
            },
          ],
        },
      )?.playlist?.id,
      "playlist-2",
    );
  },
);


test(
  "missing shared music falls back to a useful search query",
  () => {
    assert.equal(
      sharedMusicSearchQuery({
        kind:
          "track",
        title:
          "Midnight",
        subtitle:
          "Nova • Roads",
      }),
      "Midnight",
    );

    assert.equal(
      sharedMusicSearchQuery({
        kind:
          "artist",
        title:
          "Nova",
      }),
      "Nova",
    );
  },
);
