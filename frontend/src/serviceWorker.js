import {
  getMediaRecord,
  MEDIA_CHUNK_SIZE,
} from "./mediaStore.js";

import {
  createCachedMediaRangeResponse,
} from "./mediaCacheResponse.js";

import {
  cacheNetworkMediaResponse,
} from "./mediaNetworkCache.js";

import {
  createMediaRangeStreamResponse,
} from "./mediaStreamResponse.js";

const MEDIA_ROUTE_PREFIX =
  "/__hypersync/media/";

const DEFAULT_API_BASE_URL =
  import.meta.env
    ?.VITE_API_BASE_URL ??
  "/api";
function parseMediaRoute(
  request,
) {
  const url =
    new URL(
      request.url,
    );

  if (
    !url.pathname.startsWith(
      MEDIA_ROUTE_PREFIX,
    )
  ) {
    return null;
  }

  const routeValue =
    url.pathname.slice(
      MEDIA_ROUTE_PREFIX.length,
    );

  const parts =
    routeValue.split(
      "/",
    );

  if (
    parts.length !== 2 ||
    !parts[0] ||
    !parts[1]
  ) {
    return null;
  }

  return {
    trackId:
      decodeURIComponent(
        parts[0],
      ),
    mediaVersion:
      decodeURIComponent(
        parts[1],
      ),
  };
}

function createNetworkMediaRequest(
  request,
  trackId,
  apiBaseUrl,
) {
  const normalizedApiBaseUrl =
    String(
      apiBaseUrl,
    ).replace(
      /\/+$/,
      "",
    );

  const networkUrl =
    new URL(
      `${normalizedApiBaseUrl}/audio/${encodeURIComponent(
        trackId,
      )}`,
      request.url,
    );

  return new Request(
    networkUrl,
    {
      method:
        request.method,
      headers:
        request.headers,
      credentials:
        request.credentials,
      cache:
        request.cache,
      redirect:
        request.redirect,
      referrer:
        request.referrer,
      referrerPolicy:
        request.referrerPolicy,
      integrity:
        request.integrity,
      keepalive:
        request.keepalive,
      signal:
        request.signal,
    },
  );
}

function getCacheableNetworkRange(
  rangeHeader,
  fileSize,
) {
  const match =
    /^bytes=(\d+)-(\d+)$/.exec(
      rangeHeader ?? "",
    );

  if (!match) {
    return null;
  }

  const byteStart =
    Number(
      match[1],
    );

  const requestedByteEnd =
    Number(
      match[2],
    );

  if (
    !Number.isSafeInteger(
      fileSize,
    ) ||
    fileSize <= 0 ||
    !Number.isSafeInteger(
      byteStart,
    ) ||
    !Number.isSafeInteger(
      requestedByteEnd,
    ) ||
    byteStart >= fileSize ||
    requestedByteEnd <
      byteStart
  ) {
    return null;
  }

  const byteEnd =
    Math.min(
      requestedByteEnd,
      fileSize - 1,
    );

  if (
    byteStart %
      MEDIA_CHUNK_SIZE !==
    0
  ) {
    return null;
  }

  const endsAtChunkBoundary =
    (
      byteEnd + 1
    ) %
      MEDIA_CHUNK_SIZE ===
    0;

  const endsAtFileEnd =
    byteEnd ===
    fileSize - 1;

  if (
    !endsAtChunkBoundary &&
    !endsAtFileEnd
  ) {
    return null;
  }

  return {
    byteStart,
    byteEnd,
  };
}

