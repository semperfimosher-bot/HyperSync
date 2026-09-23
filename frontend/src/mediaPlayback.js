import {
  ensureMediaRecord,
  getCachedMediaRange,
  getMediaRecord,
  markMediaPlayed,
} from "./mediaStore.js";

import {
  getTrackAudioSource,
} from "./playerQueue.js";

export async function prepareTrackAudioSource(
  trackId,
  meta = {},
  options = {},
) {
  const mediaVersion =
    meta.mediaVersion ??
    meta.media_version ??
    null;

  const mimeType =
    meta.mimeType ??
    meta.mime_type ??
    null;

  const fileSize =
    meta.fileSize ??
    meta.file_size ??
    null;

  if (
    options.useStableMediaRoute ===
      true &&
    mediaVersion
  ) {
    await ensureMediaRecord({
      trackId,
      mediaVersion,
      mimeType,
      fileSize,
    });
  }

  if (
    options.preferCachedBlob ===
      true &&
    mediaVersion &&
    typeof Blob !==
      "undefined" &&
    typeof globalThis.URL
      ?.createObjectURL ===
      "function"
  ) {
    const record =
      await getMediaRecord(
        trackId,
        mediaVersion,
      );

    const cachedFileSize =
      Number(
        fileSize ??
        record?.fileSize,
      );

    if (
      record?.state ===
        "PINNED" &&
      Number.isSafeInteger(
        cachedFileSize,
      ) &&
      cachedFileSize > 0 &&
      Number(
        record.cachedBytes ??
        0,
      ) >=
        cachedFileSize
    ) {
      const cached =
        await getCachedMediaRange(
          trackId,
          mediaVersion,
          0,
          cachedFileSize - 1,
        );

      if (
        cached &&
        cached.byteLength ===
          cachedFileSize
      ) {
        return globalThis.URL
          .createObjectURL(
            new Blob(
              [cached],
              {
                type:
                  mimeType ??
                  record.mimeType ??
                  "audio/mpeg",
              },
            ),
          );
      }
    }
  }

  return getTrackAudioSource(
    trackId,
    meta,
    options,
  );
}

export async function recordTrackPlayback(
  trackId,
  meta = {},
  playedAt =
    Date.now(),
) {
  const mediaVersion =
    meta.mediaVersion ??
    meta.media_version ??
    null;

  if (!mediaVersion) {
    return null;
  }

  return markMediaPlayed(
    trackId,
    mediaVersion,
    playedAt,
  );
}
