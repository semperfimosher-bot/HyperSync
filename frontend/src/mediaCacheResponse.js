import {
  parseMediaRangeHeader,
} from "./mediaRange.js";

import {
  getCachedMediaRange,
} from "./mediaStore.js";

import {
  createMediaRangeResponse,
} from "./mediaResponse.js";

export async function createCachedMediaRangeResponse({
  rangeHeader,
  trackId,
  mediaVersion,
  fileSize,
  mimeType,
}) {
  const range =
    parseMediaRangeHeader(
      rangeHeader,
      fileSize,
    );

  if (!range) {
    return null;
  }

  const data =
    await getCachedMediaRange(
      trackId,
      mediaVersion,
      range.byteStart,
      range.byteEnd,
    );

  if (!data) {
    return null;
  }

  return createMediaRangeResponse({
    data,
    byteStart:
      range.byteStart,
    byteEnd:
      range.byteEnd,
    fileSize,
    mimeType,
  });
}