export async function handleMediaRequest(
  request,
  networkFallback,
  apiBaseUrl =
    DEFAULT_API_BASE_URL,
  scheduleBackgroundTask =
    null,
) {
  const identity =
    parseMediaRoute(
      request,
    );

  if (!identity) {
    return networkFallback(
      request,
    );
  }

  const networkRequest =
    createNetworkMediaRequest(
      request,
      identity.trackId,
      apiBaseUrl,
    );

  const mediaRecord =
    await getMediaRecord(
      identity.trackId,
      identity.mediaVersion,
    );

  if (!mediaRecord) {
    return networkFallback(
      networkRequest,
    );
  }

  const rangeHeader =
    request.headers.get(
      "Range",
    );

  const openEndedRangeMatch =
    /^bytes=(\d+)-$/.exec(
      rangeHeader ?? "",
    );

  if (
    openEndedRangeMatch &&
    Number.isSafeInteger(
      mediaRecord.fileSize,
    ) &&
    mediaRecord.fileSize > 0
  ) {
    const byteStart =
      Number(
        openEndedRangeMatch[1],
      );

    if (
      Number.isSafeInteger(
        byteStart,
      ) &&
      byteStart >= 0 &&
      byteStart <
        mediaRecord.fileSize
    ) {
      return createMediaRangeStreamResponse({
        trackId:
          identity.trackId,

        mediaVersion:
          identity.mediaVersion,

        byteStart,

        byteEnd:
          mediaRecord.fileSize -
          1,

        fileSize:
          mediaRecord.fileSize,

        mimeType:
          mediaRecord.mimeType ??
          "application/octet-stream",

        fetchChunk:
          async ({
            byteStart:
              chunkByteStart,
            byteEnd:
              chunkByteEnd,
          }) => {
            const headers =
              new Headers(
                networkRequest.headers,
              );

            headers.set(
              "Range",
              `bytes=${chunkByteStart}-${chunkByteEnd}`,
            );

            const chunkRequest =
              new Request(
                networkRequest,
                {
                  headers,
                },
              );

            return networkFallback(
              chunkRequest,
            );
          },
      });
    }
  }
  
  const response =
    await createCachedMediaRangeResponse({
      rangeHeader:
        request.headers.get(
          "Range",
        ),
      trackId:
        identity.trackId,
      mediaVersion:
        identity.mediaVersion,
      fileSize:
        mediaRecord.fileSize,
      mimeType:
        mediaRecord.mimeType,
    });

  if (response) {
    return response;
  }

  const networkResponse =
    await networkFallback(
      networkRequest,
    );

  const cacheableRange =
    getCacheableNetworkRange(
      request.headers.get(
        "Range",
      ),
      mediaRecord.fileSize,
    );

  if (
    cacheableRange &&
    networkResponse.status ===
      206 &&
    typeof scheduleBackgroundTask ===
      "function"
  ) {
    const cacheTask =
      cacheNetworkMediaResponse({
        response:
          networkResponse.clone(),
        trackId:
          identity.trackId,
        mediaVersion:
          identity.mediaVersion,
        byteStart:
          cacheableRange.byteStart,
        byteEnd:
          cacheableRange.byteEnd,
        fileSize:
          mediaRecord.fileSize,
      }).catch(
        () => 0,
      );

    scheduleBackgroundTask(
      cacheTask,
    );
  }

  return networkResponse;
}

export function registerMediaFetchHandler(
  scope,
  networkFallback,
) {
  scope.addEventListener(
    "fetch",
    (event) => {
      const identity =
        parseMediaRoute(
          event.request,
        );

      if (!identity) {
        return;
      }

      const backgroundTasks =
        [];

      const responsePromise =
        handleMediaRequest(
          event.request,
          networkFallback,
          DEFAULT_API_BASE_URL,
          (
            task,
          ) => {
            backgroundTasks.push(
              task,
            );
          },
        );

      const lifetimePromise =
        responsePromise.then(
          async () => {
            await Promise.all(
              backgroundTasks,
            );
          },
        );

      event.respondWith(
        responsePromise,
      );

      event.waitUntil(
        lifetimePromise,
      );
    },
  );
}

if (
  typeof globalThis.self !==
    "undefined" &&
  typeof globalThis.self
    .addEventListener ===
    "function"
) {
  registerMediaFetchHandler(
    globalThis.self,
    (request) =>
      fetch(
        request,
      ),
  );
}
