import assert from "node:assert/strict";
import test from "node:test";

import {
  isSameRightRailPlayerState,
  selectRightRailPlayerState,
} from "./rightRailPlayerState.js";


test(
  "right rail ignores playback clock-only updates",
  () => {
    const queue = [
      {
        id: "track-1",
      },
    ];

    const first =
      selectRightRailPlayerState({
        src: "audio",
        artworkUrl: "art",
        title: "Song",
        artist: "Artist",
        queue,
        queueIndex: 0,
        currentTime: 4,
        duration: 200,
        paused: false,
      });

    const second =
      selectRightRailPlayerState({
        src: "audio",
        artworkUrl: "art",
        title: "Song",
        artist: "Artist",
        queue,
        queueIndex: 0,
        currentTime: 19,
        duration: 200,
        paused: false,
      });

    assert.equal(
      isSameRightRailPlayerState(
        first,
        second,
      ),
      true,
    );
  },
);


test(
  "right rail updates when the visible queue changes",
  () => {
    const first =
      selectRightRailPlayerState({
        queue: [],
        queueIndex: 0,
      });

    const second =
      selectRightRailPlayerState({
        queue: [
          {
            id: "track-2",
          },
        ],
        queueIndex: 0,
      });

    assert.equal(
      isSameRightRailPlayerState(
        first,
        second,
      ),
      false,
    );
  },
);


test(
  "right rail updates when album metadata changes",
  () => {
    const queue = [];

    const first =
      selectRightRailPlayerState({
        src: "audio",
        title: "Song",
        artist: "Artist",
        album: "Album One",
        queue,
        queueIndex: 0,
      });

    const second =
      selectRightRailPlayerState({
        src: "audio",
        title: "Song",
        artist: "Artist",
        album: "Album Two",
        queue,
        queueIndex: 0,
      });

    assert.equal(
      isSameRightRailPlayerState(
        first,
        second,
      ),
      false,
    );
  },
);
