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