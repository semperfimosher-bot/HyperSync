import {
  API_BASE,
} from "./api/client.js";

import {
  addMediaPinReference,
  deleteDownloadJob,
  ensureMediaRecord,
  getArtwork,
  getDownloadJobs,
  getMediaChunk,
  getMediaRecord,
  getMediaPinReferences,
  getPinnedMediaRecords,
  MEDIA_CHUNK_SIZE,
  removeArtwork,
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

const OFFLINE_ARTWORK_RETRY_MS =
  5 * 60 * 1000;

const OFFLINE_METADATA_REVALIDATE_MS =
  15 * 60 * 1000;

const offlineArtworkObjectUrls =
  new Map();


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


function artworkVersionFromTrack(
  track,
) {
  const explicit =
    track?.artwork_version ??
    track?.artworkVersion ??
    null;

  if (
    explicit !== null &&
    explicit !== undefined &&
    String(explicit).trim()
  ) {
    return String(
      explicit,
    ).trim();
  }

  return artworkVersionFromSource(
    track?.artwork_url ??
    track?.artworkUrl ??
    null,
  );
}


function normalizeOwnerKey(
  ownerKey,
) {
  const normalized =
    String(
      ownerKey ?? "",
    ).trim();

  return normalized || null;
}


export function getOfflineOwnerKey(
  user,
) {
  return normalizeOwnerKey(
    user?.id ??
    user?.username ??
    null,
  );
}


function getOfflineOwnerPinPrefix(
  ownerKey,
) {
  const normalized =
    normalizeOwnerKey(
      ownerKey,
    );

  if (!normalized) {
    return null;
  }

  return (
    "owner:" +
    encodeURIComponent(
      normalized,
    ) +
    "|"
  );
}


export function getManualDownloadPinRef(
  ownerKey,
) {
  const prefix =
    getOfflineOwnerPinPrefix(
      ownerKey,
    );

  return prefix
    ? prefix + "manual"
    : null;
}


export function getPlaylistDownloadPinRef(
  ownerKey,
  playlistId,
) {
  const prefix =
    getOfflineOwnerPinPrefix(
      ownerKey,
    );

  const normalizedPlaylistId =
    String(
      playlistId ?? "",
    ).trim();

  if (
    !prefix ||
    !normalizedPlaylistId
  ) {
    return null;
  }

  return (
    prefix +
    "playlist:" +
    encodeURIComponent(
      normalizedPlaylistId,
    )
  );
}


export function getPlaylistDownloadJobId(
  ownerKey,
  playlistId,
) {
  const normalizedOwnerKey =
    normalizeOwnerKey(
      ownerKey,
    );

  const normalizedPlaylistId =
    String(
      playlistId ?? "",
    ).trim();

  if (
    !normalizedOwnerKey ||
    !normalizedPlaylistId
  ) {
    return null;
  }

  return (
    "playlist:" +
    encodeURIComponent(
      normalizedOwnerKey,
    ) +
    ":" +
    encodeURIComponent(
      normalizedPlaylistId,
    )
  );
}


function recordBelongsToOwner(
  record,
  ownerKey,
) {
  const prefix =
    getOfflineOwnerPinPrefix(
      ownerKey,
    );

  return Boolean(
    prefix &&
    getMediaPinReferences(
      record,
    ).some(
      (pinRef) =>
        pinRef.startsWith(
          prefix,
        ),
    ),
  );
}


function mediaKeyParts(
  mediaKey,
) {
  const normalized =
    String(
      mediaKey ?? "",
    );

  const separator =
    normalized.lastIndexOf(
      ":",
    );

  if (
    separator <= 0 ||
    separator >=
      normalized.length - 1
  ) {
    return null;
  }

  return {
    trackId:
      normalized.slice(
        0,
        separator,
      ),
    mediaVersion:
      normalized.slice(
        separator + 1,
      ),
  };
}


async function replaceDownloadJobMediaKey(
  oldKey,
  newKey,
) {
  if (
    !oldKey ||
    !newKey ||
    oldKey === newKey
  ) {
    return;
  }

  const jobs =
    await getDownloadJobs();

  await Promise.all(
    jobs
      .filter(
        (job) =>
          Array.isArray(
            job?.trackKeys,
          ) &&
          job.trackKeys.includes(
            oldKey,
          ),
      )
      .map(
        (job) =>
          saveDownloadJob({
            ...job,
            trackKeys:
              job.trackKeys.map(
                (key) =>
                  key === oldKey
                    ? newKey
                    : key,
              ),
          }),
      ),
  );
}


async function resolvePinnedRecordForKey(
  mediaKey,
  pinRef = null,
) {
  const parts =
    mediaKeyParts(
      mediaKey,
    );

  if (!parts) {
    return null;
  }

  const exact =
    await getMediaRecord(
      parts.trackId,
      parts.mediaVersion,
    );

  if (
    exact?.state ===
      "PINNED" &&
    (
      !pinRef ||
      getMediaPinReferences(
        exact,
      ).includes(
        pinRef,
      )
    )
  ) {
    return exact;
  }

  if (!pinRef) {
    return null;
  }

  const records =
    await getPinnedMediaRecords();

  return (
    records.find(
      (record) =>
        record.trackId ===
          parts.trackId &&
        getMediaPinReferences(
          record,
        ).includes(
          pinRef,
        ),
    ) ??
    null
  );
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


async function fetchAudioRange({
  trackId,
  byteStart,
  byteEnd,
  signal,
}) {
  const headers = {
    Range:
      `bytes=${byteStart}-${byteEnd}`,
  };

  /*
   * Offline downloads intentionally use HyperSync's
   * same-origin Range endpoint. Fetching a presigned B2
   * URL directly requires bucket CORS and fails in local
   * development when B2 omits Access-Control-Allow-Origin.
   */
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
    artworkVersionFromTrack(
      track,
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

  const contentLength =
    Number(
      response.headers.get(
        "Content-Length",
      ),
    );

  if (
    Number.isFinite(
      contentLength,
    ) &&
    contentLength >
      MAX_OFFLINE_ARTWORK_BYTES
  ) {
    throw new Error(
      "Downloaded artwork has an invalid size.",
    );
  }

  if (
    Number.isSafeInteger(
      contentLength,
    ) &&
    contentLength > 0
  ) {
    await ensureStorageCapacity(
      contentLength,
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


async function fetchCurrentTrackMetadata(
  trackId,
  {
    signal = null,
  } = {},
) {
  const response =
    await fetch(
      buildApiUrl(
        "/api/catalog/tracks/" +
          encodeURIComponent(
            trackId,
          ),
      ),
      {
        method:
          "GET",
        credentials:
          "include",
        cache:
          "no-cache",
        signal,
      },
    );

  if (!response.ok) {
    throw new Error(
      `Unable to refresh downloaded track metadata (${response.status}).`,
    );
  }

  return response.json();
}


async function repairDownloadedArtworkRecord(
  record,
) {
  if (
    globalThis.navigator
      ?.onLine === false
  ) {
    return record;
  }

  const now =
    Date.now();

  const retryAfter =
    Number(
      record.artworkRetryAfter ??
      0,
    );

  if (
    Number.isFinite(
      retryAfter,
    ) &&
    retryAfter > now
  ) {
    return record;
  }

  const validatedAt =
    Number(
      record.artworkValidatedAt ??
      0,
    );

  if (
    Number.isFinite(
      validatedAt,
    ) &&
    validatedAt > 0 &&
    now - validatedAt <
      OFFLINE_METADATA_REVALIDATE_MS
  ) {
    return record;
  }

  try {
    const currentTrack =
      await fetchCurrentTrackMetadata(
        record.trackId,
      );

    const artworkSourceUrl =
      currentTrack?.artwork_url ??
      currentTrack?.artworkUrl ??
      null;

    const artworkVersion =
      artworkVersionFromTrack(
        currentTrack,
      );

    if (!artworkSourceUrl) {
      await removeArtwork(
        record.trackId,
      ).catch(
        () => null,
      );

      const updated = {
        ...record,
        title:
          currentTrack?.title ??
          record.title,
        artist:
          currentTrack?.artist ??
          record.artist,
        album:
          currentTrack?.album ??
          record.album,
        durationSeconds:
          currentTrack?.duration_seconds ??
          currentTrack?.durationSeconds ??
          record.durationSeconds,
        artworkSourceUrl:
          null,
        artworkVersion:
          null,
        artworkUrl:
          null,
        artworkCached:
          false,
        artworkRetryAfter:
          null,
        artworkValidatedAt:
          now,
      };

      await saveMediaRecord(
        updated,
      );

      return updated;
    }

    const artwork =
      await cacheTrackArtwork(
        currentTrack,
      );

    const updated = {
      ...record,
      title:
        currentTrack?.title ??
        record.title,
      artist:
        currentTrack?.artist ??
        record.artist,
      album:
        currentTrack?.album ??
        record.album,
      durationSeconds:
        currentTrack?.duration_seconds ??
        currentTrack?.durationSeconds ??
        record.durationSeconds,
      artworkSourceUrl,
      artworkVersion:
        artwork?.artworkVersion ??
        artworkVersion ??
        null,
      artworkUrl:
        artwork
          ? getOfflineArtworkUrl(
              record.trackId,
              artwork.artworkVersion ??
                artworkVersion,
            )
          : null,
      artworkCached:
        Boolean(
          artwork,
        ),
      artworkRetryAfter:
        artwork
          ? null
          : now +
            OFFLINE_ARTWORK_RETRY_MS,
      artworkValidatedAt:
        now,
    };

    await saveMediaRecord(
      updated,
    );

    return updated;
  } catch {
    const updated = {
      ...record,
      artworkRetryAfter:
        now +
        OFFLINE_ARTWORK_RETRY_MS,
    };

    await saveMediaRecord(
      updated,
    ).catch(
      () => null,
    );

    return updated;
  }
}

async function resolveDownloadedArtworkUrl(
  record,
  serviceWorkerControlled,
  online,
) {
  const artwork =
    await getArtwork(
      record.trackId,
    ).catch(
      () => null,
    );

  const versionMatches =
    !record.artworkVersion ||
    artwork?.artworkVersion ===
      record.artworkVersion;

  const hasCachedArtwork =
    versionMatches &&
    artwork?.data instanceof
      ArrayBuffer &&
    artwork.data.byteLength > 0;

  if (
    hasCachedArtwork &&
    serviceWorkerControlled
  ) {
    return getOfflineArtworkUrl(
      record.trackId,
      artwork.artworkVersion ??
        record.artworkVersion,
    );
  }

  if (
    hasCachedArtwork &&
    typeof Blob !==
      "undefined" &&
    typeof globalThis.URL
      ?.createObjectURL ===
      "function"
  ) {
    const objectKey =
      String(
        artwork.artworkVersion ??
        artwork.updatedAt ??
        artwork.byteLength,
      );

    const existing =
      offlineArtworkObjectUrls.get(
        record.trackId,
      );

    if (
      existing?.key ===
      objectKey
    ) {
      return existing.url;
    }

    if (
      existing?.url &&
      typeof globalThis.URL
        ?.revokeObjectURL ===
        "function"
    ) {
      globalThis.URL.revokeObjectURL(
        existing.url,
      );
    }

    const url =
      globalThis.URL.createObjectURL(
        new Blob(
          [
            artwork.data,
          ],
          {
            type:
              artwork.mimeType ??
              "image/jpeg",
          },
        ),
      );

    offlineArtworkObjectUrls.set(
      record.trackId,
      {
        key:
          objectKey,
        url,
      },
    );

    return url;
  }

  return online
    ? record.artworkSourceUrl ??
        null
    : null;
}


async function downloadedTrackFromRecord(
  record,
  serviceWorkerControlled,
  online,
) {
  const artworkUrl =
    await resolveDownloadedArtworkUrl(
      record,
      serviceWorkerControlled,
      online,
    );

  return {
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
      artworkUrl,
    offline_artwork_url:
      record.artworkCached
        ? record.artworkUrl ??
          null
        : null,
    artwork_version:
      record.artworkVersion ??
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
  };
}


export async function getDownloadedTracks(
  ownerKey,
  {
    manualOnly = false,
  } = {},
) {
  const normalizedOwnerKey =
    normalizeOwnerKey(
      ownerKey,
    );

  if (!normalizedOwnerKey) {
    return [];
  }

  const manualPinRef =
    manualOnly
      ? getManualDownloadPinRef(
          normalizedOwnerKey,
        )
      : null;

  const records =
    (
      await getPinnedMediaRecords()
    ).filter(
      (record) =>
        recordBelongsToOwner(
          record,
          normalizedOwnerKey,
        ) &&
        (
          !manualOnly ||
          getMediaPinReferences(
            record,
          ).includes(
            manualPinRef,
          )
        ),
    );

  const online =
    globalThis.navigator
      ?.onLine !== false;

  const repairedRecords =
    online
      ? await Promise.all(
          records.map(
            (record) =>
              repairDownloadedArtworkRecord(
                record,
              ),
          ),
        )
      : records;

  const serviceWorkerControlled =
    Boolean(
      globalThis.navigator
        ?.serviceWorker
        ?.controller,
    );

  return Promise.all(
    repairedRecords.map(
      (record) =>
        downloadedTrackFromRecord(
          record,
          serviceWorkerControlled,
          online,
        ),
    ),
  );
}


export async function getDownloadedPlaylists(
  ownerKey,
) {
  const normalizedOwnerKey =
    normalizeOwnerKey(
      ownerKey,
    );

  if (!normalizedOwnerKey) {
    return [];
  }

  const [
    jobs,
    allRecords,
  ] =
    await Promise.all([
      getDownloadJobs(),
      getPinnedMediaRecords(),
    ]);

  const records =
    allRecords.filter(
      (record) =>
        recordBelongsToOwner(
          record,
          normalizedOwnerKey,
        ),
    );

  const online =
    globalThis.navigator
      ?.onLine !== false;

  const repairedRecords =
    online
      ? await Promise.all(
          records.map(
            (record) =>
              repairDownloadedArtworkRecord(
                record,
              ),
          ),
        )
      : records;

  const recordByKey =
    new Map(
      repairedRecords.map(
        (record) => [
          record.key,
          record,
        ],
      ),
    );

  const recordsByTrackId =
    new Map();

  for (
    const record
    of repairedRecords
  ) {
    const current =
      recordsByTrackId.get(
        record.trackId,
      ) ?? [];

    current.push(
      record,
    );

    recordsByTrackId.set(
      record.trackId,
      current,
    );
  }

  const serviceWorkerControlled =
    Boolean(
      globalThis.navigator
        ?.serviceWorker
        ?.controller,
    );

  const playlistJobs =
    jobs
      .filter(
        (job) =>
          job?.state ===
            "complete" &&
          String(
            job?.ownerKey ??
            "",
          ) ===
            normalizedOwnerKey &&
          (
            job?.kind ===
              "playlist" ||
            String(
              job?.id ??
              "",
            ).startsWith(
              "playlist:",
            )
          ),
      )
      .sort(
        (first, second) =>
          Number(
            second?.updatedAt ??
            0,
          ) -
          Number(
            first?.updatedAt ??
            0,
          ),
      );

  const playlists =
    await Promise.all(
      playlistJobs.map(
        async (job) => {
          const playlistId =
            String(
              job.playlistId ??
              "",
            ).trim();

          if (!playlistId) {
            return null;
          }

          const pinRef =
            getPlaylistDownloadPinRef(
              normalizedOwnerKey,
              playlistId,
            );

          const matchingRecords =
            (
              Array.isArray(
                job.trackKeys,
              )
                ? job.trackKeys
                : []
            )
              .map(
                (key) => {
                  const exact =
                    recordByKey.get(
                      key,
                    );

                  if (
                    exact &&
                    getMediaPinReferences(
                      exact,
                    ).includes(
                      pinRef,
                    )
                  ) {
                    return exact;
                  }

                  const parts =
                    mediaKeyParts(
                      key,
                    );

                  if (!parts) {
                    return null;
                  }

                  return (
                    recordsByTrackId
                      .get(
                        parts.trackId,
                      )
                      ?.find(
                        (record) =>
                          getMediaPinReferences(
                            record,
                          ).includes(
                            pinRef,
                          ),
                      ) ??
                    null
                  );
                },
              )
              .filter(Boolean);

          const tracks =
            await Promise.all(
              matchingRecords.map(
                (record) =>
                  downloadedTrackFromRecord(
                    record,
                    serviceWorkerControlled,
                    online,
                  ),
              ),
            );

          if (
            tracks.length === 0
          ) {
            return null;
          }

          return {
            id:
              playlistId,
            title:
              job.playlistTitle ??
              "Downloaded playlist",
            description:
              job.playlistDescription ??
              null,
            artwork_url:
              tracks[0]
                ?.artwork_url ??
              (
                online
                  ? job.playlistArtworkUrl ??
                    null
                  : null
              ),
            owner_username:
              job.playlistOwnerUsername ??
              null,
            visibility:
              job.playlistVisibility ??
              "downloaded",
            track_count:
              tracks.length,
            total_duration_seconds:
              tracks.reduce(
                (total, track) =>
                  total +
                  (
                    Number(
                      track.duration_seconds,
                    ) || 0
                  ),
                0,
              ),
            tracks,
            downloaded:
              true,
            is_offline_download:
              true,
          };
        },
      ),
    );

  return playlists.filter(
    Boolean,
  );
}


export async function removePlaylistFromOffline(
  playlistId,
  ownerKey,
) {
  const normalizedPlaylistId =
    String(
      playlistId ?? "",
    ).trim();

  const normalizedOwnerKey =
    normalizeOwnerKey(
      ownerKey,
    );

  if (
    !normalizedPlaylistId ||
    !normalizedOwnerKey
  ) {
    return false;
  }

  const jobs =
    await getDownloadJobs();

  const targetJob =
    jobs.find(
      (job) =>
        String(
          job?.ownerKey ??
          "",
        ) ===
          normalizedOwnerKey &&
        String(
          job?.playlistId ??
          "",
        ) ===
          normalizedPlaylistId,
    ) ?? null;

  if (!targetJob) {
    return false;
  }

  const pinRef =
    getPlaylistDownloadPinRef(
      normalizedOwnerKey,
      normalizedPlaylistId,
    );

  for (
    const key
    of Array.isArray(
      targetJob.trackKeys,
    )
      ? targetJob.trackKeys
      : []
  ) {
    const record =
      await resolvePinnedRecordForKey(
        key,
        pinRef,
      );

    if (!record) {
      continue;
    }

    await removeDownloadedMedia(
      record.trackId,
      record.mediaVersion,
      pinRef,
    );
  }

  await deleteDownloadJob(
    targetJob.id,
  );

  return true;
}


export async function searchDownloadedTracks(
  query,
  ownerKey,
) {
  const normalizedQuery =
    String(query ?? "")
      .trim()
      .toLocaleLowerCase();

  if (!normalizedQuery) {
    return [];
  }

  const tracks =
    await getDownloadedTracks(
      ownerKey,
    );

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
    pinRef = null,
  } = {},
) {
  const {
    trackId,
    mediaVersion,
  } =
    trackIdentity(
      track,
    );

  const normalizedPinRef =
    String(
      pinRef ?? "",
    ).trim();

  if (!normalizedPinRef) {
    throw new Error(
      "Offline downloads require an account-scoped owner.",
    );
  }

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

  const existingPinRefs =
    getMediaPinReferences(
      record,
    );

  const artworkSourceUrl =
    track.artwork_url ??
    track.artworkUrl ??
    null;

  const artworkVersion =
    artwork?.artworkVersion ??
    artworkVersionFromTrack(
      track,
    );

  let pinnedRecord = {
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
      artwork
        ? getOfflineArtworkUrl(
            trackId,
            artworkVersion,
          )
        : null,

    artworkSourceUrl,

    artworkVersion:
      artworkVersion ??
      null,

    artworkCached:
      Boolean(
        artwork,
      ),

    artworkRetryAfter:
      artwork ||
      !artworkSourceUrl
        ? null
        : Date.now() +
          OFFLINE_ARTWORK_RETRY_MS,

    artworkValidatedAt:
      artwork ||
      !artworkSourceUrl
        ? Date.now()
        : null,

    pinRefs: [
      ...existingPinRefs,
      ...(
        normalizedPinRef &&
        !existingPinRefs.includes(
          normalizedPinRef,
        )
          ? [
              normalizedPinRef,
            ]
          : []
      ),
    ],
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
      for (
        const existingPinRef
        of getMediaPinReferences(
          existing,
        )
      ) {
        await addMediaPinReference(
          trackId,
          mediaVersion,
          existingPinRef,
        );
      }

      await replaceDownloadJobMediaKey(
        existing.key,
        pinnedRecord.key,
      );

      await removeDownloadedMedia(
        existing.trackId,
        existing.mediaVersion,
      );
    }
  }

  pinnedRecord =
    await getMediaRecord(
      trackId,
      mediaVersion,
    ) ??
    pinnedRecord;

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
    jobMetadata = null,
    ownerKey = null,
  } = {},
) {
  const normalizedOwnerKey =
    normalizeOwnerKey(
      ownerKey ??
      jobMetadata?.ownerKey ??
      null,
    );

  if (!normalizedOwnerKey) {
    throw new Error(
      "Offline downloads require an account owner.",
    );
  }

  const playlistPinRef =
    jobMetadata?.kind ===
      "playlist"
      ? getPlaylistDownloadPinRef(
          normalizedOwnerKey,
          jobMetadata?.playlistId,
        )
      : null;

  if (
    jobMetadata?.kind ===
      "playlist" &&
    !playlistPinRef
  ) {
    throw new Error(
      "Playlist downloads require a playlist id.",
    );
  }

  const downloadPinRef =
    playlistPinRef ??
    getManualDownloadPinRef(
      normalizedOwnerKey,
    );

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
        {
          pinRef:
            downloadPinRef,
        },
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
          encodeURIComponent(
            normalizedOwnerKey ??
            "device",
          ) +
          ":" +
          Date.now()
        );

  const previousJob =
    (
      await getDownloadJobs()
    ).find(
      (job) =>
        String(
          job?.id ??
          "",
        ) ===
        normalizedJobId,
    ) ?? null;

  const normalizedJobMetadata =
    jobMetadata &&
    typeof jobMetadata ===
      "object"
      ? {
          kind:
            jobMetadata.kind ??
            null,

          playlistId:
            jobMetadata.playlistId ??
            null,

          playlistTitle:
            jobMetadata.playlistTitle ??
            null,

          playlistDescription:
            jobMetadata.playlistDescription ??
            null,

          playlistArtworkUrl:
            jobMetadata.playlistArtworkUrl ??
            null,

          playlistOwnerUsername:
            jobMetadata.playlistOwnerUsername ??
            null,

          playlistVisibility:
            jobMetadata.playlistVisibility ??
            null,

          ownerKey:
            normalizedOwnerKey,
        }
      : {};

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

    const trackProgress =
      Object.fromEntries(
        uniqueTracks.map(
          (track) => {
            const identity =
              trackIdentity(
                track,
              );

            const fileSize =
              trackFileSize(
                track,
              );

            const downloadedForTrack =
              progressByKey.get(
                identity.key,
              ) ??
              0;

            const progress =
              fileSize > 0
                ? Math.max(
                    0,
                    Math.min(
                      1,
                      downloadedForTrack /
                        fileSize,
                    ),
                  )
                : 0;

            return [
              identity.trackId,
              {
                status:
                  completedKeys.has(
                    identity.key,
                  )
                    ? "downloaded"
                    : progress > 0
                      ? "downloading"
                      : "queued",

                progress,
              },
            ];
          },
        ),
      );

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
      trackProgress,
    });
  };

  const releaseObsoletePlaylistPins =
    async () => {
      if (
        !playlistPinRef ||
        !Array.isArray(
          previousJob?.trackKeys,
        )
      ) {
        return;
      }

      const currentTrackIds =
        new Set(
          uniqueTracks.map(
            (track) =>
              trackIdentity(
                track,
              ).trackId,
          ),
        );

      for (
        const previousKey
        of previousJob.trackKeys
      ) {
        const parts =
          mediaKeyParts(
            previousKey,
          );

        if (
          !parts ||
          currentTrackIds.has(
            parts.trackId,
          )
        ) {
          continue;
        }

        const obsoleteRecord =
          await resolvePinnedRecordForKey(
            previousKey,
            playlistPinRef,
          );

        if (obsoleteRecord) {
          await removeDownloadedMedia(
            obsoleteRecord.trackId,
            obsoleteRecord.mediaVersion,
            playlistPinRef,
          );
        }
      }
    };

  await saveDownloadJob({
    id:
      normalizedJobId,
    ...normalizedJobMetadata,
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
    await releaseObsoletePlaylistPins();

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
            pinRef:
              downloadPinRef,
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

    await releaseObsoletePlaylistPins();

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


export async function reconcileDownloadedPlaylistMembership(
  playlist,
  ownerKey,
) {
  const normalizedOwnerKey =
    normalizeOwnerKey(
      ownerKey,
    );

  const playlistId =
    String(
      playlist?.id ??
      "",
    ).trim();

  if (
    !normalizedOwnerKey ||
    !playlistId
  ) {
    return false;
  }

  const job =
    await getPlaylistDownloadJob(
      normalizedOwnerKey,
      playlistId,
    );

  if (
    !job ||
    !Array.isArray(
      job.trackKeys,
    )
  ) {
    return false;
  }

  const liveTrackIds =
    new Set(
      (
        Array.isArray(
          playlist?.tracks,
        )
          ? playlist.tracks
          : []
      ).map(
        (track) =>
          String(
            track?.id ??
            "",
          ),
      ).filter(Boolean),
    );

  const pinRef =
    getPlaylistDownloadPinRef(
      normalizedOwnerKey,
      playlistId,
    );

  const retainedKeys =
    [];

  let changed =
    false;

  for (
    const key
    of job.trackKeys
  ) {
    const parts =
      mediaKeyParts(
        key,
      );

    if (
      parts &&
      liveTrackIds.has(
        parts.trackId,
      )
    ) {
      retainedKeys.push(
        key,
      );

      continue;
    }

    changed =
      true;

    const record =
      await resolvePinnedRecordForKey(
        key,
        pinRef,
      );

    if (record) {
      await removeDownloadedMedia(
        record.trackId,
        record.mediaVersion,
        pinRef,
      );
    }
  }

  if (changed) {
    await saveDownloadJob({
      ...job,
      trackKeys:
        retainedKeys,
    });
  }

  return changed;
}


export async function getPlaylistDownloadJob(
  ownerKey,
  playlistId,
) {
  const normalizedOwnerKey =
    normalizeOwnerKey(
      ownerKey,
    );
  const normalizedPlaylistId =
    String(
      playlistId ?? "",
    ).trim();

  if (
    !normalizedOwnerKey ||
    !normalizedPlaylistId
  ) {
    return null;
  }

  const jobs =
    await getDownloadJobs();

  return (
    jobs.find(
      (job) =>
        String(
          job?.ownerKey ??
          "",
        ) ===
          normalizedOwnerKey &&
        String(
          job?.playlistId ??
          "",
        ) ===
          normalizedPlaylistId,
    ) ?? null
  );
}


export async function cleanupLegacyUnscopedDownloads() {
  const [
    records,
    jobs,
  ] =
    await Promise.all([
      getPinnedMediaRecords(),
      getDownloadJobs(),
    ]);

  let removedMedia =
    0;

  let removedJobs =
    0;

  for (
    const record
    of records
  ) {
    if (
      getMediaPinReferences(
        record,
      ).length > 0
    ) {
      continue;
    }

    await removeDownloadedMedia(
      record.trackId,
      record.mediaVersion,
    );

    removedMedia +=
      1;
  }

  for (
    const job
    of jobs
  ) {
    if (
      normalizeOwnerKey(
        job?.ownerKey,
      )
    ) {
      continue;
    }

    await deleteDownloadJob(
      job.id,
    );

    removedJobs +=
      1;
  }

  return {
    removedMedia,
    removedJobs,
  };
}


export async function recoverInterruptedDownloadJobs(
  ownerKey,
) {
  const normalizedOwnerKey =
    normalizeOwnerKey(
      ownerKey,
    );

  if (!normalizedOwnerKey) {
    return 0;
  }

  const jobs =
    await getDownloadJobs();

  let recovered =
    0;

  for (
    const job
    of jobs
  ) {
    if (
      String(
        job?.ownerKey ??
        "",
      ) !==
        normalizedOwnerKey ||
      job?.state !==
        "downloading"
    ) {
      continue;
    }

    let downloadedBytes =
      0;

    for (
      const key
      of Array.isArray(
        job.trackKeys,
      )
        ? job.trackKeys
        : []
    ) {
      const parts =
        mediaKeyParts(
          key,
        );

      if (!parts) {
        continue;
      }

      const record =
        await getMediaRecord(
          parts.trackId,
          parts.mediaVersion,
        );

      const cachedBytes =
        Number(
          record?.cachedBytes ??
          0,
        );

      if (
        Number.isFinite(
          cachedBytes,
        ) &&
        cachedBytes > 0
      ) {
        downloadedBytes +=
          cachedBytes;
      }
    }

    const totalBytes =
      Number(
        job.totalBytes ??
        0,
      );

    await saveDownloadJob({
      ...job,
      state:
        "paused",
      downloadedBytes:
        Number.isFinite(
          totalBytes,
        ) &&
        totalBytes > 0
          ? Math.min(
              totalBytes,
              downloadedBytes,
            )
          : downloadedBytes,
      error:
        null,
    });

    recovered +=
      1;
  }

  return recovered;
}


export async function removeDownloadedTrackForOwner(
  track,
  ownerKey,
) {
  const normalizedOwnerKey =
    normalizeOwnerKey(
      ownerKey,
    );

  const {
    trackId,
    mediaVersion,
  } =
    trackIdentity(
      track,
    );

  const ownerPinPrefix =
    getOfflineOwnerPinPrefix(
      normalizedOwnerKey,
    );

  if (
    !normalizedOwnerKey ||
    !trackId ||
    !mediaVersion ||
    !ownerPinPrefix
  ) {
    return false;
  }

  const record =
    await getMediaRecord(
      trackId,
      mediaVersion,
    );

  if (
    record?.state !==
      "PINNED"
  ) {
    return false;
  }

  const ownerPinRefs =
    getMediaPinReferences(
      record,
    ).filter(
      (pinRef) =>
        String(
          pinRef,
        ).startsWith(
          ownerPinPrefix,
        ),
    );

  if (
    ownerPinRefs.length ===
      0
  ) {
    return false;
  }

  const jobs =
    await getDownloadJobs();

  const affectedJobs =
    jobs.filter(
      (job) => {
        if (
          String(
            job?.ownerKey ??
            "",
          ) !==
            normalizedOwnerKey
        ) {
          return false;
        }

        return (
          Array.isArray(
            job?.trackKeys,
          ) &&
          job.trackKeys.some(
            (key) =>
              mediaKeyParts(
                key,
              )?.trackId ===
              trackId,
          )
        );
      },
    );

  for (
    const pinRef
    of ownerPinRefs
  ) {
    await removeDownloadedMedia(
      trackId,
      mediaVersion,
      pinRef,
    );
  }

  for (
    const job
    of affectedJobs
  ) {
    const nextTrackKeys =
      (
        Array.isArray(
          job.trackKeys,
        )
          ? job.trackKeys
          : []
      ).filter(
        (key) =>
          mediaKeyParts(
            key,
          )?.trackId !==
            trackId,
      );

    let downloadedBytes =
      0;

    for (
      const key
      of nextTrackKeys
    ) {
      const parts =
        mediaKeyParts(
          key,
        );

      if (!parts) {
        continue;
      }

      const remainingRecord =
        await getMediaRecord(
          parts.trackId,
          parts.mediaVersion,
        );

      const cachedBytes =
        Number(
          remainingRecord
            ?.cachedBytes ??
          0,
        );

      if (
        Number.isFinite(
          cachedBytes,
        ) &&
        cachedBytes > 0
      ) {
        downloadedBytes +=
          cachedBytes;
      }
    }

    await saveDownloadJob({
      ...job,
      trackKeys:
        nextTrackKeys,
      downloadedBytes,
      state:
        job?.kind ===
          "playlist" &&
        job?.state ===
          "complete"
          ? "paused"
          : job?.state,
      error:
        null,
    });
  }

  return true;
}


export async function removeTrackFromOffline(
  track,
  ownerKey,
) {
  const {
    trackId,
    mediaVersion,
  } =
    trackIdentity(
      track,
    );

  const pinRef =
    getManualDownloadPinRef(
      ownerKey,
    );

  if (
    !trackId ||
    !mediaVersion ||
    !pinRef
  ) {
    return false;
  }

  return removeDownloadedMedia(
    trackId,
    mediaVersion,
    pinRef,
  );
}


export async function isTrackDownloaded(
  track,
  {
    pinRef = null,
    ownerKey = null,
  } = {},
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

  if (
    record?.state !==
      "PINNED"
  ) {
    return false;
  }

  const normalizedPinRef =
    String(
      pinRef ?? "",
    ).trim();

  if (normalizedPinRef) {
    return getMediaPinReferences(
      record,
    ).includes(
      normalizedPinRef,
    );
  }

  const normalizedOwnerKey =
    normalizeOwnerKey(
      ownerKey,
    );

  if (normalizedOwnerKey) {
    return recordBelongsToOwner(
      record,
      normalizedOwnerKey,
    );
  }

  return true;
}
