import "fake-indexeddb/auto";

import assert from "node:assert/strict";
import test from "node:test";

async function loadMediaChunkSourceModule() {
  return import(
    `./mediaChunkSource.js?test=${Date.now()}-${Math.random()}`
  );
}

test(
  "missing media chunk is fetched as one bounded range and persisted",
  async () => {
    const mediaStore =
      await import(
        "./mediaStore.js"
      );

    const mediaChunkSource =
      await loadMediaChunkSourceModule();

    assert.equal(
      typeof mediaChunkSource.getOrFetchMediaChunk,
      "function",
    );

    const chunkSize =
      mediaStore.MEDIA_CHUNK_SIZE;

    const trackId =
      "chunk-source-track";

    const mediaVersion =
      "chunk-source-version";

    const fileSize =
      chunkSize * 2;

    await mediaStore.saveMediaRecord(
      mediaStore.createMediaRecord({
        trackId,
        mediaVersion,
        mimeType:
          "audio/mpeg",
        fileSize,
        state:
          "NONE",
      }),
    );

    const networkRanges =
      [];

    const bytes =
      new Uint8Array(
        chunkSize,
      );

    bytes[0] =
      0xaa;

    bytes[
      chunkSize - 1
    ] =
      0xbb;

    const chunk =
      await mediaChunkSource.getOrFetchMediaChunk({
        trackId,
        mediaVersion,
        chunkIndex:
          0,
        fileSize,

        fetchChunk:
          async ({
            byteStart,
            byteEnd,
          }) => {
            networkRanges.push(
              {
                byteStart,
                byteEnd,
              },
            );

            return new Response(
              bytes,
              {
                status:
                  206,
                headers: {
                  "Content-Length":
                    String(
                      bytes.byteLength,
                    ),
                  "Content-Range":
                    `bytes ${byteStart}-${byteEnd}/${fileSize}`,
                  "Content-Type":
                    "audio/mpeg",
                },
              },
            );
          },
      });

    assert.deepEqual(
      networkRanges,
      [
        {
          byteStart:
            0,
          byteEnd:
            chunkSize - 1,
        },
      ],
    );

    assert.equal(
      chunk.byteLength,
      chunkSize,
    );

    assert.equal(
      chunk[0],
      0xaa,
    );

    assert.equal(
      chunk[
        chunkSize - 1
      ],
      0xbb,
    );

    const stored =
      await mediaStore.getMediaChunk(
        trackId,
        mediaVersion,
        0,
      );

    assert.ok(
      stored,
    );

    assert.equal(
      stored.byteLength,
      chunkSize,
    );
  },
);

test(
  "cached media chunk is returned without a network request",
  async () => {
    const mediaStore =
      await import(
        "./mediaStore.js"
      );

    const mediaChunkSource =
      await loadMediaChunkSourceModule();

    const chunkSize =
      mediaStore.MEDIA_CHUNK_SIZE;

    const trackId =
      "cached-source-track";

    const mediaVersion =
      "cached-source-version";

    const fileSize =
      chunkSize * 2;

    await mediaStore.saveMediaRecord(
      mediaStore.createMediaRecord({
        trackId,
        mediaVersion,
        mimeType:
          "audio/mpeg",
        fileSize,
        state:
          "NONE",
      }),
    );

    const storedBytes =
      new Uint8Array(
        chunkSize,
      );

    storedBytes[0] =
      0x11;

    storedBytes[
      chunkSize - 1
    ] =
      0x22;

    await mediaStore.saveMediaChunk({
      trackId,
      mediaVersion,
      chunkIndex:
        0,
      byteStart:
        0,
      data:
        storedBytes.buffer,
    });

    let networkRequestCount =
      0;

    const chunk =
      await mediaChunkSource.getOrFetchMediaChunk({
        trackId,
        mediaVersion,
        chunkIndex:
          0,
        fileSize,

        fetchChunk:
          async () => {
            networkRequestCount +=
              1;

            throw new Error(
              "Network must not be used for a cached media chunk.",
            );
          },
      });

    assert.equal(
      networkRequestCount,
      0,
    );

    assert.equal(
      chunk.byteLength,
      chunkSize,
    );

    assert.equal(
      chunk[0],
      0x11,
    );

    assert.equal(
      chunk[
        chunkSize - 1
      ],
      0x22,
    );
  },
);
