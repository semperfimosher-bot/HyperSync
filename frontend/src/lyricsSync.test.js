import test from "node:test";
import assert from "node:assert/strict";
import { catalogLyricsTrackId, getActiveLyricIndex, getEffectiveLyricsPlaybackState, parseSyncedLyrics } from "./lyricsSync.js";

test("parses and sorts LRC timestamps", () => {
  assert.deepEqual(parseSyncedLyrics("[00:05.50] Second\n[00:01.00] First\n[01:02.345] Third"), [
    { timeSeconds: 1, text: "First" },
    { timeSeconds: 5.5, text: "Second" },
    { timeSeconds: 62.345, text: "Third" },
  ]);
});

test("handles multiple timestamps and offsets", () => {
  assert.deepEqual(parseSyncedLyrics("[offset:+500]\n[00:01.00][00:03.00] Repeated"), [
    { timeSeconds: 1.5, text: "Repeated" },
    { timeSeconds: 3.5, text: "Repeated" },
  ]);
});

test("active lyric index follows playback seeks", () => {
  const lines = [{ timeSeconds: 1 }, { timeSeconds: 5 }, { timeSeconds: 9 }];
  assert.equal(getActiveLyricIndex(lines, 0.5), -1);
  assert.equal(getActiveLyricIndex(lines, 1), 0);
  assert.equal(getActiveLyricIndex(lines, 5.2), 1);
  assert.equal(getActiveLyricIndex(lines, 9.5), 2);
  assert.equal(getActiveLyricIndex(lines, 1.5), 0);
});

test("lyrics use local playback state even when a remote snapshot exists", () => {
  const localState = { trackId: "local-track", currentTime: 91, paused: false, title: "Local Song" };
  const state = getEffectiveLyricsPlaybackState({
    localState,
    accountSnapshot: { device_id: "phone", track: { id: "remote-track" }, position_seconds: 40, paused: false },
    currentPlaybackDeviceId: "desktop",
    nowMs: Date.now(),
  });
  assert.equal(state.controllingRemote, false);
  assert.equal(state.trackId, "local-track");
  assert.equal(state.currentTime, 91);
  assert.equal(state.title, "Local Song");
});

test("catalog lyrics only accepts permanent track UUIDs", () => {
  const id = "9e061d5c-5ae4-4db9-8bb1-ef55bdd7af33";
  assert.equal(catalogLyricsTrackId(id), id);
  assert.equal(catalogLyricsTrackId("ondemand:82df75c9-d816-40a7-9263-c461c3d9b2dd"), null);
  assert.equal(catalogLyricsTrackId("not-a-track-id"), null);
});
