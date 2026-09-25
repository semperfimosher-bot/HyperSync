import {
  ensureMediaRecord,
  getCachedMediaRange,
  getMediaChunk,
  getMediaRecord,
  markMediaPlayed,
  markMediaWarm,
  MEDIA_CHUNK_SIZE,
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

async function isMediaRangeCached(
  trackId,
  mediaVersion,
  byteStart,
  byteEnd,
) {
  const firstChunk =
    Math.floor(
      byteStart /
      MEDIA_CHUNK_SIZE,
    );

  const lastChunk =
    Math.floor(
      byteEnd /
      MEDIA_CHUNK_SIZE,
    );

  for (
    let index =
      firstChunk;
    index <=
    lastChunk;
    index += 1
  ) {
    const chunk =
      await getMediaChunk(
        trackId,
        mediaVersion,
        index,
      ).catch(
        () => null,
      );

    if (!chunk) {
      return false;
    }
  }

  return true;
}


function wait(
  milliseconds,
) {
  return new Promise(
    (resolve) => {
      setTimeout(
        resolve,
        milliseconds,
      );
    },
  );
}


export const PLAYBACK_WARM_MS =
  2 *
  60 *
  60 *
  1000;

export const PLAYBACK_WARM_BYTES =
  MEDIA_CHUNK_SIZE *
  16;


export async function warmTrackPlayback(
  trackId,
  meta = {},
  {
    positionSeconds = 0,
    durationSeconds = null,
    useStableMediaRoute = false,
    fetchImpl =
      globalThis.fetch,
    now =
      Date.now(),
  } = {},
) {
  const mediaVersion =
    meta.mediaVersion ??
    meta.media_version ??
    null;

  const fileSize =
    Number(
      meta.fileSize ??
      meta.file_size ??
      null,
    );

  const duration =
    Number(
      durationSeconds ??
      meta.durationSeconds ??
      meta.duration_seconds ??
      null,
    );

  if (
    !mediaVersion ||
    !Number.isSafeInteger(
      fileSize,
    ) ||
    fileSize <= 0
  ) {
    return {
      warmed:
        false,

      reason:
        "metadata",
    };
  }

  const record =
    await ensureMediaRecord({
      trackId,
      mediaVersion,
      mimeType:
        meta.mimeType ??
        meta.mime_type ??
        null,
      fileSize,
    });

  const safePosition =
    Math.max(
      Number(
        positionSeconds,
      ) || 0,
      0,
    );

  const estimatedByte =
    Number.isFinite(
      duration,
    ) &&
    duration > 0
      ? Math.min(
          fileSize - 1,
          Math.max(
            0,
            Math.floor(
              (
                safePosition /
                duration
              ) *
              fileSize,
            ),
          ),
        )
      : 0;

  let byteStart =
    Math.floor(
      estimatedByte /
      MEDIA_CHUNK_SIZE,
    ) *
    MEDIA_CHUNK_SIZE;

  /*
   * Keep one chunk behind the estimated
   * pause point and a large runway ahead.
   * That absorbs VBR estimation error and
   * gives resume enough cached audio for
   * the network to catch up invisibly.
   */
  byteStart =
    Math.max(
      0,
      byteStart -
        MEDIA_CHUNK_SIZE,
    );

  const byteEnd =
    Math.min(
      fileSize - 1,
      byteStart +
        PLAYBACK_WARM_BYTES -
        1,
    );

  const warmUntil =
    now +
    PLAYBACK_WARM_MS;

  const existingWarmCoversRange =
    Number.isSafeInteger(
      record?.warmUntil,
    ) &&
    record.warmUntil >
      now &&
    Number.isSafeInteger(
      record?.warmByteStart,
    ) &&
    Number.isSafeInteger(
      record?.warmByteEnd,
    ) &&
    record.warmByteStart <=
      byteStart &&
    record.warmByteEnd >=
      byteEnd;

  if (existingWarmCoversRange) {
    return {
      warmed:
        true,

      cached:
        true,

      byteStart,
      byteEnd,
      warmUntil:
        record.warmUntil,
    };
  }

  let cached =
    await isMediaRangeCached(
      trackId,
      mediaVersion,
      byteStart,
      byteEnd,
    );

  if (
    !cached &&
    useStableMediaRoute &&
    typeof fetchImpl ===
      "function"
  ) {
    const url =
      "/__hypersync/media/" +
      encodeURIComponent(
        String(
          trackId,
        ),
      ) +
      "/" +
      encodeURIComponent(
        String(
          mediaVersion,
        ),
      );

    try {
      const response =
        await fetchImpl(
          url,
          {
            method:
              "GET",

            headers: {
              Range:
                "bytes=" +
                byteStart +
                "-" +
                byteEnd,
            },

            credentials:
              "include",

            cache:
              "no-store",
          },
        );

      if (
        response?.ok ||
        response?.status ===
          206
      ) {
        /*
         * Fully consume the response so
         * the service worker can finish
         * persisting every warm chunk.
         */
        await response
          .arrayBuffer();

        /*
         * The worker persists its cloned
         * response in event.waitUntil().
         * Give that short background write
         * time to finish, then verify the
         * exact chunk window really exists.
         */
        for (
          let attempt =
            0;
          attempt <
            20 &&
          !cached;
          attempt +=
            1
        ) {
          cached =
            await isMediaRangeCached(
              trackId,
              mediaVersion,
              byteStart,
              byteEnd,
            );

          if (!cached) {
            await wait(
              100,
            );
          }
        }
      }
    } catch {
      /*
       * Warmup is opportunistic. The
       * normal player must keep working
       * even when a background prefetch
       * cannot complete.
       */
    }
  }

  if (!cached) {
    return {
      warmed:
        false,

      cached:
        false,

      reason:
        useStableMediaRoute
          ? "cache"
          : "service-worker",

      byteStart,
      byteEnd,
      warmUntil:
        null,
    };
  }

  await markMediaWarm(
    trackId,
    mediaVersion,
    {
      warmUntil,
      byteStart,
      byteEnd,
    },
  ).catch(
    () => null,
  );

  return {
    warmed:
      true,

    cached:
      true,

    byteStart,
    byteEnd,
    warmUntil,
  };
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
