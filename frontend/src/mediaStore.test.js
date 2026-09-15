import test from "node:test";
import assert from "node:assert/strict";

import "fake-indexeddb/auto";

async function loadMediaStoreModule() {
  return import("./mediaStore.js")
    .catch(() => ({}));
}


test(
  "media cache key is stable across changing signed URLs",
  async () => {
    const mediaStore =
      await loadMediaStoreModule();

    assert.equal(
      typeof mediaStore.buildMediaCacheKey,
      "function",
    );

    const firstKey =
      mediaStore.buildMediaCacheKey(
        "track-123",
        "version-abc",
      );

    const secondKey =
      mediaStore.buildMediaCacheKey(
        "track-123",
        "version-abc",
      );

    assert.equal(
      firstKey,
      secondKey,
    );

    assert.equal(
      firstKey,
      "track-123:version-abc",
    );
  },
);


test(
  "different media versions produce different cache keys",
  async () => {
    const mediaStore =
      await loadMediaStoreModule();

    assert.equal(
      mediaStore.buildMediaCacheKey(
        "track-123",
        "version-one",
      ),
      "track-123:version-one",
    );

    assert.equal(
      mediaStore.buildMediaCacheKey(
        "track-123",
        "version-two",
      ),
      "track-123:version-two",
    );

    assert.notEqual(
      mediaStore.buildMediaCacheKey(
        "track-123",
        "version-one",
      ),
      mediaStore.buildMediaCacheKey(
        "track-123",
        "version-two",
      ),
    );
  },
);


test(
  "media cache key requires track id and media version",
  async () => {
    const mediaStore =
      await loadMediaStoreModule();

    assert.equal(
      mediaStore.buildMediaCacheKey(
        null,
        "version-one",
      ),
      null,
    );

    assert.equal(
      mediaStore.buildMediaCacheKey(
        "track-123",
        null,
      ),
      null,
    );

    assert.equal(
      mediaStore.buildMediaCacheKey(
        "",
        "version-one",
      ),
      null,
    );

    assert.equal(
      mediaStore.buildMediaCacheKey(
        "track-123",
        "",
      ),
      null,
    );
  },
);

test(
  "media record keeps stable identity and explicit cache state",
  async () => {
    const mediaStore =
      await loadMediaStoreModule();

    assert.equal(
      typeof mediaStore.createMediaRecord,
      "function",
    );

    const partialRecord =
      mediaStore.createMediaRecord({
        trackId: "track-123",
        mediaVersion:
          "version-abc",
        mimeType: "audio/mpeg",
        fileSize: 5_000_000,
        state: "PARTIAL",
      });

    assert.deepEqual(
      partialRecord,
      {
        key:
          "track-123:version-abc",
        trackId:
          "track-123",
        mediaVersion:
          "version-abc",
        mimeType:
          "audio/mpeg",
        fileSize:
          5_000_000,
        state:
          "PARTIAL",
        cachedBytes:
          0,
        lastPlayedAt:
          null,
        expiresAt:
          null,
      },
    );

    const completeRecord =
      mediaStore.createMediaRecord({
        trackId: "track-123",
        mediaVersion:
          "version-abc",
        mimeType: "audio/mpeg",
        fileSize: 5_000_000,
        state: "COMPLETE",
      });

    assert.equal(
      completeRecord.key,
      partialRecord.key,
    );

    assert.equal(
      completeRecord.state,
      "COMPLETE",
    );
  },
);

test(
  "media record accepts only known cache states",
  async () => {
    const mediaStore =
      await loadMediaStoreModule();

    for (
      const state of [
        "NONE",
        "PARTIAL",
        "COMPLETE",
        "PINNED",
      ]
    ) {
      const record =
        mediaStore.createMediaRecord({
          trackId: "track-123",
          mediaVersion:
            "version-abc",
          state,
        });

      assert.equal(
        record.state,
        state,
      );
    }

    assert.throws(
      () =>
        mediaStore.createMediaRecord({
          trackId: "track-123",
          mediaVersion:
            "version-abc",
          state: "BROKEN",
        }),
      {
        name: "RangeError",
        message:
          "Invalid media cache state: BROKEN",
      },
    );
  },
);

