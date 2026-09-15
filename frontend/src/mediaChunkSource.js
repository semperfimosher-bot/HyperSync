import {
  getMediaChunk,
  MEDIA_CHUNK_SIZE,
  saveMediaChunk,
} from "./mediaStore.js";

export async function getOrFetchMediaChunk({
  trackId,
  mediaVersion,
  chunkIndex,
  fileSize,
  fetchChunk,
}) {
  if (
    !Number.isSafeInteger(
      chunkIndex,
    ) ||
    chunkIndex < 0
  ) {
    throw new RangeError(
      "Media chunk index must be a non-negative safe integer.",
    );
  }

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

  const byteStart =
    chunkIndex *
    MEDIA_CHUNK_SIZE;

  if (
    !Number.isSafeInteger(
      byteStart,
    ) ||
    byteStart >=
      fileSize
  ) {
    throw new RangeError(
      "Media chunk index is outside the file.",
    );
  }

  const byteEnd =
    Math.min(
      byteStart +
        MEDIA_CHUNK_SIZE -
        1,
      fileSize - 1,
    );

  const expectedByteLength =
    byteEnd -
    byteStart +
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
      byteStart &&
    cached.byteLength ===
      expectedByteLength
  ) {
    return new Uint8Array(
      cached.data,
    );
  }

  if (
    typeof fetchChunk !==
    "function"
  ) {
    throw new TypeError(
      "Media chunk fetcher is required for a cache miss.",
    );
  }

  const response =
    await fetchChunk({
      byteStart,
      byteEnd,
    });

  if (
    !response ||
    response.status !==
      206
  ) {
    throw new Error(
      "Media chunk network request did not return partial content.",
    );
  }

  const data =
    await response.arrayBuffer();

  if (
    data.byteLength !==
    expectedByteLength
  ) {
    throw new RangeError(
      "Media chunk network response length does not match the requested range.",
    );
  }

  await saveMediaChunk({
    trackId,
    mediaVersion,
    chunkIndex,
    byteStart,
    data,
  });

  return new Uint8Array(
    data,
  );
}
