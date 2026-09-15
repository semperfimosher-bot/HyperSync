import "fake-indexeddb/auto";

import assert from "node:assert/strict";
import test from "node:test";

async function loadMediaNetworkCacheModule() {
  return import(
    `./mediaNetworkCache.js?test=${Date.now()}-${Math.random()}`
  );
}

test(
  "network media response is split into persistent cache chunks",
  async () => {
    const mediaStore =
      await import(
        "./mediaStore.js"
      );

    const mediaNetworkCache =
      await loadMediaNetworkCacheModule();

    assert.equal(
      typeof mediaNetworkCache.cacheNetworkMediaResponse,
      "function",
    );

    const chunkSize =
      mediaStore.MEDIA_CHUNK_SIZE;

    const trackId =
      "network-cache-track";

    const mediaVersion =
      "network-cache-version";

    const bytes =
      new Uint8Array(
        chunkSize + 4,
      );

    bytes[0] =
      0xaa;

    bytes[
      chunkSize - 1
    ] =
      0xbb;

    bytes[
      chunkSize
    ] =
      0xcc;

    bytes[
      chunkSize + 1
    ] =
      0xdd;

    bytes[
      chunkSize + 2
    ] =
      0xee;

    bytes[
      chunkSize + 3
    ] =
      0xff;

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

    const response =
      new Response(
        bytes,
        {
          status:
            206,
          headers: {
            "Content-Type":
              "audio/mpeg",
            "Content-Length":
              String(
                bytes.byteLength,
              ),
            "Content-Range":
              `bytes 0-${bytes.byteLength - 1}/${bytes.byteLength}`,
          },
        },
      );

    const cachedBytes =
      await mediaNetworkCache.cacheNetworkMediaResponse({
        response,
        trackId,
        mediaVersion,
        byteStart:
          0,
        byteEnd:
          bytes.byteLength - 1,
        fileSize:
          bytes.byteLength,
      });

    assert.equal(
      cachedBytes,
      bytes.byteLength,
    );

    const firstChunk =
      await mediaStore.getMediaChunk(
        trackId,
        mediaVersion,
        0,
      );

    const finalChunk =
      await mediaStore.getMediaChunk(
        trackId,
        mediaVersion,
        1,
      );

    assert.ok(
      firstChunk,
    );

    assert.ok(
      finalChunk,
    );

    assert.equal(
      firstChunk.byteLength,
      chunkSize,
    );

    assert.equal(
      finalChunk.byteLength,
      4,
    );

    const firstChunkBytes =
      new Uint8Array(
        firstChunk.data,
      );

    assert.equal(
      firstChunkBytes[0],
      0xaa,
    );

    assert.equal(
      firstChunkBytes[
        chunkSize - 1
      ],
      0xbb,
    );

    assert.deepEqual(
      Array.from(
        new Uint8Array(
          finalChunk.data,
        ),
      ),
      [
        0xcc,
        0xdd,
        0xee,
        0xff,
      ],
    );

    const updatedRecord =
      await mediaStore.getMediaRecord(
        trackId,
        mediaVersion,
      );

    assert.equal(
      updatedRecord.cachedBytes,
      bytes.byteLength,
    );

    assert.equal(
      updatedRecord.state,
      "COMPLETE",
    );
  },
);
