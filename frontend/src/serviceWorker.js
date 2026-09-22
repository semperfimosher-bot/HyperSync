import {
  getArtwork,
  getMediaRecord,
  MEDIA_CHUNK_SIZE,
  saveArtwork,
} from "./mediaStore.js";

import {
  createCachedMediaRangeResponse,
} from "./mediaCacheResponse.js";

import {
  cacheNetworkMediaResponse,
} from "./mediaNetworkCache.js";

import {
  createMediaRangeStreamResponse,
  MEDIA_NETWORK_WINDOW_SIZE,
} from "./mediaStreamResponse.js";

const MEDIA_ROUTE_PREFIX =
  "/__hypersync/media/";

const ARTWORK_ROUTE_PREFIX =
  "/__hypersync/artwork/";

const DEFAULT_API_BASE_URL =
  import.meta.env
    ?.VITE_API_BASE_URL ??
  "/api";
const APP_SHELL_CACHE =
  "hypersync-app-shell-v2";

const MAX_CACHED_ARTWORK_BYTES =
  12 * 1024 * 1024;


async function precacheAppShell() {
  const cache =
    await caches.open(
      APP_SHELL_CACHE,
    );

  const response =
    await fetch(
      "/",
      {
        cache:
          "no-cache",
      },
    );

  if (!response.ok) {
    return;
  }

  /*
   * Save index.html.
   */
  await cache.put(
    "/",
    response.clone(),
  );

  /*
   * Find the hashed Vite JS/CSS files
   * referenced by index.html and cache
   * those too.
   */
  const html =
    await response.text();

  const matches =
    [
      ...html.matchAll(
        /(?:src|href)=["']([^"']+)["']/g,
      ),
    ];

  const assetUrls =
    [
      ...new Set(
        [
          ...matches.map(
            (match) =>
              match[1],
          ),
          "/site.webmanifest",
          "/favicon.svg",
          "/apple-touch-icon.png",
          "/icon-192.png",
          "/icon-512.png",
        ]
          .filter(
            (value) =>
              value &&
              !value.startsWith(
                "data:",
              ),
          )
          .map(
            (value) =>
              new URL(
                value,
                self.location.origin,
              ),
          )
          .filter(
            (url) =>
              url.origin ===
              self.location.origin,
          )
          .map(
            (url) =>
              url.href,
          ),
      ),
    ];

  await Promise.allSettled(
    assetUrls.map(
      async (url) => {
        const assetResponse =
          await fetch(
            url,
            {
              cache:
                "no-cache",
            },
          );

        if (
          assetResponse.ok
        ) {
          await cache.put(
            url,
            assetResponse,
          );
        }
      },
    ),
  );
}


self.addEventListener(
  "install",
  (event) => {
    event.waitUntil(
      (
        async () => {
          await precacheAppShell();

          await self.skipWaiting();
        }
      )(),
    );
  },
);


self.addEventListener(
  "activate",
  (event) => {
    event.waitUntil(
      (
        async () => {
          const keys =
            await caches.keys();

          await Promise.all(
            keys
              .filter(
                (key) =>
                  key.startsWith(
                    "hypersync-app-shell-",
                  ) &&
                  key !==
                    APP_SHELL_CACHE,
              )
              .map(
                (key) =>
                  caches.delete(
                    key,
                  ),
              ),
          );

          await self.clients.claim();
        }
      )(),
    );
  },
);

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

function parseArtworkRoute(
  request,
) {
  const url =
    new URL(
      request.url,
    );

  if (
    !url.pathname.startsWith(
      ARTWORK_ROUTE_PREFIX,
    )
  ) {
    return null;
  }

  const trackId =
    url.pathname.slice(
      ARTWORK_ROUTE_PREFIX.length,
    );

  if (!trackId) {
    return null;
  }

  return decodeURIComponent(
    trackId,
  );
}


function createNetworkArtworkRequest(
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
      normalizedApiBaseUrl +
        "/catalog/tracks/" +
        encodeURIComponent(
          trackId,
        ) +
        "/artwork",
      request.url,
    );

  return new Request(
    networkUrl,
    {
      method: "GET",
      credentials: "include",
      cache: "no-cache",
    },
  );
}