test(
  "media record persists across store reopen",
  async () => {
    const mediaStore =
      await loadMediaStoreModule();

    assert.equal(
      typeof mediaStore.saveMediaRecord,
      "function",
    );

    assert.equal(
      typeof mediaStore.getMediaRecord,
      "function",
    );

    const record =
      mediaStore.createMediaRecord({
        trackId:
          "persistent-track",
        mediaVersion:
          "persistent-version",
        mimeType:
          "audio/mpeg",
        fileSize:
          5_000_000,
        state:
          "PARTIAL",
      });

    await mediaStore.saveMediaRecord(
      record,
    );

    const reopenedStore =
      await import(
        "./mediaStore.js?reopen-test"
      );

    const restored =
      await reopenedStore.getMediaRecord(
        "persistent-track",
        "persistent-version",
      );

    assert.deepEqual(
      restored,
      record,
    );
  },
);

test(
  "audio chunk persists across store reopen",
  async () => {
    const mediaStore =
      await loadMediaStoreModule();

    assert.equal(
      typeof mediaStore.saveMediaChunk,
      "function",
    );

    assert.equal(
      typeof mediaStore.getMediaChunk,
      "function",
    );

    const originalBytes =
      new Uint8Array([
        0x49,
        0x44,
        0x33,
        0x04,
        0x00,
        0x00,
        0x00,
        0x00,
      ]);

    await mediaStore.saveMediaChunk({
      trackId:
        "chunk-track",
      mediaVersion:
        "chunk-version",
      chunkIndex:
        0,
      byteStart:
        0,
      data:
        originalBytes.buffer,
    });

    const reopenedStore =
      await import(
        "./mediaStore.js?chunk-reopen-test"
      );

    const restored =
      await reopenedStore.getMediaChunk(
        "chunk-track",
        "chunk-version",
        0,
      );

    assert.ok(
      restored,
    );

    assert.equal(
      restored.mediaKey,
      "chunk-track:chunk-version",
    );

    assert.equal(
      restored.chunkIndex,
      0,
    );

    assert.equal(
      restored.byteStart,
      0,
    );

    assert.equal(
      restored.byteEnd,
      originalBytes.byteLength - 1,
    );

    assert.equal(
      restored.byteLength,
      originalBytes.byteLength,
    );

    assert.ok(
      restored.data instanceof
        ArrayBuffer,
    );

    assert.deepEqual(
      Array.from(
        new Uint8Array(
          restored.data,
        ),
      ),
      Array.from(
        originalBytes,
      ),
    );
  },
);

test(
  "saved chunks update cached bytes and media state",
  async () => {
    const mediaStore =
      await loadMediaStoreModule();

    const firstChunkSize =
      256 * 1024;

    const finalChunkSize =
      4;

    const fileSize =
      firstChunkSize +
      finalChunkSize;

    const record =
      mediaStore.createMediaRecord({
        trackId:
          "state-track",
        mediaVersion:
          "state-version",
        mimeType:
          "audio/mpeg",
        fileSize,
        state:
          "NONE",
      });

    await mediaStore.saveMediaRecord(
      record,
    );

    await mediaStore.saveMediaChunk({
      trackId:
        "state-track",
      mediaVersion:
        "state-version",
      chunkIndex:
        0,
      byteStart:
        0,
      data:
        new Uint8Array(
          firstChunkSize
        ).buffer,
    });

    const partialRecord =
      await mediaStore.getMediaRecord(
        "state-track",
        "state-version",
      );

    assert.equal(
      partialRecord.cachedBytes,
      firstChunkSize,
    );

    assert.equal(
      partialRecord.state,
      "PARTIAL",
    );

    await mediaStore.saveMediaChunk({
      trackId:
        "state-track",
      mediaVersion:
        "state-version",
      chunkIndex:
        1,
      byteStart:
        firstChunkSize,
      data:
        new Uint8Array(
          finalChunkSize
        ).buffer,
    });

    const completeRecord =
      await mediaStore.getMediaRecord(
        "state-track",
        "state-version",
      );

    assert.equal(
      completeRecord.cachedBytes,
      fileSize,
    );

    assert.equal(
      completeRecord.state,
      "COMPLETE",
    );
  },
);

