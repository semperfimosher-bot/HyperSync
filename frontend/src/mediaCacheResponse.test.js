import "fake-indexeddb/auto";

import assert from "node:assert/strict";
import test from "node:test";

async function loadMediaCacheResponseModule() {
  return import(
    `./mediaCacheResponse.js?test=${Date.now()}-${Math.random()}`
  );
}

test(
  "cached media request turns an HTTP Range header into a partial-content response",
  async () => {
    const mediaStore =
      await import(
        "./mediaStore.js"
      );

    const mediaCacheResponse =
      await loadMediaCacheResponseModule();

    assert.equal(
      typeof mediaCacheResponse.createCachedMediaRangeResponse,
      "function",
    );

    const trackId =
      "pipeline-track";

    const mediaVersion =
      "pipeline-version";

    const bytes =
      new Uint8Array([
        0xaa,
        0xbb,
        0xcc,
        0xdd,
        0xee,
        0xff,
        0x11,
        0x22,
      ]);

    const record =
      mediaStore.createMediaRecord({
        trackId,
        mediaVersion,
        mimeType:
          "audio/mpeg",
        fileSize:
          bytes.byteLength,
        state:
          "NONE",
      });

    await mediaStore.saveMediaRecord(
      record,
    );

    await mediaStore.saveMediaChunk({
      trackId,
      mediaVersion,
      chunkIndex:
        0,
      byteStart:
        0,
      data:
        bytes.buffer,
    });

    const response =
      await mediaCacheResponse.createCachedMediaRangeResponse({
        rangeHeader:
          "bytes=2-5",
        trackId,
        mediaVersion,
        fileSize:
          bytes.byteLength,
        mimeType:
          "audio/mpeg",
      });

    assert.ok(
      response instanceof Response,
    );

    assert.equal(
      response.status,
      206,
    );

    assert.equal(
      response.headers.get(
        "Content-Range",
      ),
      "bytes 2-5/8",
    );

    assert.equal(
      response.headers.get(
        "Content-Length",
      ),
      "4",
    );

    assert.deepEqual(
      Array.from(
        new Uint8Array(
          await response.arrayBuffer(),
        ),
      ),
      [
        0xcc,
        0xdd,
        0xee,
        0xff,
      ],
    );
  },
);

test(
  "cached media request returns null when required bytes are missing",
  async () => {
    const mediaStore =
      await import(
        "./mediaStore.js"
      );

    const mediaCacheResponse =
      await loadMediaCacheResponseModule();

    const trackId =
      "cache-miss-track";

    const mediaVersion =
      "cache-miss-version";

    const record =
      mediaStore.createMediaRecord({
        trackId,
        mediaVersion,
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

    const response =
      await mediaCacheResponse.createCachedMediaRangeResponse({
        rangeHeader:
          "bytes=0-3",
        trackId,
        mediaVersion,
        fileSize:
          8,
        mimeType:
          "audio/mpeg",
      });

    assert.equal(
      response,
      null,
    );
  },
);
