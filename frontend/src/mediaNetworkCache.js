import {
  MEDIA_CHUNK_SIZE,
  saveMediaChunk,
} from "./mediaStore.js";

function validateNetworkRangeResponse({
  response,
  byteStart,
  byteEnd,
  fileSize,
}) {
  if (
    !Number.isSafeInteger(byteStart) ||
    !Number.isSafeInteger(byteEnd) ||
    !Number.isSafeInteger(fileSize) ||
    byteStart < 0 ||
    byteEnd < byteStart ||
    fileSize <= 0 ||
    byteEnd >= fileSize
  ) {
    throw new RangeError(
      "Network media cache range is outside the known file size.",
    );
  }

  if (response.status !== 206) {
    throw new RangeError(
      "Network media cache response must be HTTP 206 Partial Content.",
    );
  }

  const expectedByteLength =
    byteEnd - byteStart + 1;

  const contentRange =
    response.headers.get("Content-Range");

  const match =
    /^bytes (\d+)-(\d+)\/(\d+)$/.exec(
      contentRange ?? "",
    );

  if (
    !match ||
    Number(match[1]) !== byteStart ||
    Number(match[2]) !== byteEnd ||
    Number(match[3]) !== fileSize
  ) {
    throw new RangeError(
      "Network media response Content-Range does not match the requested byte range.",
    );
  }

  const rawContentLength =
    response.headers.get("Content-Length");

  if (rawContentLength !== null) {
    const contentLength =
      Number(rawContentLength);

    if (
      !Number.isSafeInteger(contentLength) ||
      contentLength !== expectedByteLength
    ) {
      throw new RangeError(
        "Network media response Content-Length does not match the requested byte range.",
      );
    }
  }
}

export async function cacheNetworkMediaResponse({
  response,
  trackId,
  mediaVersion,
  byteStart,
  byteEnd,
  fileSize,
}) {
  if (
    byteStart %
      MEDIA_CHUNK_SIZE !==
    0
  ) {
    throw new RangeError(
      "Network media cache response must start on a cache chunk boundary.",
    );
  }

  validateNetworkRangeResponse({
    response,
    byteStart,
    byteEnd,
    fileSize,
  });

  const expectedByteLength =
    byteEnd -
    byteStart +
    1;

  if (
    !response.body
  ) {
    return 0;
  }

  const reader =
    response.body.getReader();

  let pending =
    new Uint8Array(
      MEDIA_CHUNK_SIZE,
    );

  let pendingLength =
    0;

  let receivedBytes =
    0;

  let cachedBytes =
    0;

  let chunkIndex =
    Math.floor(
      byteStart /
        MEDIA_CHUNK_SIZE,
    );

  let currentByteStart =
    byteStart;

  try {
    while (true) {
      const {
        done,
        value,
      } =
        await reader.read();

      if (done) {
        break;
      }

      if (!value) {
        continue;
      }

      if (
        receivedBytes +
          value.byteLength >
        expectedByteLength
      ) {
        throw new RangeError(
          "Network media response body exceeds requested byte range.",
        );
      }

      let valueOffset =
        0;

      while (
        valueOffset <
        value.byteLength
      ) {
        const remainingChunkSpace =
          MEDIA_CHUNK_SIZE -
          pendingLength;

        const remainingValueBytes =
          value.byteLength -
          valueOffset;

        const copyLength =
          Math.min(
            remainingChunkSpace,
            remainingValueBytes,
          );

        pending.set(
          value.subarray(
            valueOffset,
            valueOffset +
              copyLength,
          ),
          pendingLength,
        );

        pendingLength +=
          copyLength;

        valueOffset +=
          copyLength;

        if (
          pendingLength ===
          MEDIA_CHUNK_SIZE
        ) {
          await saveMediaChunk({
            trackId,
            mediaVersion,
            chunkIndex,
            byteStart:
              currentByteStart,
            data:
              pending.buffer,
          });

          cachedBytes +=
            pendingLength;

          currentByteStart +=
            MEDIA_CHUNK_SIZE;

          chunkIndex +=
            1;

          pending =
            new Uint8Array(
              MEDIA_CHUNK_SIZE,
            );

          pendingLength =
            0;
        }
      }

      receivedBytes +=
        value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  if (
    receivedBytes !==
    expectedByteLength
  ) {
    throw new RangeError(
      "Network media response body length does not match requested byte range.",
    );
  }

  if (
    pendingLength >
      0 &&
    byteEnd ===
      fileSize - 1
  ) {
    const finalChunk =
      pending.slice(
        0,
        pendingLength,
      );

    await saveMediaChunk({
      trackId,
      mediaVersion,
      chunkIndex,
      byteStart:
        currentByteStart,
      data:
        finalChunk.buffer,
    });

    cachedBytes +=
      pendingLength;
  }

  return cachedBytes;
}
