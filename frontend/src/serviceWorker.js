import { matchAppShell } from "./appShellCache.js";
import { readBoundedResponse } from "./boundedResponse.js";
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
const BUILD_MANIFEST = globalThis.__HYPERSYNC_BUILD_MANIFEST__ ?? null;
const APP_SHELL_CACHE = BUILD_MANIFEST
  ? `hypersync-app-shell-${BUILD_MANIFEST.revision}`
  : "hypersync-app-shell-v3";

const MAX_CACHED_ARTWORK_BYTES =
  12 * 1024 * 1024;

const NAVIGATION_NETWORK_TIMEOUT_MS =
  3500;

const MEDIA_CLEANUP_INTERVAL_MS =
  6 * 60 * 60 * 1000;

let lastMediaCleanupAt =
  0;


async function fetchShellResource(url, consume) {
  const controller = new AbortController();
  let timeout;
  let resource;
  try {
    return await Promise.race([
      (async () => {
        const asset = await fetch(url, { cache: "no-cache", signal: controller.signal });
        resource = asset;
        if (!asset.ok) throw new Error(`App shell asset unavailable: ${url}`);
        return consume(asset, controller.signal);
      })(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          void resource?.body?.cancel().catch(() => {});
          reject(new Error("App shell asset timed out."));
        }, 10000);
      }),
    ]);
  } finally { clearTimeout(timeout); }
}

function cacheShellAsset(cache, url) {
  return fetchShellResource(url, (asset) => cache.put(url, asset));
}

async function matchRetainedShellAsset(cache, request) {
  const current = cache
    ? await matchAppShell(cache, request, self.location.origin).catch(() => undefined)
    : undefined;
  if (current) return current;
  if (!/\/assets\/[^/]+-[\w-]+\.(?:m?js|css)$/.test(new URL(request.url).pathname)) return undefined;
  const keys = await caches.keys().catch(() => []);
  for (const key of keys.reverse()) {
    if (key === APP_SHELL_CACHE || !key.startsWith("hypersync-app-shell-")) continue;
    const retained = await caches.open(key).catch(() => null);
    const match = retained
      ? await matchAppShell(retained, request, self.location.origin).catch(() => undefined)
      : undefined;
    if (match) return match;
  }
  return undefined;
}

