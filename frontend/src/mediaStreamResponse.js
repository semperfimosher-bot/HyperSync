import {
  getMediaChunk,
  MEDIA_CHUNK_SIZE,
  saveMediaChunk,
} from "./mediaStore.js";


export const MEDIA_NETWORK_WINDOW_SIZE =
  MEDIA_CHUNK_SIZE * 8;


export function createMediaRangeStreamResponse({
  trackId,
  mediaVersion,
  byteStart,
  byteEnd,
  fileSize,
  mimeType,
  fetchChunk,

  /*
   * Keep the historical behavior by
   * default.
   *
   * The Service Worker will explicitly
   * opt cold playback into the larger
   * network window after this layer
   * supports it safely.
   */
  networkWindowSize =
    MEDIA_CHUNK_SIZE,
}) {
  if (
    !Number.isSafeInteger(
      fileSize,
    ) ||
    fileSize <= 0
  ) {
    throw new RangeError(
      "Media file size must be a positive safe integer.",
    );
  }

  if (
    !Number.isSafeInteger(
      byteStart,
    ) ||
    !Number.isSafeInteger(
      byteEnd,
    ) ||
    byteStart < 0 ||
    byteEnd < byteStart ||
    byteEnd >= fileSize
  ) {
    throw new RangeError(
      "Media stream range is invalid.",
    );
  }

  if (
    !Number.isSafeInteger(
      networkWindowSize,
    ) ||
    networkWindowSize <
      MEDIA_CHUNK_SIZE ||
    networkWindowSize %
      MEDIA_CHUNK_SIZE !==
      0
  ) {
    throw new RangeError(
      "Media network window size must be a positive multiple of the media chunk size.",
    );
  }


  const contentLength =
    byteEnd -
    byteStart +
    1;

  let nextByteStart =
    byteStart;

  let activeNetworkWindow =
    null;

  const pendingCacheWrites =
    new Set();


  function scheduleCacheWrite({
    chunkIndex,
    chunkByteStart,
    data,
  }) {
    let writePromise;

    writePromise =
      saveMediaChunk({
        trackId,
        mediaVersion,
        chunkIndex,
        byteStart:
          chunkByteStart,
        data,
      })
        /*
         * Persistent caching must never
         * make playback fail.
         */
        .catch(
          () => null,
        )
        .finally(
          () => {
            pendingCacheWrites.delete(
              writePromise,
            );
          },
        );

    pendingCacheWrites.add(
      writePromise,
    );
  }


  async function finishCacheWrites() {
    if (
      pendingCacheWrites.size ===
      0
    ) {
      return;
    }

    await Promise.all(
      Array.from(
        pendingCacheWrites,
      ),
    );
  }


  function createCacheAccumulator(
    chunkIndex,
  ) {
    const chunkByteStart =
      chunkIndex *
      MEDIA_CHUNK_SIZE;

    const chunkByteEnd =
      Math.min(
        chunkByteStart +
          MEDIA_CHUNK_SIZE -
          1,
        fileSize - 1,
      );

    const expectedByteLength =
      chunkByteEnd -
      chunkByteStart +
      1;

    return {
      chunkIndex,
      chunkByteStart,
      chunkByteEnd,
      expectedByteLength,

      receivedBytes:
        0,

      buffer:
        new Uint8Array(
          expectedByteLength,
        ),
    };
  }


  function cacheNetworkBytes(
    active,
    networkBytes,
  ) {
    let sourceOffset =
      0;

    while (
      sourceOffset <
      networkBytes.byteLength
    ) {
      const accumulator =
        active.cacheAccumulator;

      if (!accumulator) {
        throw new RangeError(
          "Media network window exceeded its cache coverage.",
        );
      }

      const remainingInChunk =
        accumulator.expectedByteLength -
        accumulator.receivedBytes;

      const remainingSource =
        networkBytes.byteLength -
        sourceOffset;

      const copyLength =
        Math.min(
          remainingInChunk,
          remainingSource,
        );

      accumulator.buffer.set(
        networkBytes.subarray(
          sourceOffset,
          sourceOffset +
            copyLength,
        ),
        accumulator.receivedBytes,
      );

      accumulator.receivedBytes +=
        copyLength;

      sourceOffset +=
        copyLength;


      if (
        accumulator.receivedBytes ===
        accumulator.expectedByteLength
      ) {
        scheduleCacheWrite({
          chunkIndex:
            accumulator.chunkIndex,

          chunkByteStart:
            accumulator.chunkByteStart,

          data:
            accumulator.buffer.buffer,
        });


        const nextChunkIndex =
          accumulator.chunkIndex +
          1;

        const nextChunkByteStart =
          nextChunkIndex *
          MEDIA_CHUNK_SIZE;

        if (
          nextChunkByteStart <=
          active.byteEnd
        ) {
          active.cacheAccumulator =
            createCacheAccumulator(
              nextChunkIndex,
            );
        } else {
          active.cacheAccumulator =
            null;
        }
      }
    }
  }


  async function beginNetworkWindow(
    chunkByteStart,
  ) {
    if (
      typeof fetchChunk !==
      "function"
    ) {
      throw new TypeError(
        "Media chunk fetcher is required for a cache miss.",
      );
    }

    const networkByteEnd =
      Math.min(
        chunkByteStart +
          networkWindowSize -
          1,
        fileSize - 1,
      );

    const response =
      await fetchChunk({
        byteStart:
          chunkByteStart,

        byteEnd:
          networkByteEnd,
      });

    if (
      !response ||
      response.status !== 206
    ) {
      throw new Error(
        "Media network request did not return partial content.",
      );
    }

    if (!response.body) {
      throw new Error(
        "Media network response has no readable body.",
      );
    }

    const expectedByteLength =
      networkByteEnd -
      chunkByteStart +
      1;

    activeNetworkWindow = {
      byteStart:
        chunkByteStart,

      byteEnd:
        networkByteEnd,

      expectedByteLength,

      receivedBytes:
        0,

      reader:
        response.body.getReader(),

      networkComplete:
        false,

      pendingBytes:
        null,

      pendingByteStart:
        null,

      cacheAccumulator:
        createCacheAccumulator(
          Math.floor(
            chunkByteStart /
              MEDIA_CHUNK_SIZE,
          ),
        ),
    };
  }


  async function cancelActiveNetworkWindow() {
    if (!activeNetworkWindow) {
      return;
    }

    const reader =
      activeNetworkWindow.reader;

    activeNetworkWindow =
      null;

    try {
      await reader.cancel();
    } catch {
      /*
       * Playback cancellation should
       * never create a second failure.
       */
    }
  }


  function emitPendingNetworkBytes(
    controller,
  ) {
    const active =
      activeNetworkWindow;

    if (
      !active ||
      !active.pendingBytes
    ) {
      return false;
    }

    const pendingBytes =
      active.pendingBytes;

    const pendingByteStart =
      active.pendingByteStart;

    const pendingByteEnd =
      pendingByteStart +
      pendingBytes.byteLength -
      1;


    if (
      nextByteStart >
      pendingByteEnd
    ) {
      active.pendingBytes =
        null;

      active.pendingByteStart =
        null;

      return false;
    }


    const emitByteStart =
      Math.max(
        nextByteStart,
        pendingByteStart,
      );

    /*
     * Even if fetch() gives us a large
     * network body piece, keep each
     * outward enqueue bounded by the
     * current 256 KiB cache boundary.
     *
     * Real network pieces may be much
     * smaller, in which case they flow
     * through immediately.
     */
    const currentChunkIndex =
      Math.floor(
        emitByteStart /
          MEDIA_CHUNK_SIZE,
      );

    const currentChunkByteEnd =
      Math.min(
        (
          currentChunkIndex +
          1
        ) *
          MEDIA_CHUNK_SIZE -
          1,
        fileSize - 1,
      );

    const emitByteEnd =
      Math.min(
        byteEnd,
        pendingByteEnd,
        currentChunkByteEnd,
      );


    if (
      emitByteStart >
      emitByteEnd
    ) {
      return false;
    }


    const emitOffset =
      emitByteStart -
      pendingByteStart;

    const emitLength =
      emitByteEnd -
      emitByteStart +
      1;


    controller.enqueue(
      pendingBytes.subarray(
        emitOffset,
        emitOffset +
          emitLength,
      ),
    );

    nextByteStart =
      emitByteEnd +
      1;


    if (
      emitByteEnd >=
      pendingByteEnd
    ) {
      active.pendingBytes =
        null;

      active.pendingByteStart =
        null;
    }


    return true;
  }


  const body =
    new ReadableStream(
      {
        async pull(
          controller,
        ) {
          while (true) {
            if (
              nextByteStart >
              byteEnd
            ) {
              await cancelActiveNetworkWindow();

              await finishCacheWrites();

              controller.close();

              return;
            }


            /*
             * Drain bytes that have already
             * arrived from the current network
             * window before asking the network
             * for anything else.
             */
            if (
              emitPendingNetworkBytes(
                controller,
              )
            ) {
              if (
                nextByteStart >
                byteEnd
              ) {
                await cancelActiveNetworkWindow();

                await finishCacheWrites();

                controller.close();
              }

              return;
            }


            if (
              activeNetworkWindow &&
              activeNetworkWindow
                .networkComplete
            ) {
              activeNetworkWindow =
                null;

              continue;
            }


            if (
              !activeNetworkWindow
            ) {
              const chunkIndex =
                Math.floor(
                  nextByteStart /
                    MEDIA_CHUNK_SIZE,
                );

              const chunkByteStart =
                chunkIndex *
                MEDIA_CHUNK_SIZE;

              const chunkByteEnd =
                Math.min(
                  chunkByteStart +
                    MEDIA_CHUNK_SIZE -
                    1,
                  fileSize - 1,
                );

              const expectedByteLength =
                chunkByteEnd -
                chunkByteStart +
                1;


              const cached =
                await getMediaChunk(
                  trackId,
                  mediaVersion,
                  chunkIndex,
                );


              if (
                cached &&
                cached.byteStart ===
                  chunkByteStart &&
                cached.byteLength ===
                  expectedByteLength &&
                cached.data instanceof
                  ArrayBuffer
              ) {
                const chunk =
                  new Uint8Array(
                    cached.data,
                  );

                const sliceByteStart =
                  nextByteStart;

                const sliceByteEnd =
                  Math.min(
                    byteEnd,
                    chunkByteEnd,
                  );

                const sliceOffset =
                  sliceByteStart -
                  chunkByteStart;

                const sliceLength =
                  sliceByteEnd -
                  sliceByteStart +
                  1;


                if (
                  sliceLength <= 0
                ) {
                  throw new RangeError(
                    "Media cache chunk does not cover the requested stream position.",
                  );
                }


                controller.enqueue(
                  chunk.subarray(
                    sliceOffset,
                    sliceOffset +
                      sliceLength,
                  ),
                );

                nextByteStart =
                  sliceByteEnd +
                  1;


                if (
                  nextByteStart >
                  byteEnd
                ) {
                  await finishCacheWrites();

                  controller.close();
                }

                return;
              }


              await beginNetworkWindow(
                chunkByteStart,
              );
            }


            const active =
              activeNetworkWindow;

            const {
              done,
              value,
            } =
              await active.reader.read();


            if (done) {
              if (
                active.receivedBytes !==
                active.expectedByteLength
              ) {
                await cancelActiveNetworkWindow();

                throw new RangeError(
                  "Media network response ended before the requested range was complete.",
                );
              }

              active.networkComplete =
                true;

              continue;
            }


            const networkBytes =
              value instanceof
              Uint8Array
                ? value
                : new Uint8Array(
                    value,
                  );


            if (
              networkBytes.byteLength ===
              0
            ) {
              continue;
            }


            const pieceByteStart =
              active.byteStart +
              active.receivedBytes;

            const nextReceivedBytes =
              active.receivedBytes +
              networkBytes.byteLength;


            if (
              nextReceivedBytes >
              active.expectedByteLength
            ) {
              await cancelActiveNetworkWindow();

              throw new RangeError(
                "Media network response exceeded the requested range.",
              );
            }


            /*
             * Split the larger network window
             * back into deterministic 256 KiB
             * persistent cache chunks.
             */
            cacheNetworkBytes(
              active,
              networkBytes,
            );


            active.receivedBytes =
              nextReceivedBytes;

            active.pendingBytes =
              networkBytes;

            active.pendingByteStart =
              pieceByteStart;


            if (
              active.receivedBytes ===
              active.expectedByteLength
            ) {
              active.networkComplete =
                true;

              /*
               * We already received every byte
               * promised by this bounded Range.
               * No need to wait for another
               * reader.read() just to observe
               * the stream closing.
               */
              try {
                await active.reader.cancel();
              } catch {
                // All requested bytes arrived.
              }
            }


            /*
             * Crucially, this happens as soon
             * as a network body piece arrives.
             *
             * We do NOT wait for the complete
             * 2 MiB network window.
             */
            if (
              emitPendingNetworkBytes(
                controller,
              )
            ) {
              if (
                nextByteStart >
                byteEnd
              ) {
                await cancelActiveNetworkWindow();

                await finishCacheWrites();

                controller.close();
              }

              return;
            }
          }
        },


        async cancel() {
          await cancelActiveNetworkWindow();

          await finishCacheWrites();
        },
      },

      {
        highWaterMark:
          0,
      },
    );


  return new Response(
    body,
    {
      status:
        206,

      headers: {
        "Accept-Ranges":
          "bytes",

        "Content-Length":
          String(
            contentLength,
          ),

        "Content-Range":
          `bytes ${byteStart}-${byteEnd}/${fileSize}`,

        "Content-Type":
          mimeType,
      },
    },
  );
}
