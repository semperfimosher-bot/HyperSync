import {
  API_BASE,
} from "./api/client.js";

import {
  ensureMediaRecord,
  getArtwork,
  getMediaChunk,
  getMediaRecord,
  getPinnedMediaRecords,
  MEDIA_CHUNK_SIZE,
  removeDownloadedMedia,
  saveArtwork,
  saveDownloadJob,
  saveLyrics,
  saveMediaRecord,
} from "./mediaStore.js";

import {
  cacheNetworkMediaResponse,
} from "./mediaNetworkCache.js";

import {
  getMissingDownloadBytes,
} from "./offlineDownloadMath.js";


export const OFFLINE_ARTWORK_ROUTE_PREFIX =
  "/__hypersync/artwork/";

export const DOWNLOAD_NETWORK_WINDOW_SIZE =
  MEDIA_CHUNK_SIZE * 16;

export const DEFAULT_DOWNLOAD_CONCURRENCY =
  3;

const MAX_OFFLINE_ARTWORK_BYTES =
  12 * 1024 * 1024;


function normalizeApiBase() {
  return API_BASE.replace(
    /\/+$/,
    "",
  );
}


function buildApiUrl(
  path,
) {
  const normalizedPath =
    String(path || "");

  if (
    normalizedPath.startsWith(
      "/api/",
    )
  ) {
    return (
      normalizeApiBase() +
      normalizedPath.slice(4)
    );
  }

  return (
    normalizeApiBase() +
    (
      normalizedPath.startsWith("/")
        ? normalizedPath
        : "/" + normalizedPath
    )
  );
}


function artworkVersionFromSource(
  source,
) {
  if (!source) {
    return null;
  }

  try {
    const parsed =
      new URL(
        source,
        globalThis.location
          ?.origin ??
          "https://hypersynced.invalid",
      );

    return (
      parsed.searchParams.get(
        "v",
      ) ||
      null
    );
  } catch {
    return null;
  }
}


export function getOfflineArtworkUrl(
  trackId,
  artworkVersion = null,
) {
  const normalizedTrackId =
    String(trackId ?? "").trim();

  if (!normalizedTrackId) {
    return null;
  }

  const normalizedVersion =
    artworkVersion === null ||
    artworkVersion === undefined
      ? ""
      : String(
          artworkVersion,
        ).trim();

  return (
    OFFLINE_ARTWORK_ROUTE_PREFIX +
    encodeURIComponent(
      normalizedTrackId,
    ) +
    (
      normalizedVersion
        ? (
            "?v=" +
            encodeURIComponent(
              normalizedVersion,
            )
          )
        : ""
    )
  );
}


async function requestPersistentStorage() {
  try {
    if (
      globalThis.navigator
        ?.storage
        ?.persist
    ) {
      return await globalThis.navigator
        .storage
        .persist();
    }
  } catch {
    // Storage persistence is best effort.
  }

  return false;
}


async function ensureStorageCapacity(
  requestedBytes,
) {
  if (
    !Number.isSafeInteger(
      requestedBytes,
    ) ||
    requestedBytes <= 0
  ) {
    return;
  }

  try {
    const estimate =
      await globalThis.navigator
        ?.storage
        ?.estimate?.();

    if (
      !estimate ||
      !Number.isFinite(
        estimate.quota,
      ) ||
      !Number.isFinite(
        estimate.usage,
      )
    ) {
      return;
    }

    const availableBytes =
      Math.max(
        0,
        estimate.quota -
          estimate.usage,
      );

    const requiredBytes =
      Math.ceil(
        requestedBytes * 1.1,
      );

    if (
      availableBytes <
      requiredBytes
    ) {
      throw new Error(
        "Not enough device storage is available for this download.",
      );
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith(
        "Not enough device storage",
      )
    ) {
      throw error;
    }

    // Quota estimation is not available everywhere.
  }
}


function trackIdentity(
  track,
) {
  const trackId =
    track?.id
      ? String(
          track.id,
        )
      : "";

  const mediaVersion =
    track?.media_version ??
    track?.mediaVersion ??
    "";

  return {
    trackId,
    mediaVersion:
      String(mediaVersion || ""),
    key:
      trackId &&
      mediaVersion
        ? (
            trackId +
            ":" +
            mediaVersion
          )
        : "",
  };
}