export async function handleArtworkRequest(
  request,
  networkFallback,
  apiBaseUrl =
    DEFAULT_API_BASE_URL,
  scheduleBackgroundTask =
    null,
) {
  const trackId =
    parseArtworkRoute(
      request,
    );

  if (!trackId) {
    return networkFallback(
      request,
    );
  }

  const cached =
    await getArtwork(
      trackId,
    );

  if (
    cached?.data instanceof
      ArrayBuffer &&
    cached.data.byteLength > 0
  ) {
    return new Response(
      cached.data.slice(0),
      {
        status: 200,
        headers: {
          "Content-Type":
            cached.mimeType ??
            "image/jpeg",
          "Content-Length":
            String(
              cached.data.byteLength,
            ),
          "Cache-Control":
            "private, max-age=31536000, immutable",
        },
      },
    );
  }

  const networkRequest =
    createNetworkArtworkRequest(
      request,
      trackId,
      apiBaseUrl,
    );

  const response =
    await networkFallback(
      networkRequest,
    );

  if (
    response.ok &&
    typeof scheduleBackgroundTask ===
      "function"
  ) {
    const contentLength =
      Number(
        response.headers.get(
          "Content-Length",
        ),
      );

    if (
      !Number.isFinite(
        contentLength,
      ) ||
      contentLength <=
        MAX_CACHED_ARTWORK_BYTES
    ) {
      const task =
        response
          .clone()
          .arrayBuffer()
          .then(
            (data) => {
              if (
                data.byteLength <= 0 ||
                data.byteLength >
                  MAX_CACHED_ARTWORK_BYTES
              ) {
                return null;
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
                  networkRequest.url,
              });
            },
          )
          .catch(
            () => null,
          );

      scheduleBackgroundTask(
        task,
      );
    }
  }

  return response;
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

        networkWindowSize:
          MEDIA_NETWORK_WINDOW_SIZE,

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

      const artworkTrackId =
        parseArtworkRoute(
          event.request,
        );

      if (
        !identity &&
        !artworkTrackId
      ) {
        return;
      }

      const backgroundTasks =
        [];

      const scheduleTask =
        (
          task,
        ) => {
          backgroundTasks.push(
            task,
          );
        };

      const responsePromise =
        identity
          ? handleMediaRequest(
              event.request,
              networkFallback,
              DEFAULT_API_BASE_URL,
              scheduleTask,
            )
          : handleArtworkRequest(
              event.request,
              networkFallback,
              DEFAULT_API_BASE_URL,
              scheduleTask,
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

self.addEventListener(
  "fetch",
  (event) => {
    const request =
      event.request;

    if (
      request.method !==
      "GET"
    ) {
      return;
    }

    const url =
      new URL(
        request.url,
      );

    /*
     * Only handle the frontend here.
     *
     * Media is already handled by the
     * existing HyperSync media handler.
     */
    if (
      url.origin !==
        self.location.origin ||
      url.pathname.startsWith(
        MEDIA_ROUTE_PREFIX,
      ) ||
      url.pathname.startsWith(
        ARTWORK_ROUTE_PREFIX,
      ) ||
      url.pathname.startsWith(
        "/api/",
      )
    ) {
      return;
    }


    /*
     * SPA navigation:
     *
     * Try the newest page while online.
     * If offline, return cached index.html.
     */
    if (
      request.mode ===
      "navigate"
    ) {
      event.respondWith(
        (
          async () => {
            const cache =
              await caches.open(
                APP_SHELL_CACHE,
              );

            try {
              const response =
                await fetch(
                  request,
                );

              if (
                response.ok
              ) {
                await cache.put(
                  "/",
                  response.clone(),
                );
              }

              return response;
            } catch {
              const cached =
                await cache.match(
                  "/",
                );

              if (cached) {
                return cached;
              }

              return new Response(
                "HyperSync is offline.",
                {
                  status: 503,

                  headers: {
                    "Content-Type":
                      "text/plain",
                  },
                },
              );
            }
          }
        )(),
      );

      return;
    }


    /*
     * Static frontend files.
     */
    if (
      [
        "script",
        "style",
        "font",
        "image",
        "manifest",
      ].includes(
        request.destination,
      )
    ) {
      event.respondWith(
        (
          async () => {
            const cache =
              await caches.open(
                APP_SHELL_CACHE,
              );

            const cached =
              await cache.match(
                request,
              );

            if (cached) {
              return cached;
            }

            const response =
              await fetch(
                request,
              );

            if (
              response.ok
            ) {
              await cache.put(
                request,
                response.clone(),
              );
            }

            return response;
          }
        )(),
      );
    }
  },
);

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
