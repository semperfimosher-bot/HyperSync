import test from "node:test";
import assert from "node:assert/strict";


async function loadLyricsModule() {
  return import(
    "./lyricsSync.js"
  ).catch(() => ({}));
}


test(
  "parseSyncedLyrics parses and sorts LRC timestamps",
  async () => {
    const lyrics =
      await loadLyricsModule();

    assert.equal(
      typeof lyrics.parseSyncedLyrics,
      "function",
    );

    const result =
      lyrics.parseSyncedLyrics(
        [
          "[00:05.50] Second line",
          "[00:01.00] First line",
          "[01:02.345] Third line",
        ].join("\n"),
      );

    assert.deepEqual(
      result,
      [
        {
          timeSeconds: 1,
          text: "First line",
        },
        {
          timeSeconds: 5.5,
          text: "Second line",
        },
        {
          timeSeconds: 62.345,
          text: "Third line",
        },
      ],
    );
  },
);


test(
  "parseSyncedLyrics handles multiple timestamps and offset",
  async () => {
    const lyrics =
      await loadLyricsModule();

    const result =
      lyrics.parseSyncedLyrics(
        [
          "[ar:Test Artist]",
          "[offset:+500]",
          (
            "[00:01.00]" +
            "[00:03.00] Repeated line"
          ),
        ].join("\n"),
      );

    assert.deepEqual(
      result,
      [
        {
          timeSeconds: 1.5,
          text: "Repeated line",
        },
        {
          timeSeconds: 3.5,
          text: "Repeated line",
        },
      ],
    );
  },
);


test(
  "parseSyncedLyrics ignores metadata and blank timed lines",
  async () => {
    const lyrics =
      await loadLyricsModule();

    const result =
      lyrics.parseSyncedLyrics(
        [
          "[ti:Test Track]",
          "[al:Test Album]",
          "[00:01.00]",
          "[00:02.00] Visible line",
        ].join("\n"),
      );

    assert.deepEqual(
      result,
      [
        {
          timeSeconds: 2,
          text: "Visible line",
        },
      ],
    );
  },
);


test(
  "getActiveLyricIndex follows forward and backward seeks",
  async () => {
    const lyrics =
      await loadLyricsModule();

    assert.equal(
      typeof lyrics.getActiveLyricIndex,
      "function",
    );

    const lines = [
      {
        timeSeconds: 1,
        text: "First line",
      },
      {
        timeSeconds: 5,
        text: "Second line",
      },
      {
        timeSeconds: 9,
        text: "Third line",
      },
    ];

    assert.equal(
      lyrics.getActiveLyricIndex(
        lines,
        0.5,
      ),
      -1,
    );

    assert.equal(
      lyrics.getActiveLyricIndex(
        lines,
        1,
      ),
      0,
    );

    assert.equal(
      lyrics.getActiveLyricIndex(
        lines,
        5.2,
      ),
      1,
    );

    assert.equal(
      lyrics.getActiveLyricIndex(
        lines,
        9.5,
      ),
      2,
    );

    // Simulate seeking backward.
    assert.equal(
      lyrics.getActiveLyricIndex(
        lines,
        1.5,
      ),
      0,
    );
  },
);



test(
  "controller lyrics use the advancing account playback clock",
  async () => {
    const lyrics =
      await loadLyricsModule();

    const state =
      lyrics.getEffectiveLyricsPlaybackState({
        localState: {
          trackId:
            "old-local-track",
          currentTime:
            12,
          paused:
            true,
        },
        accountSnapshot: {
          device_id:
            "phone",
          track: {
            id:
              "remote-track",
            title:
              "Remote Song",
            artist:
              "Remote Artist",
            duration_seconds:
              240,
          },
          position_seconds:
            30,
          paused:
            false,
          updated_at:
            "2026-09-27T03:00:00.000Z",
        },
        currentPlaybackDeviceId:
          "desktop",
        nowMs:
          Date.parse(
            "2026-09-27T03:00:02.500Z",
          ),
      });

    assert.equal(
      state.controllingRemote,
      true,
    );

    assert.equal(
      state.trackId,
      "remote-track",
    );

    assert.equal(
      state.currentTime,
      32.5,
    );

    assert.equal(
      state.paused,
      false,
    );
  },
);


test(
  "paused remote lyrics stay locked to the account position",
  async () => {
    const lyrics =
      await loadLyricsModule();

    const state =
      lyrics.getEffectiveLyricsPlaybackState({
        localState: {
          currentTime:
            80,
        },
        accountSnapshot: {
          device_id:
            "phone",
          track: {
            id:
              "remote-track",
          },
          position_seconds:
            47.25,
          paused:
            true,
          updated_at:
            "2026-09-27T03:00:00.000Z",
        },
        currentPlaybackDeviceId:
          "desktop",
        nowMs:
          Date.parse(
            "2026-09-27T03:01:00.000Z",
          ),
      });

    assert.equal(
      state.currentTime,
      47.25,
    );
  },
);


test(
  "lyrics use local audio clock on the active playback device",
  async () => {
    const lyrics =
      await loadLyricsModule();

    const localState = {
      trackId:
        "same-track",
      currentTime:
        91,
      paused:
        false,
    };

    const state =
      lyrics.getEffectiveLyricsPlaybackState({
        localState,
        accountSnapshot: {
          device_id:
            "desktop",
          track: {
            id:
              "same-track",
          },
          position_seconds:
            40,
          paused:
            false,
          updated_at:
            "2026-09-27T03:00:00.000Z",
        },
        currentPlaybackDeviceId:
          "desktop",
        nowMs:
          Date.parse(
            "2026-09-27T03:00:10.000Z",
          ),
      });

    assert.equal(
      state.controllingRemote,
      false,
    );

    assert.equal(
      state.currentTime,
      91,
    );
  },
);


test(
  "catalog lyrics only accepts permanent track UUIDs",
  async () => {
    const lyrics =
      await loadLyricsModule();

    const trackId =
      "9e061d5c-5ae4-4db9-8bb1-ef55bdd7af33";

    assert.equal(
      lyrics.catalogLyricsTrackId(
        trackId,
      ),
      trackId,
    );

    assert.equal(
      lyrics.catalogLyricsTrackId(
        "ondemand:82df75c9-d816-40a7-9263-c461c3d9b2dd",
      ),
      null,
    );

    assert.equal(
      lyrics.catalogLyricsTrackId(
        "not-a-track-id",
      ),
      null,
    );
  },
);