function trackFileSize(
  track,
) {
  return Number(
    track?.file_size ??
    track?.fileSize,
  );
}


function trackMimeType(
  track,
) {
  return (
    track?.mime_type ??
    track?.mimeType ??
    "application/octet-stream"
  );
}


async function requestDirectMediaSource(
  trackId,
  mediaVersion,
  signal,
) {
  try {
    const response =
      await fetch(
        buildApiUrl(
          "/api/media/" +
            encodeURIComponent(
              trackId,
            ) +
            "/source?version=" +
            encodeURIComponent(
              mediaVersion,
            ),
        ),
        {
          method: "GET",
          credentials: "include",
          cache: "no-store",
          signal,
        },
      );

    if (!response.ok) {
      return null;
    }

    const payload =
      await response.json();

    return (
      typeof payload?.url ===
        "string" &&
      payload.url
        ? payload.url
        : null
    );
  } catch {
    return null;
  }
}


async function fetchAudioRange({
  trackId,
  directSource,
  byteStart,
  byteEnd,
  signal,
}) {
  const headers = {
    Range:
      `bytes=${byteStart}-${byteEnd}`,
  };

  if (directSource) {
    try {
      const response =
        await fetch(
          directSource,
          {
            method: "GET",
            headers,
            credentials: "omit",
            cache: "no-store",
            signal,
          },
        );

      if (
        response.status ===
        206
      ) {
        return response;
      }
    } catch {
      // Fall back through the API below.
    }
  }

  const response =
    await fetch(
      buildApiUrl(
        "/api/audio/" +
          encodeURIComponent(
            trackId,
          ),
      ),
      {
        method: "GET",
        credentials: "include",
        cache: "no-cache",
        headers,
        signal,
      },
    );

  if (
    response.status !==
      206
  ) {
    throw new Error(
      `Unable to download audio range (${response.status}).`,
    );
  }

  return response;
}


async function isWindowCached({
  trackId,
  mediaVersion,
  byteStart,
  byteEnd,
  fileSize,
}) {
  const firstChunkIndex =
    Math.floor(
      byteStart /
        MEDIA_CHUNK_SIZE,
    );

  const lastChunkIndex =
    Math.floor(
      byteEnd /
        MEDIA_CHUNK_SIZE,
    );

  for (
    let chunkIndex =
      firstChunkIndex;
    chunkIndex <=
    lastChunkIndex;
    chunkIndex += 1
  ) {
    const expectedStart =
      chunkIndex *
      MEDIA_CHUNK_SIZE;

    const expectedEnd =
      Math.min(
        expectedStart +
          MEDIA_CHUNK_SIZE -
          1,
        fileSize - 1,
      );

    const chunk =
      await getMediaChunk(
        trackId,
        mediaVersion,
        chunkIndex,
      );

    if (
      !chunk ||
      chunk.byteStart !==
        expectedStart ||
      chunk.byteLength !==
        (
          expectedEnd -
          expectedStart +
          1
        )
    ) {
      return false;
    }
  }

  return true;
}


async function cacheTrackArtwork(
  track,
  {
    signal = null,
  } = {},
) {
  const trackId =
    String(
      track?.id ?? "",
    ).trim();

  const artworkSource =
    track?.artwork_url ??
    track?.artworkUrl ??
    null;

  if (
    !trackId ||
    !artworkSource
  ) {
    return null;
  }

  const artworkVersion =
    artworkVersionFromSource(
      artworkSource,
    );

  const existing =
    await getArtwork(
      trackId,
    );

  const existingMatches =
    existing?.data instanceof
      ArrayBuffer &&
    existing.data.byteLength > 0 &&
    (
      artworkVersion
        ? (
            existing.artworkVersion ===
            artworkVersion
          )
        : (
            !existing.sourceUrl ||
            existing.sourceUrl ===
              artworkSource
          )
    );

  if (existingMatches) {
    return existing;
  }

  const response =
    await fetch(
      buildApiUrl(
        "/api/catalog/tracks/" +
          encodeURIComponent(
            trackId,
          ) +
          "/artwork",
      ),
      {
        method: "GET",
        credentials: "include",
        cache: "no-cache",
        signal,
      },
    );

  if (!response.ok) {
    throw new Error(
      `Unable to download artwork (${response.status}).`,
    );
  }

  const data =
    await response.arrayBuffer();

  if (
    data.byteLength <= 0 ||
    data.byteLength >
      MAX_OFFLINE_ARTWORK_BYTES
  ) {
    throw new Error(
      "Downloaded artwork has an invalid size.",
    );
  }

  return saveArtwork({
    trackId,
    data,
    mimeType:
      response.headers.get(
        "Content-Type",
      ) ??
      "image/jpeg",
    sourceUrl:
      artworkSource,
    artworkVersion,
  });
}


