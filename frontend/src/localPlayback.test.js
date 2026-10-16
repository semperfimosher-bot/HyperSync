import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// The app must not register a background path that can interrupt local audio.
test("app shell has no account playback transport or remote control wiring", () => {
  const source = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /playbackDevices|playbackRemoteCommands|playback-state|playback-devices|setRemotePlaybackController/);
});

class TestAudio extends EventTarget {
  paused = true;
  currentTime = 0;
  duration = 120;
  volume = 1;
  muted = false;
  src = "";
  get currentSrc() { return this.src; }
  pause() { this.paused = true; }
  async play() { this.paused = false; }
  load() {}
  removeAttribute(name) { if (name === "src") this.src = ""; }
}

globalThis.Audio = TestAudio;
const player = await import("./audioPlayer.js");

test("player exposes only local control, with no remote injection or Jam callback", () => {
  for (const name of ["setRemotePlaybackController", "setJamTrackEndedController", "restoreAccountPlayback", "restoreAccountPlaybackQueue", "syncAccountPlaybackShadow"]) {
    assert.equal(name in player, false, name);
  }
});

test("seek, volume and pause change the local audio element", () => {
  const audio = player._getAudioElement();
  audio.src = "https://example.invalid/test.mp3";
  audio.paused = false;
  player.seekTo(47);
  player.setVolume(0.35);
  player.pausePlayback();
  assert.equal(audio.currentTime, 47);
  assert.equal(audio.volume, 0.35);
  assert.equal(audio.paused, true);
  player.stopTrack();
});

test("local queue plays, advances on track end, and supports previous and next", async (t) => {
  // Only the autoplay recommendation request needs HTTP. Audio playback and
  // queue transitions below use the real player with a browser Audio stand-in.
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    requests.push(String(url));
    return new Response("[]", { headers: { "Content-Type": "application/json" } });
  });
  const tracks = [
    { id: "first-local-track", title: "First", audioUrl: "https://example.invalid/first.mp3" },
    { id: "second-local-track", title: "Second", audioUrl: "https://example.invalid/second.mp3" },
  ];
  await player.playTrackQueue(tracks);
  assert.equal(player.getState().trackId, tracks[0].id);
  assert.equal(player._getAudioElement().paused, false);
  player._getAudioElement().dispatchEvent(new Event("ended"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(player.getState().trackId, tracks[1].id);
  player.seekTo(0);
  await player.skipToPrevious();
  assert.equal(player.getState().trackId, tracks[0].id);
  await player.skipToNext();
  assert.equal(player.getState().trackId, tracks[1].id);
  assert.equal(player.getState().queue.length, 2);
  assert.equal(requests.some((url) => /playback-devices|playback-state|jams/.test(url)), false);
  player.stopTrack();
});
