import {
  clearAllMediaDatabases,
  cleanupExpiredMedia,
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
  "hypersync-app-shell-v3";

const MAX_CACHED_ARTWORK_BYTES =
  12 * 1024 * 1024;

const NAVIGATION_NETWORK_TIMEOUT_MS =
  3500;

const MEDIA_CLEANUP_INTERVAL_MS =
  6 * 60 * 60 * 1000;

let lastMediaCleanupAt =
  0;


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
          "/hypersync-home-hero.png",
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


globalThis.self?.addEventListener?.(
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


async function clearAllWorkerCaches() {
  const keys =
    await caches.keys();

  await Promise.allSettled(
    keys.map(
      (key) =>
        caches.delete(
          key,
        ),
    ),
  );

  return keys;
}


globalThis.self?.addEventListener?.(
  "message",
  (event) => {
    const type =
      event.data?.type;

    if (
      type ===
      "HYPERSYNC_PREPARE_OFFLINE_APP"
    ) {
      const requestId =
        event.data?.requestId ??
        null;

      event.waitUntil(
        (
          async () => {
            let ok =
              true;

            try {
              await precacheAppShell();
            } catch {
              ok =
                false;
            }

            event.source?.postMessage?.({
              type:
                "HYPERSYNC_PREPARE_OFFLINE_APP_COMPLETE",

              requestId,

              ok,
            });
          }
        )(),
      );

      return;
    }

    if (
      type !==
      "HYPERSYNC_CLEAR_ALL_CLIENT_DATA"
    ) {
      return;
    }

    event.waitUntil(
      (
        async () => {
          await clearAllMediaDatabases()
            .catch(
              () => [],
            );

          await clearAllWorkerCaches()
            .catch(
              () => [],
            );

          event.source?.postMessage?.({
            type:
              "HYPERSYNC_CLEAR_ALL_CLIENT_DATA_COMPLETE",
          });
        }
      )(),
    );
  },
);


globalThis.self?.addEventListener?.(
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

          await cleanupExpiredMedia()
            .catch(
              () => 0,
            );

          if (
            self.registration
              .navigationPreload
          ) {
            await self.registration
              .navigationPreload
              .enable()
              .catch(
                () => {},
              );
          }

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

  return {
    trackId:
      decodeURIComponent(
        trackId,
      ),
    artworkVersion:
      url.searchParams.get(
        "v",
      ),
  };
}


function createNetworkArtworkRequest(
  request,
  identity,
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
          identity.trackId,
        ) +
        "/artwork",
      request.url,
    );

  if (identity.artworkVersion) {
    networkUrl.searchParams.set(
      "v",
      identity.artworkVersion,
    );
  }

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
  const identity =
    parseArtworkRoute(
      request,
    );

  if (!identity) {
    return networkFallback(
      request,
    );
  }

  const cached =
    await getArtwork(
      identity.trackId,
    );

  const versionMatches =
    !identity.artworkVersion ||
    cached?.artworkVersion ===
      identity.artworkVersion;

  if (
    versionMatches &&
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
            identity.artworkVersion
              ? "private, max-age=31536000, immutable"
              : "private, no-store",
        },
      },
    );
  }

  const networkRequest =
    createNetworkArtworkRequest(
      request,
      identity,
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
                trackId:
                  identity.trackId,
                data,
                mimeType:
                  response.headers.get(
                    "Content-Type",
                  ) ??
                  "image/jpeg",
                sourceUrl:
                  networkRequest.url,
                artworkVersion:
                  identity.artworkVersion,
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

      const artworkIdentity =
        parseArtworkRoute(
          event.request,
        );

      if (
        !identity &&
        !artworkIdentity
      ) {
        return;
      }

      const backgroundTasks =
        [];

      const now =
        Date.now();

      if (
        now - lastMediaCleanupAt >=
          MEDIA_CLEANUP_INTERVAL_MS
      ) {
        lastMediaCleanupAt =
          now;

        backgroundTasks.push(
          cleanupExpiredMedia(
            now,
          ).catch(
            () => 0,
          ),
        );
      }

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

globalThis.self?.addEventListener?.(
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

            const controller =
              new AbortController();

            const timeoutId =
              setTimeout(
                () => {
                  controller.abort();
                },
                NAVIGATION_NETWORK_TIMEOUT_MS,
              );

            try {
              const preloaded =
                await event
                  .preloadResponse;

              const response =
                preloaded ??
                await fetch(
                  new Request(
                    request,
                    {
                      signal:
                        controller.signal,
                    },
                  ),
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
            } finally {
              clearTimeout(
                timeoutId,
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

globalThis.self?.addEventListener?.(
  "push",
  (event) => {
    let payload = {};

    try {
      payload =
        event.data?.json?.() ??
        {};
    } catch {
      payload = {};
    }

    const username =
      String(
        payload.username ??
        "",
      ).trim();

    const title =
      String(
        payload.title ??
        "HyperSync",
      );

    const body =
      String(
        payload.body ??
        "You have a new notification.",
      );

    event.waitUntil(
      self.registration
        .showNotification(
          title,
          {
            body,
            icon:
              "/icon-192.png",
            badge:
              "/icon-192.png",
            tag:
              username
                ? (
                    "hypersync-message-" +
                    username
                  )
                : "hypersync-notification",
            renotify:
              true,
            data: {
              username,
              url:
                String(
                  payload.url ??
                  "/",
                ),
            },
          },
        ),
    );
  },
);


globalThis.self?.addEventListener?.(
  "notificationclick",
  (event) => {
    event.notification
      ?.close?.();

    const username =
      String(
        event.notification
          ?.data
          ?.username ??
        "",
      ).trim();

    const requestedUrl =
      new URL(
        String(
          event.notification
            ?.data
            ?.url ??
          "/",
        ),
        self.location.origin,
      );

    const targetUrl =
      requestedUrl.origin ===
        self.location.origin
        ? requestedUrl
        : new URL(
            "/",
            self.location.origin,
          );

    event.waitUntil(
      (
        async () => {
          const windows =
            await self.clients
              .matchAll({
                type:
                  "window",
                includeUncontrolled:
                  true,
              });

          for (
            const client
            of windows
          ) {
            if (
              new URL(
                client.url,
              ).origin !==
              self.location.origin
            ) {
              continue;
            }

            await client.focus();

            client.postMessage({
              type:
                "HYPERSYNC_OPEN_MESSAGE",
              username,
            });

            return;
          }

          await self.clients
            .openWindow(
              targetUrl.href,
            );
        }
      )(),
    );
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
