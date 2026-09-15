import "fake-indexeddb/auto";

import assert from "node:assert/strict";
import test from "node:test";

async function loadMediaPlaybackModule() {
  return import(
    `./mediaPlayback.js?test=${Date.now()}-${Math.random()}`
  );
}

test(
  "stable playback seeds media metadata before returning the stable media route",
  async () => {
    const mediaStore =
      await import(
        "./mediaStore.js"
      );

    const mediaPlayback =
      await loadMediaPlaybackModule();

    assert.equal(
      typeof mediaPlayback.prepareTrackAudioSource,
      "function",
    );

    const trackId =
      "prepared-track";

    const mediaVersion =
      "prepared-version";

    const source =
      await mediaPlayback.prepareTrackAudioSource(
        trackId,
        {
          audioUrl:
            "https://signed.example/audio?token=changing",
          mediaVersion,
          mimeType:
            "audio/mpeg",
          fileSize:
            1_000_000,
        },
        {
          useStableMediaRoute:
            true,
        },
      );

    assert.equal(
      source,
      "/__hypersync/media/prepared-track/prepared-version",
    );

    const record =
      await mediaStore.getMediaRecord(
        trackId,
        mediaVersion,
      );

    assert.ok(
      record,
    );

    assert.equal(
      record.trackId,
      trackId,
    );

    assert.equal(
      record.mediaVersion,
      mediaVersion,
    );

    assert.equal(
      record.mimeType,
      "audio/mpeg",
    );

    assert.equal(
      record.fileSize,
      1_000_000,
    );

    assert.equal(
      record.state,
      "NONE",
    );
  },
);

test(
  "recording actual playback refreshes the media expiry",
  async () => {
    const mediaStore =
      await import(
        "./mediaStore.js"
      );

    const mediaPlayback =
      await loadMediaPlaybackModule();

    assert.equal(
      typeof mediaPlayback.recordTrackPlayback,
      "function",
    );

    const trackId =
      "played-track";

    const mediaVersion =
      "played-version";

    await mediaStore.saveMediaRecord(
      mediaStore.createMediaRecord({
        trackId,
        mediaVersion,
        mimeType:
          "audio/mpeg",
        fileSize:
          1_000_000,
        state:
          "PARTIAL",
      }),
    );

    const playedAt =
      1_800_000_000_000;

    const updated =
      await mediaPlayback.recordTrackPlayback(
        trackId,
        {
          mediaVersion,
        },
        playedAt,
      );

    assert.ok(
      updated,
    );

    assert.equal(
      updated.lastPlayedAt,
      playedAt,
    );

    assert.equal(
      updated.expiresAt,
      playedAt +
        mediaStore.MEDIA_EXPIRY_MS,
    );

    const persisted =
      await mediaStore.getMediaRecord(
        trackId,
        mediaVersion,
      );

    assert.equal(
      persisted.lastPlayedAt,
      playedAt,
    );

    assert.equal(
      persisted.expiresAt,
      updated.expiresAt,
    );
  },
);
