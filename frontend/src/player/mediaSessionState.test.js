import assert from "node:assert/strict";
import { test } from "node:test";

import { mediaSessionIdentity, mediaSessionPlaybackState } from "./mediaSessionState.js";

test("direct URL playback keeps lock screen controls active without a catalog ID", () => {
  const state = { trackId: null, src: "https://example.test/song.mp3", paused: false };
  assert.equal(mediaSessionIdentity(state, state.src), state.src);
  assert.equal(mediaSessionPlaybackState(state, state.src), "playing");
  assert.equal(mediaSessionPlaybackState({ ...state, paused: true }, state.src), "paused");
});

test("a stopped player clears lock screen playback", () => {
  const state = { trackId: null, src: null, paused: true };
  assert.equal(mediaSessionIdentity(state, false), null);
  assert.equal(mediaSessionPlaybackState(state, false), "none");
});

test("the newly assigned URL wins while currentSrc still names the old song", () => {
  assert.equal(
    mediaSessionIdentity({ trackId: null, src: "https://example.test/old.mp3" }, "https://example.test/new.mp3"),
    "https://example.test/new.mp3",
  );
});
