import {
  API_BASE,
} from "./api/client.js";

import {
  ensureMediaRecord,
  getMediaChunk,
  getMediaRecord,
  getPinnedMediaRecords,
  MEDIA_CHUNK_SIZE,
  saveMediaChunk,
  saveMediaRecord,
} from "./mediaStore.js";

function normalizeApiBase() {
  return API_BASE.replace(
    /\/+$/,
    "",
  );
}


async function requestPersistentStorage() {
  try {
    if (
      globalThis.navigator
        ?.storage
        ?.persist
    ) {
      await globalThis.navigator
        .storage
        .persist();
    }
  } catch {
    /*
     * A browser can refuse persistent
     * storage. That should not prevent
     * downloading from working.
     */
  }
}

export async function getDownloadedTracks() {
  const records =
    await getPinnedMediaRecords();

  return records.map(
    (record) => ({
      id:
        record.trackId,

      title:
        record.title ||
        "Unknown Track",

      artist:
        record.artist ||
        "Unknown Artist",

      album:
        record.album ||
        "",

      duration_seconds:
        record.durationSeconds ??
        null,

      artwork_url:
        record.artworkUrl ??
        null,

      mime_type:
        record.mimeType ??
        null,

      file_size:
        record.fileSize ??
        null,

      media_version:
        record.mediaVersion,

      downloaded:
        true,
    }),
  );
}

export async function downloadTrackForOffline(
  track,
  {
    onProgress = null,
  } = {},
) {
  if (!track?.id) {
    throw new Error(
      "Track id is required.",
    );
  }


  const trackId =
    String(
      track.id,
    );


  const mediaVersion =
    track.media_version ??
    track.mediaVersion ??
    null;


  const mimeType =
    track.mime_type ??
    track.mimeType ??
    "application/octet-stream";


  const fileSize =
    Number(
      track.file_size ??
      track.fileSize,
    );


  if (!mediaVersion) {
    throw new Error(
      "This track does not have a media version.",
    );
  }


  if (
    !Number.isSafeInteger(
      fileSize,
    ) ||
    fileSize <= 0
  ) {
    throw new Error(
      "This track does not have a valid file size.",
    );
  }


  await requestPersistentStorage();


  await ensureMediaRecord({
    trackId,
    mediaVersion,
    mimeType,
    fileSize,
  });


  const chunkCount =
    Math.ceil(
      fileSize /
      MEDIA_CHUNK_SIZE,
    );


  let completedBytes =
    0;


  for (
    let chunkIndex = 0;
    chunkIndex < chunkCount;
    chunkIndex += 1
  ) {
    const byteStart =
      chunkIndex *
      MEDIA_CHUNK_SIZE;


    const byteEnd =
      Math.min(
        byteStart +
          MEDIA_CHUNK_SIZE -
          1,
        fileSize - 1,
      );


    const expectedLength =
      byteEnd -
      byteStart +
      1;


    /*
     * Resume downloads instead of
     * fetching chunks we already have.
     */
    const existingChunk =
      await getMediaChunk(
        trackId,
        mediaVersion,
        chunkIndex,
      );


    if (
      existingChunk &&
      existingChunk.byteStart ===
        byteStart &&
      existingChunk.byteLength ===
        expectedLength
    ) {
      completedBytes +=
        expectedLength;

      onProgress?.({
        trackId,
        downloadedBytes:
          completedBytes,
        totalBytes:
          fileSize,
        progress:
          completedBytes /
          fileSize,
      });

      continue;
    }


    const response =
      await fetch(
        `${normalizeApiBase()}/audio/${encodeURIComponent(
          trackId,
        )}`,
        {
          method:
            "GET",

          credentials:
            "include",

          cache:
            "no-cache",

          headers: {
            Range:
              `bytes=${byteStart}-${byteEnd}`,
          },
        },
      );


    if (
      response.status !==
        206 &&
      response.status !==
        200
    ) {
      throw new Error(
        `Unable to download track chunk (${response.status}).`,
      );
    }


    const data =
      await response.arrayBuffer();


    if (
      data.byteLength !==
      expectedLength
    ) {
      throw new Error(
        "Downloaded audio chunk has an unexpected size.",
      );
    }


    await saveMediaChunk({
      trackId,
      mediaVersion,
      chunkIndex,
      byteStart,
      data,
    });


    completedBytes +=
      data.byteLength;


    onProgress?.({
      trackId,
      downloadedBytes:
        completedBytes,
      totalBytes:
        fileSize,
      progress:
        completedBytes /
        fileSize,
    });
  }


  const record =
    await getMediaRecord(
      trackId,
      mediaVersion,
    );


  if (!record) {
    throw new Error(
      "Downloaded media record disappeared.",
    );
  }


  /*
   * PINNED means:
   *
   * "The user explicitly downloaded
   * this track. Do not remove it during
   * normal cache cleanup."
   */
  const pinnedRecord = {
    ...record,

    state:
      "PINNED",

    cachedBytes:
      fileSize,

    expiresAt:
      null,

    title:
      track.title ??
      "",

    artist:
      track.artist ??
      "",

    album:
      track.album ??
      "",

    durationSeconds:
      track.duration_seconds ??
      track.durationSeconds ??
      null,

    artworkUrl:
      track.artwork_url ??
      track.artworkUrl ??
      null,
  };


  await saveMediaRecord(
    pinnedRecord,
  );


  onProgress?.({
    trackId,
    downloadedBytes:
      fileSize,
    totalBytes:
      fileSize,
    progress:
      1,
  });


  return pinnedRecord;
}

export async function isTrackDownloaded(
  track,
) {
  const trackId =
    track?.id
      ? String(
          track.id,
        )
      : null;

  const mediaVersion =
    track?.media_version ??
    track?.mediaVersion ??
    null;


  if (
    !trackId ||
    !mediaVersion
  ) {
    return false;
  }


  const record =
    await getMediaRecord(
      trackId,
      mediaVersion,
    );


  return (
    record?.state ===
    "PINNED"
  );
}