test(
  "replacing a chunk does not double count cached bytes",
  async () => {
    const mediaStore =
      await loadMediaStoreModule();

    const record =
      mediaStore.createMediaRecord({
        trackId:
          "replace-track",
        mediaVersion:
          "replace-version",
        mimeType:
          "audio/mpeg",
        fileSize:
          10,
        state:
          "NONE",
      });

    await mediaStore.saveMediaRecord(
      record,
    );

    await mediaStore.saveMediaChunk({
      trackId:
        "replace-track",
      mediaVersion:
        "replace-version",
      chunkIndex:
        0,
      byteStart:
        0,
      data:
        new Uint8Array([
          1,
          2,
          3,
          4,
        ]).buffer,
    });

    await mediaStore.saveMediaChunk({
      trackId:
        "replace-track",
      mediaVersion:
        "replace-version",
      chunkIndex:
        0,
      byteStart:
        0,
      data:
        new Uint8Array([
          1,
          2,
          3,
          4,
          5,
          6,
        ]).buffer,
    });

    const updatedRecord =
      await mediaStore.getMediaRecord(
        "replace-track",
        "replace-version",
      );

    assert.equal(
      updatedRecord.cachedBytes,
      6,
    );

    assert.equal(
      updatedRecord.state,
      "PARTIAL",
    );

    const storedChunk =
      await mediaStore.getMediaChunk(
        "replace-track",
        "replace-version",
        0,
      );

    assert.equal(
      storedChunk.byteLength,
      6,
    );
  },
);

test(
  "media chunks must start at their deterministic byte position",
  async () => {
    const mediaStore =
      await loadMediaStoreModule();

    await assert.rejects(
      () =>
        mediaStore.saveMediaChunk({
          trackId:
            "geometry-track",
          mediaVersion:
            "geometry-version",
          chunkIndex:
            1,
          byteStart:
            7,
          data:
            new Uint8Array([
              1,
              2,
              3,
              4,
            ]).buffer,
        }),
      {
        name: "RangeError",
        message:
          "Media chunk byte start does not match chunk index.",
      },
    );
  },
);

test(
  "media chunk cannot exceed the configured chunk size",
  async () => {
    const mediaStore =
      await loadMediaStoreModule();

    const oversizedChunk =
      new Uint8Array(
        256 * 1024 + 1,
      ).buffer;

    await assert.rejects(
      () =>
        mediaStore.saveMediaChunk({
          trackId:
            "oversized-track",
          mediaVersion:
            "oversized-version",
          chunkIndex:
            0,
          byteStart:
            0,
          data:
            oversizedChunk,
        }),
      {
        name: "RangeError",
        message:
          "Media chunk exceeds maximum chunk size.",
      },
    );
  },
);

test(
  "bounded byte range maps to required chunk indexes",
  async () => {
    const mediaStore =
      await loadMediaStoreModule();

    assert.equal(
      typeof mediaStore.getChunkIndexesForRange,
      "function",
    );

    assert.deepEqual(
      mediaStore.getChunkIndexesForRange(
        300_000,
        700_000,
      ),
      [
        1,
        2,
      ],
    );
  },
);

