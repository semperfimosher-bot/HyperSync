import assert from "node:assert/strict";
import test from "node:test";

test(
  "a reopened player restores the last song and position without auto-playing",
  async (t) => {
    const originalAudioDescriptor =
      Object.getOwnPropertyDescriptor(
        globalThis,
        "Audio",
      );
    const originalWindowDescriptor =
      Object.getOwnPropertyDescriptor(
        globalThis,
        "window",
      );

    let playCalls = 0;

    class RestoreTestAudio extends EventTarget {
      paused = true;
      currentTime = 0;
      duration = 120;
      volume = 1;
      muted = false;
      readyState = 1;
      src = "";
      preload = "";
      crossOrigin = "";

      get currentSrc() {
        return this.src;
      }

      getAttribute(name) {
        return name === "src"
          ? this.src
          : null;
      }

      removeAttribute(name) {
        if (name === "src") {
          this.src = "";
        }
      }

      load() {}

      pause() {
        this.paused = true;
      }

      async play() {
        playCalls += 1;
        this.paused = false;
      }
    }

    const savedState = {
      trackId: "restored-local-track",
      meta: {
        audioUrl: "https://media.example.test/restored.mp3",
        title: "Restored Song",
        artist: "Local Artist",
        album: "Reopen Album",
        durationSeconds: 120,
        mimeType: "audio/mpeg",
        fileSize: null,
        mediaVersion: null,
        artworkUrl: null,
      },
      currentTime: 47.25,
      volume: 0.42,
      muted: true,
      recentTrackIds: ["previous-local-track"],
    };

    const values = new Map([
      [
        "hypersync_player_state_v1",
        JSON.stringify(savedState),
      ],
    ]);

    globalThis.Audio = RestoreTestAudio;
    globalThis.window = {
      localStorage: {
        getItem(key) {
          return values.get(key) ?? null;
        },
        setItem(key, value) {
          values.set(key, String(value));
        },
        removeItem(key) {
          values.delete(key);
        },
      },
      location: {
        origin: "https://app.example.test",
      },
    };

    t.mock.method(
      globalThis,
      "fetch",
      async () =>
        new Response(
          "[]",
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        ),
    );

    let player = null;

    try {
      player = await import(
        `./audioPlayer.js?restore-test=${Date.now()}-${Math.random()}`
      );

      for (
        let attempt = 0;
        attempt < 20 &&
          player.getState().currentTime !== savedState.currentTime;
        attempt += 1
      ) {
        await new Promise((resolve) => setImmediate(resolve));
      }

      const state = player.getState();

      assert.equal(state.trackId, savedState.trackId);
      assert.equal(state.title, "Restored Song");
      assert.equal(state.artist, "Local Artist");
      assert.equal(state.currentTime, savedState.currentTime);
      assert.equal(state.volume, savedState.volume);
      assert.equal(state.muted, true);
      assert.equal(state.paused, true);
      assert.equal(player._getAudioElement().playCalls, undefined);
      assert.equal(playCalls, 0);
      assert.equal(
        player._getAudioElement().currentSrc,
        savedState.meta.audioUrl,
      );
    } finally {
      player?.stopTrack();

      if (originalAudioDescriptor) {
        Object.defineProperty(
          globalThis,
          "Audio",
          originalAudioDescriptor,
        );
      } else {
        delete globalThis.Audio;
      }

      if (originalWindowDescriptor) {
        Object.defineProperty(
          globalThis,
          "window",
          originalWindowDescriptor,
        );
      } else {
        delete globalThis.window;
      }
    }
  },
);
