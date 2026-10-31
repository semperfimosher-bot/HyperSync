import assert from "node:assert/strict";
import test from "node:test";

test(
  "a reopened player never restores playback from browser-local storage",
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
        return name === "src" ? this.src : null;
      }

      removeAttribute(name) {
        if (name === "src") this.src = "";
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

    const obsoleteLocalState = {
      trackId: "stale-local-track",
      meta: {
        audioUrl: "https://media.example.test/stale-local.mp3",
        title: "Stale Local Song",
        artist: "Old Local Artist",
        durationSeconds: 120,
      },
      currentTime: 47.25,
      volume: 0.42,
      muted: true,
    };

    globalThis.Audio = RestoreTestAudio;
    globalThis.window = {
      localStorage: {
        getItem(key) {
          return key === "hypersync_player_state_v1"
            ? JSON.stringify(obsoleteLocalState)
            : null;
        },
        setItem() {},
        removeItem() {},
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
        `./audioPlayer.js?local-restore-guard=${Date.now()}-${Math.random()}`
      );

      const state = player.getState();

      assert.equal(state.trackId, null);
      assert.equal(state.title, "");
      assert.equal(state.artist, "");
      assert.equal(state.currentTime, 0);
      assert.equal(state.paused, true);
      assert.equal(player._getAudioElement().currentSrc, "");
      assert.equal(playCalls, 0);
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