test(
  "range crossing one chunk boundary returns both chunks",
  async () => {
    const mediaStore =
      await loadMediaStoreModule();

    assert.deepEqual(
      mediaStore.getChunkIndexesForRange(
        262_143,
        262_144,
      ),
      [
        0,
        1,
      ],
    );
  },
);

test(
  "byte range cannot end before it starts",
  async () => {
    const mediaStore =
      await loadMediaStoreModule();

    assert.throws(
      () =>
        mediaStore.getChunkIndexesForRange(
          700_000,
          300_000,
        ),
      {
        name: "RangeError",
        message:
          "Media byte range end cannot be before start.",
      },
    );
  },
);

test(
  "normalized byte range cannot contain negative positions",
  async () => {
    const mediaStore =
      await loadMediaStoreModule();

    assert.throws(
      () =>
        mediaStore.getChunkIndexesForRange(
          -1,
          0,
        ),
      {
        name: "RangeError",
        message:
          "Media byte range positions cannot be negative.",
      },
    );
  },
);

test(
  "normalized byte range positions must be integers",
  async () => {
    const mediaStore =
      await loadMediaStoreModule();

    assert.throws(
      () =>
        mediaStore.getChunkIndexesForRange(
          300_000.5,
          700_000,
        ),
      {
        name: "RangeError",
        message:
          "Media byte range positions must be integers.",
      },
    );

    assert.throws(
      () =>
        mediaStore.getChunkIndexesForRange(
          300_000,
          700_000.5,
        ),
      {
        name: "RangeError",
        message:
          "Media byte range positions must be integers.",
      },
    );
  },
);

test(
  "cached media range assembles bytes across chunk boundaries",
  async () => {
    const mediaStore =
      await loadMediaStoreModule();

    assert.equal(
      typeof mediaStore.getCachedMediaRange,
      "function",
    );

    const chunkSize =
      256 * 1024;

    const firstChunk =
      new Uint8Array(
        chunkSize,
      );

    firstChunk[
      chunkSize - 2
    ] = 0xaa;

    firstChunk[
      chunkSize - 1
    ] = 0xbb;

    const secondChunk =
      new Uint8Array([
        0xcc,
        0xdd,
        0xee,
        0xff,
      ]);

    const record =
      mediaStore.createMediaRecord({
        trackId:
          "range-track",
        mediaVersion:
          "range-version",
        mimeType:
          "audio/mpeg",
        fileSize:
          chunkSize +
          secondChunk.byteLength,
        state:
          "NONE",
      });

    await mediaStore.saveMediaRecord(
      record,
    );

    await mediaStore.saveMediaChunk({
      trackId:
        "range-track",
      mediaVersion:
        "range-version",
      chunkIndex:
        0,
      byteStart:
        0,
      data:
        firstChunk.buffer,
    });

    await mediaStore.saveMediaChunk({
      trackId:
        "range-track",
      mediaVersion:
        "range-version",
      chunkIndex:
        1,
      byteStart:
        chunkSize,
      data:
        secondChunk.buffer,
    });

    const data =
      await mediaStore.getCachedMediaRange(
        "range-track",
        "range-version",
        chunkSize - 2,
        chunkSize + 1,
      );

    assert.ok(
      data instanceof ArrayBuffer,
    );

    assert.deepEqual(
      Array.from(
        new Uint8Array(
          data,
        ),
      ),
      [
        0xaa,
        0xbb,
        0xcc,
        0xdd,
      ],
    );
  },
);

test(
  "cached media range returns null when stored bytes do not cover the full request",
  async () => {
    const mediaStore =
      await loadMediaStoreModule();

    const record =
      mediaStore.createMediaRecord({
        trackId:
          "partial-range-track",
        mediaVersion:
          "partial-range-version",
        mimeType:
          "audio/mpeg",
        fileSize:
          8,
        state:
          "NONE",
      });

    await mediaStore.saveMediaRecord(
      record,
    );

    await mediaStore.saveMediaChunk({
      trackId:
        "partial-range-track",
      mediaVersion:
        "partial-range-version",
      chunkIndex:
        0,
      byteStart:
        0,
      data:
        new Uint8Array([
          0xaa,
          0xbb,
          0xcc,
          0xdd,
        ]).buffer,
    });

    const data =
      await mediaStore.getCachedMediaRange(
        "partial-range-track",
        "partial-range-version",
        0,
        5,
      );

    assert.equal(
      data,
      null,
    );
  },
);

