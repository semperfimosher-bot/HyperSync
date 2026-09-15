import "fake-indexeddb/auto";

import assert from "node:assert/strict";
import test from "node:test";

async function loadMediaStreamResponseModule() {
  return import(
    `./mediaStreamResponse.js?test=${Date.now()}-${Math.random()}`
  );
}

test(
  "media range stream fetches chunks lazily as the consumer reads",
  async () => {
    const mediaStore =
      await import(
        "./mediaStore.js"
      );

    const mediaStreamResponse =
      await loadMediaStreamResponseModule();

    assert.equal(
      typeof mediaStreamResponse.createMediaRangeStreamResponse,
      "function",
    );

    const chunkSize =
      mediaStore.MEDIA_CHUNK_SIZE;

    const trackId =
      "lazy-stream-track";

    const mediaVersion =
      "lazy-stream-version";

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

    const requestedRanges =
      [];

    const response =
      mediaStreamResponse.createMediaRangeStreamResponse({
        trackId,
        mediaVersion,
        byteStart:
          0,
        byteEnd:
          fileSize - 1,
        fileSize,
        mimeType:
          "audio/mpeg",

        fetchChunk:
          async ({
            byteStart,
            byteEnd,
          }) => {
            requestedRanges.push(
              {
                byteStart,
                byteEnd,
              },
            );

            const bytes =
              new Uint8Array(
                byteEnd -
                  byteStart +
                  1,
              );

            bytes.fill(
              requestedRanges.length,
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

    assert.equal(
      response.status,
      206,
    );

    assert.deepEqual(
      requestedRanges,
      [],
    );

    const reader =
      response.body.getReader();

    const first =
      await reader.read();

    assert.equal(
      first.done,
      false,
    );

    assert.equal(
      first.value.byteLength,
      chunkSize,
    );

    assert.deepEqual(
      requestedRanges,
      [
        {
          byteStart:
            0,
          byteEnd:
            chunkSize - 1,
        },
      ],
    );

    const second =
      await reader.read();

    assert.equal(
      second.done,
      false,
    );

    assert.equal(
      second.value.byteLength,
      chunkSize,
    );

    assert.deepEqual(
      requestedRanges,
      [
        {
          byteStart:
            0,
          byteEnd:
            chunkSize - 1,
        },
        {
          byteStart:
            chunkSize,
          byteEnd:
            fileSize - 1,
        },
      ],
    );

    const finished =
      await reader.read();

    assert.equal(
      finished.done,
      true,
    );
  },
);

test(
  "media range stream mixes cached and network chunks without refetching cached bytes",
  async () => {
    const mediaStore =
      await import(
        "./mediaStore.js"
      );

    const mediaStreamResponse =
      await loadMediaStreamResponseModule();

    const chunkSize =
      mediaStore.MEDIA_CHUNK_SIZE;

    const trackId =
      "mixed-stream-track";

    const mediaVersion =
      "mixed-stream-version";

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

    const cachedBytes =
      new Uint8Array(
        chunkSize,
      );

    cachedBytes.fill(
      0x11,
    );

    await mediaStore.saveMediaChunk({
      trackId,
      mediaVersion,
      chunkIndex:
        0,
      byteStart:
        0,
      data:
        cachedBytes.buffer,
    });

    const requestedRanges =
      [];

    const response =
      mediaStreamResponse.createMediaRangeStreamResponse({
        trackId,
        mediaVersion,
        byteStart:
          0,
        byteEnd:
          fileSize - 1,
        fileSize,
        mimeType:
          "audio/mpeg",

        fetchChunk:
          async ({
            byteStart,
            byteEnd,
          }) => {
            requestedRanges.push(
              {
                byteStart,
                byteEnd,
              },
            );

            const bytes =
              new Uint8Array(
                byteEnd -
                  byteStart +
                  1,
              );

            bytes.fill(
              0x22,
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

    const reader =
      response.body.getReader();

    const first =
      await reader.read();

    assert.equal(
      first.done,
      false,
    );

    assert.equal(
      first.value.byteLength,
      chunkSize,
    );

    assert.equal(
      first.value[0],
      0x11,
    );

    assert.deepEqual(
      requestedRanges,
      [],
    );

    const second =
      await reader.read();

    assert.equal(
      second.done,
      false,
    );

    assert.equal(
      second.value.byteLength,
      chunkSize,
    );

    assert.equal(
      second.value[0],
      0x22,
    );

    assert.deepEqual(
      requestedRanges,
      [
        {
          byteStart:
            chunkSize,
          byteEnd:
            fileSize - 1,
        },
      ],
    );

    const storedSecondChunk =
      await mediaStore.getMediaChunk(
        trackId,
        mediaVersion,
        1,
      );

    assert.ok(
      storedSecondChunk,
    );

    assert.equal(
      storedSecondChunk.byteLength,
      chunkSize,
    );

    const finished =
      await reader.read();

    assert.equal(
      finished.done,
      true,
    );
  },
);

test(
  "cold media stream forwards network bytes before the full cache chunk finishes downloading",
  async () => {
    const mediaStore =
      await import(
        "./mediaStore.js"
      );

    const mediaStreamResponse =
      await loadMediaStreamResponseModule();

    const chunkSize =
      mediaStore.MEDIA_CHUNK_SIZE;

    const prefixSize =
      4 * 1024;

    const trackId =
      "progressive-cold-track";

    const mediaVersion =
      "progressive-cold-version";

    const fileSize =
      chunkSize;

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

    let releaseRemainder;

    const remainderGate =
      new Promise(
        (resolve) => {
          releaseRemainder =
            resolve;
        },
      );

    let markPrefixRead;

    const prefixRead =
      new Promise(
        (resolve) => {
          markPrefixRead =
            resolve;
        },
      );

    let networkPullCount =
      0;

    const response =
      mediaStreamResponse.createMediaRangeStreamResponse({
        trackId,
        mediaVersion,
        byteStart:
          0,
        byteEnd:
          fileSize - 1,
        fileSize,
        mimeType:
          "audio/mpeg",

        fetchChunk:
          async ({
            byteStart,
            byteEnd,
          }) => {
            assert.equal(
              byteStart,
              0,
            );

            assert.equal(
              byteEnd,
              chunkSize - 1,
            );

            const body =
              new ReadableStream({
                async pull(
                  controller,
                ) {
                  networkPullCount +=
                    1;

                  if (
                    networkPullCount ===
                    1
                  ) {
                    const prefix =
                      new Uint8Array(
                        prefixSize,
                      );

                    prefix.fill(
                      0x11,
                    );

                    controller.enqueue(
                      prefix,
                    );

                    markPrefixRead();

                    return;
                  }

                  await remainderGate;

                  const remainder =
                    new Uint8Array(
                      chunkSize -
                        prefixSize,
                    );

                  remainder.fill(
                    0x22,
                  );

                  controller.enqueue(
                    remainder,
                  );

                  controller.close();
                },
              });

            return new Response(
              body,
              {
                status:
                  206,

                headers: {
                  "Content-Length":
                    String(
                      chunkSize,
                    ),

                  "Content-Range":
                    `bytes 0-${
                      chunkSize - 1
                    }/${fileSize}`,

                  "Content-Type":
                    "audio/mpeg",
                },
              },
            );
          },
      });

    const reader =
      response.body.getReader();

    let firstReadSettled =
      false;

    const firstReadPromise =
      reader.read().then(
        (result) => {
          firstReadSettled =
            true;

          return result;
        },
      );

    await prefixRead;

    await new Promise(
      (resolve) => {
        setTimeout(
          resolve,
          0,
        );
      },
    );

    const settledBeforeRemainder =
      firstReadSettled;

    releaseRemainder();

    const first =
      await firstReadPromise;

    let streamedBytes =
      first.done
        ? 0
        : first.value.byteLength;

    while (true) {
      const next =
        await reader.read();

      if (next.done) {
        break;
      }

      streamedBytes +=
        next.value.byteLength;
    }

    assert.equal(
      settledBeforeRemainder,
      true,
      "audio should receive the first network bytes before the rest of the 256 KiB chunk arrives",
    );

    assert.equal(
      first.done,
      false,
    );

    assert.equal(
      first.value.byteLength,
      prefixSize,
    );

    assert.equal(
      first.value[0],
      0x11,
    );

    assert.equal(
      streamedBytes,
      chunkSize,
    );

    const cachedChunk =
      await mediaStore.getMediaChunk(
        trackId,
        mediaVersion,
        0,
      );

    assert.ok(
      cachedChunk,
    );

    assert.equal(
      cachedChunk.byteLength,
      chunkSize,
    );
  },
);
