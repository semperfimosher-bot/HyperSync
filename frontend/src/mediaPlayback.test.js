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


test(
  "offline playback can build a blob URL from a fully downloaded track",
  async () => {
    const mediaStore =
      await import(
        "./mediaStore.js"
      );

    const mediaPlayback =
      await loadMediaPlaybackModule();

    const trackId =
      "offline-blob-track";

    const mediaVersion =
      "offline-blob-version";

    const bytes =
      new Uint8Array([
        1,
        2,
        3,
        4,
      ]);

    await mediaStore.saveMediaRecord(
      mediaStore.createMediaRecord({
        trackId,
        mediaVersion,
        mimeType:
          "audio/mpeg",
        fileSize:
          bytes.byteLength,
        state:
          "PINNED",
      }),
    );

    await mediaStore.saveMediaChunk({
      trackId,
      mediaVersion,
      chunkIndex:
        0,
      byteStart:
        0,
      data:
        bytes.buffer.slice(0),
    });

    const originalCreateObjectURL =
      globalThis.URL
        .createObjectURL;

    globalThis.URL.createObjectURL =
      (blob) => {
        assert.equal(
          blob.type,
          "audio/mpeg",
        );

        assert.equal(
          blob.size,
          bytes.byteLength,
        );

        return "blob:hypersync-offline-test";
      };

    try {
      const source =
        await mediaPlayback.prepareTrackAudioSource(
          trackId,
          {
            mediaVersion,
            mimeType:
              "audio/mpeg",
            fileSize:
              bytes.byteLength,
          },
          {
            useStableMediaRoute:
              false,
            preferCachedBlob:
              true,
          },
        );

      assert.equal(
        source,
        "blob:hypersync-offline-test",
      );
    } finally {
      globalThis.URL.createObjectURL =
        originalCreateObjectURL;
    }
  },
);