test(
  "ensuring a playback media record preserves existing cache progress",
  async () => {
    const mediaStore =
      await loadMediaStoreModule();

    assert.equal(
      typeof mediaStore.ensureMediaRecord,
      "function",
    );

    const existing =
      mediaStore.createMediaRecord({
        trackId:
          "seed-track",
        mediaVersion:
          "seed-version",
        mimeType:
          "audio/mpeg",
        fileSize:
          1_000,
        state:
          "PARTIAL",
      });

    existing.cachedBytes =
      256;

    existing.lastPlayedAt =
      123;

    existing.expiresAt =
      456;

    await mediaStore.saveMediaRecord(
      existing,
    );

    const ensured =
      await mediaStore.ensureMediaRecord({
        trackId:
          "seed-track",
        mediaVersion:
          "seed-version",
        mimeType:
          "audio/ogg",
        fileSize:
          2_000,
      });

    assert.equal(
      ensured.state,
      "PARTIAL",
    );

    assert.equal(
      ensured.cachedBytes,
      256,
    );

    assert.equal(
      ensured.lastPlayedAt,
      123,
    );

    assert.equal(
      ensured.expiresAt,
      456,
    );

    assert.equal(
      ensured.mimeType,
      "audio/ogg",
    );

    assert.equal(
      ensured.fileSize,
      2_000,
    );
  },
);

