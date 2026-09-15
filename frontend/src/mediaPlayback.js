import {
  ensureMediaRecord,
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