async function cacheTrackLyrics(
  trackId,
  {
    signal = null,
  } = {},
) {
  try {
    const response =
      await fetch(
        buildApiUrl(
          "/api/catalog/tracks/" +
            encodeURIComponent(
              trackId,
            ) +
            "/lyrics",
        ),
        {
          method: "GET",
          credentials: "include",
          cache: "no-cache",
          signal,
        },
      );

    if (!response.ok) {
      return null;
    }

    const payload =
      await response.json();

    await saveLyrics(
      trackId,
      payload,
    );

    return payload;
  } catch (error) {
    if (
      error?.name ===
      "AbortError"
    ) {
      throw error;
    }

    /*
     * Lyrics are an offline enhancement.
     * A lyrics-provider outage must never
     * fail an otherwise valid music download.
     */
    return null;
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


export async function searchDownloadedTracks(
  query,
) {
  const normalizedQuery =
    String(query ?? "")
      .trim()
      .toLocaleLowerCase();

  if (!normalizedQuery) {
    return [];
  }

  const tracks =
    await getDownloadedTracks();

  return tracks.filter(
    (track) => {
      const haystack =
        [
          track.title,
          track.artist,
          track.album,
        ]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase();

      return haystack.includes(
        normalizedQuery,
      );
    },
  );
}


export async function downloadTrackForOffline(
  track,
  {
    onProgress = null,
    signal = null,
    skipStorageCheck = false,
  } = {},
) {
  const {
    trackId,
    mediaVersion,
  } =
    trackIdentity(
      track,
    );

  const mimeType =
    trackMimeType(
      track,
    );

  const fileSize =
    trackFileSize(
      track,
    );

  if (!trackId) {
    throw new Error(
      "Track id is required.",
    );
  }

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

  const mediaRecord =
    await ensureMediaRecord({
      trackId,
      mediaVersion,
      mimeType,
      fileSize,
    });

  if (!skipStorageCheck) {
    await ensureStorageCapacity(
      getMissingDownloadBytes(
        fileSize,
        mediaRecord,
      ),
    );
  }

  const directSource =
    await requestDirectMediaSource(
      trackId,
      mediaVersion,
      signal,
    );

  let completedBytes =
    0;

  for (
    let byteStart = 0;
    byteStart < fileSize;
    byteStart +=
      DOWNLOAD_NETWORK_WINDOW_SIZE
  ) {
    const byteEnd =
      Math.min(
        byteStart +
          DOWNLOAD_NETWORK_WINDOW_SIZE -
          1,
        fileSize - 1,
      );

    const windowLength =
      byteEnd -
      byteStart +
      1;

    const cached =
      await isWindowCached({
        trackId,
        mediaVersion,
        byteStart,
        byteEnd,
        fileSize,
      });

    if (!cached) {
      const response =
        await fetchAudioRange({
          trackId,
          directSource,
          byteStart,
          byteEnd,
          signal,
        });

      await cacheNetworkMediaResponse({
        response,
        trackId,
        mediaVersion,
        byteStart,
        byteEnd,
        fileSize,
      });
    }

    completedBytes +=
      windowLength;

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

  let artwork =
    null;

  try {
    artwork =
      await cacheTrackArtwork(
        track,
        {
          signal,
        },
      );
  } catch (error) {
    if (
      error?.name ===
      "AbortError"
    ) {
      throw error;
    }

    /*
     * Audio is the required offline asset.
     * A temporary artwork failure must not
     * discard an otherwise complete track.
     */
  }

  await cacheTrackLyrics(
    trackId,
    {
      signal,
    },
  );

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
      (
        track.artwork_url ??
        track.artworkUrl
      )
        ? getOfflineArtworkUrl(
            trackId,
            artwork?.artworkVersion ??
              artworkVersionFromSource(
                track.artwork_url ??
                track.artworkUrl,
              ),
          )
        : null,

    artworkSourceUrl:
      track.artwork_url ??
      track.artworkUrl ??
      null,
  };

  await saveMediaRecord(
    pinnedRecord,
  );

  /*
   * A re-upload changes mediaVersion.
   * Keep only the newly downloaded version
   * so stale audio does not accumulate or
   * appear twice in Downloads.
   */
  const pinnedRecords =
    await getPinnedMediaRecords();

  for (
    const existing
    of pinnedRecords
  ) {
    if (
      existing.trackId ===
        trackId &&
      existing.mediaVersion !==
        mediaVersion
    ) {
      await removeDownloadedMedia(
        existing.trackId,
        existing.mediaVersion,
      );
    }
  }

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


export async function downloadTracksForOffline(
  tracks,
  {
    concurrency =
      DEFAULT_DOWNLOAD_CONCURRENCY,
    onProgress = null,
    signal = null,
    jobId = null,
  } = {},
) {
  const uniqueTracks =
    [];

  const seen =
    new Set();

  for (
    const track
    of Array.isArray(tracks)
      ? tracks
      : []
  ) {
    const identity =
      trackIdentity(
        track,
      );

    if (
      !identity.key ||
      seen.has(
        identity.key,
      )
    ) {
      continue;
    }

    seen.add(
      identity.key,
    );

    uniqueTracks.push(
      track,
    );
  }

  if (
    uniqueTracks.length ===
    0
  ) {
    onProgress?.({
      downloadedBytes: 0,
      totalBytes: 0,
      progress: 1,
      completedTracks: 0,
      totalTracks: 0,
    });

    return [];
  }

  await requestPersistentStorage();

  const progressByKey =
    new Map();

  const completedKeys =
    new Set();

  const pendingTracks =
    [];

  let totalBytes =
    0;

  for (
    const track
    of uniqueTracks
  ) {
    const identity =
      trackIdentity(
        track,
      );

    const fileSize =
      trackFileSize(
        track,
      );

    if (
      !Number.isSafeInteger(
        fileSize,
      ) ||
      fileSize <= 0
    ) {
      throw new Error(
        "A playlist track has invalid media size metadata.",
      );
    }

    totalBytes +=
      fileSize;

    if (
      await isTrackDownloaded(
        track,
      )
    ) {
      progressByKey.set(
        identity.key,
        fileSize,
      );

      completedKeys.add(
        identity.key,
      );
    } else {
      const existingRecord =
        await getMediaRecord(
          identity.trackId,
          identity.mediaVersion,
        );

      const missingBytes =
        getMissingDownloadBytes(
          fileSize,
          existingRecord,
        );

      progressByKey.set(
        identity.key,
        fileSize -
          missingBytes,
      );

      pendingTracks.push(
        track,
      );
    }
  }

  const remainingBytes =
    pendingTracks.reduce(
      (
        sum,
        track,
      ) => {
        const identity =
          trackIdentity(
            track,
          );

        return (
          sum +
          getMissingDownloadBytes(
            trackFileSize(
              track,
            ),
            {
              cachedBytes:
                progressByKey.get(
                  identity.key,
                ) ??
                0,
            },
          )
        );
      },
      0,
    );

  await ensureStorageCapacity(
    remainingBytes,
  );

  const normalizedJobId =
    jobId
      ? String(jobId)
      : (
          "offline:" +
          Date.now()
        );

  const downloadedBytesNow =
    () =>
      Array.from(
        progressByKey.values(),
      ).reduce(
        (sum, value) =>
          sum + value,
        0,
      );

  const report = (
    currentTrackId =
      null,
  ) => {
    const downloadedBytes =
      downloadedBytesNow();

    onProgress?.({
      downloadedBytes,
      totalBytes,
      progress:
        totalBytes > 0
          ? (
              downloadedBytes /
              totalBytes
            )
          : 1,
      completedTracks:
        completedKeys.size,
      totalTracks:
        uniqueTracks.length,
      currentTrackId,
    });
  };

  await saveDownloadJob({
    id:
      normalizedJobId,
    state:
      pendingTracks.length > 0
        ? "downloading"
        : "complete",
    totalBytes,
    downloadedBytes:
      downloadedBytesNow(),
    trackKeys:
      uniqueTracks.map(
        (track) =>
          trackIdentity(
            track,
          ).key,
      ),
  });

  report();

  if (
    pendingTracks.length ===
    0
  ) {
    return Promise.all(
      uniqueTracks.map(
        (track) => {
          const identity =
            trackIdentity(
              track,
            );

          return getMediaRecord(
            identity.trackId,
            identity.mediaVersion,
          );
        },
      ),
    );
  }

  const results =
    new Array(
      pendingTracks.length,
    );

  const workerController =
    new AbortController();

  const abortFromCaller =
    () => {
      workerController.abort();
    };

  if (signal?.aborted) {
    workerController.abort();
  } else {
    signal?.addEventListener?.(
      "abort",
      abortFromCaller,
      {
        once: true,
      },
    );
  }

  let nextIndex =
    0;

  const workerCount =
    Math.max(
      1,
      Math.min(
        Math.trunc(
          concurrency,
        ) || 1,
        pendingTracks.length,
        4,
      ),
    );

  async function worker() {
    while (true) {
      if (
        workerController.signal
          .aborted
      ) {
        throw new DOMException(
          "Download cancelled.",
          "AbortError",
        );
      }

      const index =
        nextIndex;

      nextIndex +=
        1;

      if (
        index >=
        pendingTracks.length
      ) {
        return;
      }

      const track =
        pendingTracks[
          index
        ];

      const identity =
        trackIdentity(
          track,
        );

      const record =
        await downloadTrackForOffline(
          track,
          {
            signal:
              workerController.signal,
            skipStorageCheck:
              true,
            onProgress: ({
              downloadedBytes,
            }) => {
              progressByKey.set(
                identity.key,
                downloadedBytes,
              );

              report(
                identity.trackId,
              );
            },
          },
        );

      results[index] =
        record;

      progressByKey.set(
        identity.key,
        trackFileSize(
          track,
        ),
      );

      completedKeys.add(
        identity.key,
      );

      report(
        identity.trackId,
      );

      await saveDownloadJob({
        id:
          normalizedJobId,
        state:
          "downloading",
        totalBytes,
        downloadedBytes:
          downloadedBytesNow(),
        trackKeys:
          uniqueTracks.map(
            (item) =>
              trackIdentity(
                item,
              ).key,
          ),
      });
    }
  }

  try {
    await Promise.all(
      Array.from(
        {
          length:
            workerCount,
        },
        async () => {
          try {
            await worker();
          } catch (error) {
            workerController.abort();
            throw error;
          }
        },
      ),
    );

    await saveDownloadJob({
      id:
        normalizedJobId,
      state:
        "complete",
      totalBytes,
      downloadedBytes:
        totalBytes,
      trackKeys:
        uniqueTracks.map(
          (track) =>
            trackIdentity(
              track,
            ).key,
        ),
    });

    report();

    return results;
  } catch (error) {
    await saveDownloadJob({
      id:
        normalizedJobId,
      state:
        signal?.aborted
          ? "paused"
          : "error",
      totalBytes,
      downloadedBytes:
        downloadedBytesNow(),
      trackKeys:
        uniqueTracks.map(
          (track) =>
            trackIdentity(
              track,
            ).key,
        ),
      error:
        error instanceof Error
          ? error.message
          : "Download failed.",
    }).catch(
      () => null,
    );

    throw error;
  } finally {
    signal?.removeEventListener?.(
      "abort",
      abortFromCaller,
    );
  }
}


export async function isTrackDownloaded(
  track,
) {
  const {
    trackId,
    mediaVersion,
  } =
    trackIdentity(
      track,
    );

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