test(
  "marking media played refreshes its 14-day sliding expiry",
  async () => {
    const mediaStore =
      await loadMediaStoreModule();

    assert.equal(
      typeof mediaStore.markMediaPlayed,
      "function",
    );

    const trackId =
      "ttl-track";

    const mediaVersion =
      "ttl-version";

    const record =
      mediaStore.createMediaRecord({
        trackId,
        mediaVersion,
        mimeType:
          "audio/mpeg",
        fileSize:
          1_000_000,
        state:
          "PARTIAL",
      });

    record.cachedBytes =
      256;

    record.lastPlayedAt =
      100;

    record.expiresAt =
      200;

    await mediaStore.saveMediaRecord(
      record,
    );

    const playedAt =
      1_700_000_000_000;

    const updated =
      await mediaStore.markMediaPlayed(
        trackId,
        mediaVersion,
        playedAt,
      );

    assert.equal(
      updated.state,
      "PARTIAL",
    );

    assert.equal(
      updated.cachedBytes,
      256,
    );

    assert.equal(
      updated.lastPlayedAt,
      playedAt,
    );

    assert.equal(
      updated.expiresAt,
      playedAt +
        14 *
          24 *
          60 *
          60 *
          1000,
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
  "expired media cleanup removes expired records and chunks but preserves fresh and pinned media",
  async () => {
    const mediaStore =
      await loadMediaStoreModule();

    assert.equal(
      typeof mediaStore.cleanupExpiredMedia,
      "function",
    );

    const now =
      1;

    const expired =
      mediaStore.createMediaRecord({
        trackId:
          "expired-track",
        mediaVersion:
          "expired-version",
        mimeType:
          "audio/mpeg",
        fileSize:
          1_000,
        state:
          "NONE",
      });

    expired.lastPlayedAt =
        0;

    expired.expiresAt =
        now;

    const fresh =
      mediaStore.createMediaRecord({
        trackId:
          "fresh-track",
        mediaVersion:
          "fresh-version",
        mimeType:
          "audio/mpeg",
        fileSize:
          1_000,
        state:
          "NONE",
      });

    fresh.lastPlayedAt =
        now;

    fresh.expiresAt =
        now + 1;

    const pinned =
      mediaStore.createMediaRecord({
        trackId:
          "pinned-track",
        mediaVersion:
          "pinned-version",
        mimeType:
          "audio/mpeg",
        fileSize:
          1_000,
        state:
          "PINNED",
      });

    pinned.lastPlayedAt =
        0;

    pinned.expiresAt =
        now;

    await mediaStore.saveMediaRecord(
      expired,
    );

    await mediaStore.saveMediaRecord(
      fresh,
    );

    await mediaStore.saveMediaRecord(
      pinned,
    );

    await mediaStore.saveMediaChunk({
      trackId:
        expired.trackId,
      mediaVersion:
        expired.mediaVersion,
      chunkIndex:
        0,
      byteStart:
        0,
      data:
        new Uint8Array([
          0x11,
        ]).buffer,
    });

    await mediaStore.saveMediaChunk({
      trackId:
        fresh.trackId,
      mediaVersion:
        fresh.mediaVersion,
      chunkIndex:
        0,
      byteStart:
        0,
      data:
        new Uint8Array([
          0x22,
        ]).buffer,
    });

    await mediaStore.saveMediaChunk({
      trackId:
        pinned.trackId,
      mediaVersion:
        pinned.mediaVersion,
      chunkIndex:
        0,
      byteStart:
        0,
      data:
        new Uint8Array([
          0x33,
        ]).buffer,
    });

    const deletedCount =
      await mediaStore.cleanupExpiredMedia(
        now,
      );

    assert.equal(
      deletedCount,
      1,
    );

    assert.equal(
      await mediaStore.getMediaRecord(
        expired.trackId,
        expired.mediaVersion,
      ),
      null,
    );

    assert.equal(
      await mediaStore.getMediaChunk(
        expired.trackId,
        expired.mediaVersion,
        0,
      ),
      null,
    );

    assert.ok(
      await mediaStore.getMediaRecord(
        fresh.trackId,
        fresh.mediaVersion,
      ),
    );

    assert.ok(
      await mediaStore.getMediaChunk(
        fresh.trackId,
        fresh.mediaVersion,
        0,
      ),
    );

    assert.ok(
      await mediaStore.getMediaRecord(
        pinned.trackId,
        pinned.mediaVersion,
      ),
    );

    assert.ok(
      await mediaStore.getMediaChunk(
        pinned.trackId,
        pinned.mediaVersion,
        0,
      ),
    );
  },
);

test(
  "marking media played does not overwrite concurrent chunk progress",
  async () => {
    const mediaStore =
      await loadMediaStoreModule();

    const trackId =
      "concurrent-play-track";

    const mediaVersion =
      "concurrent-play-version";

    await mediaStore.saveMediaRecord(
      mediaStore.createMediaRecord({
        trackId,
        mediaVersion,
        mimeType:
          "audio/mpeg",
        fileSize:
          1_000,
        state:
          "NONE",
      }),
    );

    const playedAt =
      1_800_000_000_000;

    await Promise.all([
      mediaStore.markMediaPlayed(
        trackId,
        mediaVersion,
        playedAt,
      ),

      mediaStore.saveMediaChunk({
        trackId,
        mediaVersion,
        chunkIndex:
          0,
        byteStart:
          0,
        data:
          new Uint8Array([
            0x55,
          ]).buffer,
      }),
    ]);

    const persisted =
      await mediaStore.getMediaRecord(
        trackId,
        mediaVersion,
      );

    assert.equal(
      persisted.cachedBytes,
      1,
    );

    assert.equal(
      persisted.state,
      "PARTIAL",
    );

    assert.equal(
      persisted.lastPlayedAt,
      playedAt,
    );

    assert.equal(
      persisted.expiresAt,
      playedAt +
        mediaStore.MEDIA_EXPIRY_MS,
    );
  },
);
