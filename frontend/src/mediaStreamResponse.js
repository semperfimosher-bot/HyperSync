import {
  MEDIA_CHUNK_SIZE,
} from "./mediaStore.js";

import {
  getOrFetchMediaChunk,
} from "./mediaChunkSource.js";

export function createMediaRangeStreamResponse({
  trackId,
  mediaVersion,
  byteStart,
  byteEnd,
  fileSize,
  mimeType,
  fetchChunk,
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

  const contentLength =
    byteEnd -
    byteStart +
    1;

  let nextByteStart =
    byteStart;

  const body =
    new ReadableStream(
      {
        async pull(
          controller,
        ) {
          if (
            nextByteStart >
            byteEnd
          ) {
            controller.close();
            return;
          }

          const chunkIndex =
            Math.floor(
              nextByteStart /
                MEDIA_CHUNK_SIZE,
            );

          const chunkByteStart =
            chunkIndex *
            MEDIA_CHUNK_SIZE;

          const chunk =
            await getOrFetchMediaChunk({
              trackId,
              mediaVersion,
              chunkIndex,
              fileSize,
              fetchChunk,
            });

          const sliceByteStart =
            nextByteStart;

          const sliceByteEnd =
            Math.min(
              byteEnd,
              chunkByteStart +
                chunk.byteLength -
                1,
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
            sliceByteEnd + 1;

          if (
            nextByteStart >
            byteEnd
          ) {
            controller.close();
          }
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
