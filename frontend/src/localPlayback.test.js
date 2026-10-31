import "fake-indexeddb/auto";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Account checkpoints may restore the last track, but the app must not
// register live device discovery, remote commands, or cross-device control.
test("app shell keeps account checkpoints separate from live remote controls", () => {
  const source = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
  assert.match(source, /bindAccountPlayback/);
  assert.doesNotMatch(source, /playbackDevices|playbackRemoteCommands|playback-devices|setRemotePlaybackController/);
});

test("playback resume is restored and checkpointed through the account database only", () => {
  const audioSource = readFileSync(new URL("./audioPlayer.js", import.meta.url), "utf8");
  const accountSource = readFileSync(new URL("./accountPlayback.js", import.meta.url), "utf8");

  assert.doesNotMatch(audioSource, /playerPersistence|restorePersistedPlayerState|readPersistedPlayerState/);
  assert.match(accountSource, /apiRequest\("\/users\/me\/playback-state"\)/);
  assert.match(accountSource, /restoreTrackPaused\(saved\.track, saved\.position_seconds\)/);
  assert.match(accountSource, /const payload = \{\s*track_id: state\.trackId,\s*position_seconds: position/);
  assert.match(accountSource, /method: "PUT"[\s\S]*?body: JSON\.stringify\(payload\)/);
  assert.match(accountSource, /setInterval\(\(\) => \{\s*save\(false\);\s*\},\s*5_000\)/);
  assert.match(accountSource, /keepalive/);
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

test("automatic offline retention starts only after the audio element emits playing", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    new Response("[]", { headers: { "Content-Type": "application/json" } }),
  );

  const mediaStore = await import("./mediaStore.js");
  const trackId = "retention-event-track";
  const mediaVersion = "retention-event-version";

  await player.playTrack(trackId, {
    title: "Retention event",
    artist: "Test",
    audioUrl: "https://example.invalid/retention-event.mp3",
    mediaVersion,
    mimeType: "audio/mpeg",
    fileSize: 1024,
  });

  const beforePlaying = await mediaStore.getMediaRecord(trackId, mediaVersion);
  assert.equal(beforePlaying, null, "selecting a track must not start retention");

  player._getAudioElement().dispatchEvent(new Event("playing"));

  let played = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    played = await mediaStore.getMediaRecord(trackId, mediaVersion);
    if (played?.lastPlayedAt !== null && played?.lastPlayedAt !== undefined) break;
  }

  assert.ok(Number.isSafeInteger(played?.lastPlayedAt));
  assert.ok(Number.isSafeInteger(played?.expiresAt));
  assert.equal(played.expiresAt, played.lastPlayedAt + mediaStore.MEDIA_EXPIRY_MS);
  player.stopTrack();
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