async function precacheAppShell(navigationResponse = null) {
  const cache = await caches.open(APP_SHELL_CACHE);
  const readDocument = async (response, signal) => {
    if (!response.ok) throw new Error("App shell is unavailable.");
    return { response, html: new TextDecoder().decode(await readBoundedResponse(response.clone(), 1024 * 1024, { signal })) };
  };
  const { response, html } = navigationResponse
    ? await readDocument(navigationResponse)
    : await fetchShellResource("/", readDocument);
  if (BUILD_MANIFEST && !html.includes(`content="${BUILD_MANIFEST.revision}"`)) {
    throw new Error("Navigation belongs to a different application build.");
  }
  const referencedUrls = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
    .map((match) => match[1]);
  const assetUrls = [...new Set([
    ...(BUILD_MANIFEST?.assets ?? []),
    ...referencedUrls,
    "/site.webmanifest",
    "/favicon.svg",
    "/apple-touch-icon.png",
    "/icon-192.png",
    "/icon-512.png",
    "/hypersync-home-hero.png",
  ].filter((value) => value && !value.startsWith("data:"))
    .map((value) => new URL(value, self.location.origin))
    .filter((url) => url.origin === self.location.origin)
    .map((url) => url.href))];

  // Scripts/styles are required for a usable shell. Optional artwork must not
  // prevent installation, but a failed bundle must never replace working HTML.
  const results = [];
  let nextAsset = 0;
  await Promise.all(Array.from({ length: Math.min(4, assetUrls.length) }, async () => {
    while (nextAsset < assetUrls.length) {
      const index = nextAsset++;
      const url = assetUrls[index];
      try {
        if (!(/\/assets\/[^/]+-[\w-]+\.(?:m?js|css)$/.test(new URL(url).pathname)
            && await matchAppShell(cache, new Request(url), self.location.origin).catch(() => undefined))) {
          await cacheShellAsset(cache, url);
        }
        results[index] = { status: "fulfilled" };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }));
  for (let index = 0; index < results.length; index += 1) {
    if (/\.(?:m?js|css)$/.test(new URL(assetUrls[index]).pathname)
        && results[index].status === "rejected") {
      throw results[index].reason;
    }
  }
  // Publish the entry point only after its required assets are safely stored.
  await cache.put("/", response);
}

globalThis.self?.addEventListener?.(
  "install",
  (event) => {
    event.waitUntil(
      (
        async () => {
          try {
            await precacheAppShell();
            await self.skipWaiting();
          } catch (error) {
            try {
              const cache = await caches.open(APP_SHELL_CACHE);
              if (!await cache.match("/")) await caches.delete?.(APP_SHELL_CACHE);
            } catch { /* Preserve the original install failure. */ }
            throw error;
          }
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

          // Keep one complete prior generation for tabs still executing its
          // modules. Failed installs without an entry point do not consume it.
          const activationKey = "/__hypersync/shell-activation";
          const shells = keys.filter((key) => key.startsWith("hypersync-app-shell-"));
          let previous = null;
          let previousOrder = -1;
          let maxOrder = 0;
          for (const [index, key] of shells.entries()) {
            const cache = await caches.open(key);
            if (!await cache.match("/")) continue;
            const stamp = await cache.match(activationKey);
            const order = Number((await stamp?.json().catch(() => null))?.order) || index + 1;
            maxOrder = Math.max(maxOrder, order);
            if (key !== APP_SHELL_CACHE && order > previousOrder) { previous = key; previousOrder = order; }
          }
          await (await caches.open(APP_SHELL_CACHE)).put(activationKey, Response.json({ order: Math.max(Date.now(), maxOrder + 1) }));
          await Promise.all(shells.filter((key) => key !== APP_SHELL_CACHE && key !== previous).map((key) => caches.delete(key)));

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
        readBoundedResponse(response.clone(), MAX_CACHED_ARTWORK_BYTES)
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
            // Cache storage is optional; a storage failure must not break online use.
            const cache = await caches.open(APP_SHELL_CACHE).catch(() => null);
            const controller = new AbortController();
            let timeoutId;
            const deadline = new Promise((_, reject) => {
              timeoutId = setTimeout(() => {
                controller.abort();
                reject(new Error("Navigation timed out."));
              }, NAVIGATION_NETWORK_TIMEOUT_MS);
            });
            const cachedShell = () => cache
              ? cache.match("/").catch(() => undefined)
              : Promise.resolve(undefined);

            try {
              // Aborting fetch alone does not settle a stalled preload promise.
              const response = await Promise.race([
                (async () => {
                  const preloaded = await Promise.resolve(event.preloadResponse)
                    .catch(() => undefined);
                  const document = preloaded ?? await fetch(new Request(request, {
                    signal: controller.signal,
                  }));
                  if (!document.ok) return document;
                  const body = await readBoundedResponse(document, 1024 * 1024, { signal: controller.signal });
                  const headers = new Headers(document.headers);
                  headers.delete("Content-Encoding");
                  headers.set("Content-Length", String(body.byteLength));
                  return new Response(body, { status: document.status, statusText: document.statusText, headers });
                })(),
                deadline,
              ]);
              if (!response.ok) {
                return (await cachedShell()) ?? response;
              }
              if (cache) {
                // Keep the previous offline entry point until the new bundles
                // are stored. Cache work must not delay a working online page.
                event.waitUntil(precacheAppShell(response.clone()).catch(() => {}));
              }
              return response;
            } catch {
              return (await cachedShell()) ?? new Response(
                "HyperSynced is offline.",
                { status: 503, headers: { "Content-Type": "text/plain" } },
              );
            } finally {
              clearTimeout(timeoutId);
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
            const cache = await caches.open(APP_SHELL_CACHE).catch(() => null);
            const cached = await matchRetainedShellAsset(cache, request);
            if (cached) return cached;

            const response = await fetch(request);
            if (response.ok && cache) {
              await cache.put(request, response.clone()).catch(() => {});
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
        "HyperSynced",
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
