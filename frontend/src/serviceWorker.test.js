import "fake-indexeddb/auto";

import assert from "node:assert/strict";
import test from "node:test";

async function loadServiceWorkerModule() {
  return import(
    `./serviceWorker.js?test=${Date.now()}-${Math.random()}`
  );
}

test(
  "navigation timeout bounds a stalled preload and serves the cached app shell",
  async () => {
    const serviceWorker = await loadServiceWorkerModule();
    const cachedShell = new Response("cached app shell");
    let cacheWrites = 0;
    let fallbackFetches = 0;

    const response = await serviceWorker.fetchNavigationWithFallback({
      request: new Request("https://example.test/library"),
      preloadResponse: new Promise(() => {}),
      cache: {
        async match() {
          return cachedShell.clone();
        },
        async put() {
          cacheWrites += 1;
        },
      },
      fetchLike: async () => {
        fallbackFetches += 1;
        throw new Error("The unresolved preload should time out first.");
      },
      timeoutMs: 10,
    });

    assert.equal(await response.text(), "cached app shell");
    assert.equal(cacheWrites, 0);
    assert.equal(fallbackFetches, 0);
  },
);

test(
  "navigation falls back to the cached shell on HTTP 503 and preserves fresh responses when cache writes fail",
  async () => {
    const serviceWorker = await loadServiceWorkerModule();
    const cache = {
      async match() {
        return new Response("cached app shell");
      },
      async put() {
        throw new Error("Storage quota is unavailable.");
      },
    };

    const fallback = await serviceWorker.fetchNavigationWithFallback({
      request: new Request("https://example.test/library"),
      preloadResponse: Promise.resolve(
        new Response("upstream unavailable", { status: 503 }),
      ),
      cache,
      timeoutMs: 100,
    });
    assert.equal(await fallback.text(), "cached app shell");

    const fresh = await serviceWorker.fetchNavigationWithFallback({
      request: new Request("https://example.test/library"),
      preloadResponse: Promise.resolve(
        new Response("fresh page html", { status: 200 }),
      ),
      cache,
      timeoutMs: 100,
    });
    assert.equal(fresh.status, 200);
    assert.equal(await fresh.text(), "fresh page html");
  },
);

test(
  "service worker precaches dynamic page chunks without forcing activation over open clients",
  async () => {
    const listeners = new Map();
    const entries = new Map();
    const origin = "https://example.test";
    const hadSelf = Object.prototype.hasOwnProperty.call(globalThis, "self");
    const oldSelf = globalThis.self;
    const hadCaches = Object.prototype.hasOwnProperty.call(globalThis, "caches");
    const oldCaches = globalThis.caches;
    const hadFetch = Object.prototype.hasOwnProperty.call(globalThis, "fetch");
    const oldFetch = globalThis.fetch;
    let skipWaitingCalls = 0;

    const cacheKey = (request) => {
      const value = typeof request === "string" ? request : request.url;
      return new URL(value, origin).href;
    };
    const cache = {
      async put(request, response) {
        entries.set(cacheKey(request), response.clone());
      },
      async match(request) {
        return entries.get(cacheKey(request))?.clone();
      },
    };

    globalThis.self = {
      location: { origin },
      addEventListener(type, listener) {
        const current = listeners.get(type) ?? [];
        current.push(listener);
        listeners.set(type, current);
      },
      async skipWaiting() {
        skipWaitingCalls += 1;
      },
    };
    globalThis.caches = {
      async open(name) {
        assert.equal(name, "hypersync-app-shell-v4");
        return cache;
      },
      async keys() {
        return ["hypersync-app-shell-v4"];
      },
    };
    globalThis.fetch = async (request) => {
      const url = new URL(
        typeof request === "string" ? request : request.url,
        origin,
      );
      if (url.pathname === "/") {
        return new Response(
          '<html><script type="module" src="/assets/app-current.js"></script>' +
            '<link rel="stylesheet" href="/assets/app-current.css"></html>',
          { headers: { "Content-Type": "text/html" } },
        );
      }
      if (url.pathname === "/manifest.json") {
        return new Response(
          JSON.stringify({
            "index.html": {
              file: "assets/app-current.js",
              isEntry: true,
              css: ["assets/app-current.css"],
            },
            "src/components/pages/LibraryPage.jsx": {
              file: "assets/LibraryPage-current.js",
              isDynamicEntry: true,
            },
            "src/shared.js": {
              file: "assets/shared-current.js",
            },
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(
        "cached " + url.pathname,
        { headers: { "Content-Type": url.pathname.endsWith(".css") ? "text/css" : "text/javascript" } },
      );
    };

    try {
      await loadServiceWorkerModule();
      const installListener = (listeners.get("install") ?? [])[0];
      assert.equal(typeof installListener, "function");

      let installPromise = null;
      installListener({
        waitUntil(promise) {
          installPromise = Promise.resolve(promise);
        },
      });
      assert.ok(installPromise instanceof Promise);
      await installPromise;

      assert.equal(skipWaitingCalls, 0);
      assert.ok(entries.has("https://example.test/"));
      assert.ok(entries.has("https://example.test/assets/app-current.js"));
      assert.ok(entries.has("https://example.test/assets/app-current.css"));
      assert.ok(entries.has("https://example.test/assets/LibraryPage-current.js"));
      assert.ok(entries.has("https://example.test/assets/shared-current.js"));
    } finally {
      if (hadSelf) globalThis.self = oldSelf;
      else delete globalThis.self;
      if (hadCaches) globalThis.caches = oldCaches;
      else delete globalThis.caches;
      if (hadFetch) globalThis.fetch = oldFetch;
      else delete globalThis.fetch;
    }
  },
);

test(
  "Vite manifest precache list includes dynamic pages but rejects foreign and non-code assets",
  async () => {
    const serviceWorker = await loadServiceWorkerModule();
    const urls = serviceWorker.collectBuildAssetUrls(
      {
        "src/main.jsx": {
          file: "assets/app-main.js",
          css: ["assets/app.css"],
          assets: ["assets/interface.woff2"],
        },
        "src/components/pages/LibraryPage.jsx": {
          file: "assets/LibraryPage-abc123.js",
          isDynamicEntry: true,
          imports: ["src/shared.js"],
        },
        "src/duplicate.js": {
          file: "assets/app-main.js",
        },
        "src/external.js": {
          file: "https://cdn.example.test/external.js",
        },
        "src/metadata.json": {
          file: "assets/metadata.json",
        },
      },
      "https://example.test",
    );

    assert.deepEqual(
      urls.sort(),
      [
        "https://example.test/assets/LibraryPage-abc123.js",
        "https://example.test/assets/app-main.js",
        "https://example.test/assets/app.css",
        "https://example.test/assets/interface.woff2",
      ].sort(),
    );
  },
);

test(
  "service worker media handler serves a cached range from the stable media route",
  async () => {
    const mediaStore =
      await import(
        "./mediaStore.js"
      );

    const serviceWorker =
      await loadServiceWorkerModule();

    assert.equal(
      typeof serviceWorker.handleMediaRequest,
      "function",
    );

    const trackId =
      "service-worker-track";

    const mediaVersion =
      "service-worker-version";

    const bytes =
      new Uint8Array([
        0xaa,
        0xbb,
        0xcc,
        0xdd,
        0xee,
        0xff,
        0x11,
        0x22,
      ]);

    const record =
      mediaStore.createMediaRecord({
        trackId,
        mediaVersion,
        mimeType:
          "audio/mpeg",
        fileSize:
          bytes.byteLength,
        state:
          "NONE",
      });

    await mediaStore.saveMediaRecord(
      record,
    );

    await mediaStore.saveMediaChunk({
      trackId,
      mediaVersion,
      chunkIndex:
        0,
      byteStart:
        0,
      data:
        bytes.buffer,
    });

    const request =
      new Request(
        `https://example.test/__hypersync/media/${trackId}/${mediaVersion}`,
        {
          headers: {
            Range:
              "bytes=2-5",
          },
        },
      );

    let networkWasCalled =
      false;

    const response =
      await serviceWorker.handleMediaRequest(
        request,
        async () => {
          networkWasCalled =
            true;

          throw new Error(
            "Network fallback should not run for a complete cache hit.",
          );
        },
      );

    assert.equal(
      networkWasCalled,
      false,
    );

    assert.ok(
      response instanceof Response,
    );

    assert.equal(
      response.status,
      206,
    );

    assert.equal(
      response.headers.get(
        "Content-Range",
      ),
      "bytes 2-5/8",
    );

    assert.deepEqual(
      Array.from(
        new Uint8Array(
          await response.arrayBuffer(),
        ),
      ),
      [
        0xcc,
        0xdd,
        0xee,
        0xff,
      ],
    );
  },
);

test(
  "service worker media handler translates a cache miss to the audio API",
  async () => {
    const serviceWorker =
      await loadServiceWorkerModule();

    const request =
      new Request(
        "https://example.test/__hypersync/media/network-track/network-version",
        {
          headers: {
            Range:
              "bytes=262144-524287",
          },
        },
      );

    let fallbackRequest =
      null;

    const fallbackResponse =
      new Response(
        new Uint8Array([
          0x01,
        ]),
        {
          status: 206,
        },
      );

    const response =
      await serviceWorker.handleMediaRequest(
        request,
        async (
          requestToFetch,
        ) => {
          fallbackRequest =
            requestToFetch;

          return fallbackResponse;
        },
      );

    assert.equal(
      response,
      fallbackResponse,
    );

    assert.ok(
      fallbackRequest instanceof
        Request,
    );

    assert.equal(
      fallbackRequest.url,
      "https://example.test/api/audio/network-track",
    );

    assert.equal(
      fallbackRequest.method,
      "GET",
    );

    assert.equal(
      fallbackRequest.headers.get(
        "Range",
      ),
      "bytes=262144-524287",
    );
  },
);

test(
  "service worker fetch listener intercepts only stable media routes",
  async () => {
    const serviceWorker =
      await loadServiceWorkerModule();

    assert.equal(
      typeof serviceWorker.registerMediaFetchHandler,
      "function",
    );

    const listeners =
      new Map();

    const scope = {
      addEventListener(
        eventType,
        listener,
      ) {
        listeners.set(
          eventType,
          listener,
        );
      },
    };

    let fallbackRequest =
      null;

    serviceWorker.registerMediaFetchHandler(
      scope,
      async (
        request,
      ) => {
        fallbackRequest =
          request;

        return new Response(
          new Uint8Array([
            0xaa,
          ]),
          {
            status: 206,
          },
        );
      },
    );

    const fetchListener =
      listeners.get(
        "fetch",
      );

    assert.equal(
      typeof fetchListener,
      "function",
    );

    let ordinaryRespondWithCalled =
      false;

    fetchListener({
      request:
        new Request(
          "https://example.test/assets/app.js",
        ),
      respondWith() {
        ordinaryRespondWithCalled =
          true;
      },
    });

    assert.equal(
      ordinaryRespondWithCalled,
      false,
    );

    let mediaResponsePromise =
      null;

    fetchListener({
      request:
        new Request(
          "https://example.test/__hypersync/media/listener-track/listener-version",
          {
            headers: {
              Range:
                "bytes=0-0",
            },
          },
        ),
      respondWith(
        responsePromise,
      ) {
        mediaResponsePromise =
          responsePromise;
      },
      waitUntil() {
        // This test verifies
        // routing only.
      },
    });

    assert.ok(
      mediaResponsePromise instanceof
        Promise,
    );

    const response =
      await mediaResponsePromise;

    assert.equal(
      response.status,
      206,
    );

    assert.ok(
      fallbackRequest instanceof
        Request,
    );

    assert.equal(
      fallbackRequest.url,
      "https://example.test/api/audio/listener-track",
    );
  },
);

test(
  "service worker module automatically registers its fetch listener in worker scope",
  async () => {
    const listeners =
      new Map();

    const hadSelf =
      Object.prototype.hasOwnProperty.call(
        globalThis,
        "self",
      );

    const originalSelf =
      globalThis.self;

    globalThis.self = {
      addEventListener(
        eventType,
        listener,
      ) {
        listeners.set(
          eventType,
          listener,
        );
      },
    };

    try {
      await loadServiceWorkerModule();

      assert.equal(
        typeof listeners.get(
          "fetch",
        ),
        "function",
      );
    } finally {
      if (hadSelf) {
        globalThis.self =
          originalSelf;
      } else {
        delete globalThis.self;
      }
    }
  },
);

test(
  "service worker reuses safe same-origin precached module assets with Vary Origin while offline",
  async () => {
    const listeners = new Map();
    const hadSelf = Object.prototype.hasOwnProperty.call(globalThis, "self");
    const oldSelf = globalThis.self;
    const hadCaches = Object.prototype.hasOwnProperty.call(globalThis, "caches");
    const oldCaches = globalThis.caches;
    const oldFetch = globalThis.fetch;
    const hadFetch = Object.prototype.hasOwnProperty.call(globalThis, "fetch");
    let networkCalls = 0;
    const matchCalls = [];
    const cachedResponse = new Response(
      "cached dynamic page module",
      {
        headers: {
          "Content-Type": "text/javascript",
          "Vary": "Origin",
        },
      },
    );

    const cache = {
      async match(request, options) {
        matchCalls.push({
          url: typeof request === "string" ? request : request.url,
          ignoreVary: options?.ignoreVary === true,
        });
        if (options?.ignoreVary) {
          return cachedResponse.clone();
        }
        return undefined;
      },
      async put() {},
    };

    globalThis.self = {
      location: {
        origin: "https://example.test",
      },
      addEventListener(type, listener) {
        const existing = listeners.get(type) ?? [];
        existing.push(listener);
        listeners.set(type, existing);
      },
    };
    globalThis.caches = {
      async open(name) {
        assert.equal(name, "hypersync-app-shell-v4");
        return cache;
      },
    };
    globalThis.fetch = async () => {
      networkCalls += 1;
      throw new Error("Network should not be needed for precached assets.");
    };

    try {
      await loadServiceWorkerModule();
      const fetchListeners = listeners.get("fetch") ?? [];
      assert.ok(fetchListeners.length >= 2);

      let responsePromise = null;
      const event = {
        request: {
          url: "https://example.test/assets/SearchPage-abc123.js",
          method: "GET",
          mode: "cors",
          destination: "script",
        },
        respondWith(response) {
          responsePromise = Promise.resolve(response);
        },
      };

      for (const listener of fetchListeners) {
        listener(event);
      }

      assert.ok(responsePromise instanceof Promise);
      const response = await responsePromise;
      assert.equal(await response.text(), "cached dynamic page module");
      assert.equal(networkCalls, 0);
      assert.deepEqual(
        matchCalls.map((entry) => entry.ignoreVary),
        [false, true],
      );
    } finally {
      if (hadSelf) {
        globalThis.self = oldSelf;
      } else {
        delete globalThis.self;
      }
      if (hadCaches) {
        globalThis.caches = oldCaches;
      } else {
        delete globalThis.caches;
      }
      if (hadFetch) {
        globalThis.fetch = oldFetch;
      } else {
        delete globalThis.fetch;
      }
    }
  },
);

test(
  "service worker media handler uses the configured API base URL for cache misses",
  async () => {
    const serviceWorker =
      await loadServiceWorkerModule();

    const request =
      new Request(
        "https://hypersynced.app/__hypersync/media/api-base-track/api-base-version",
        {
          headers: {
            Range:
              "bytes=0-255",
          },
        },
      );

    let fallbackRequest =
      null;

    const response =
      await serviceWorker.handleMediaRequest(
        request,
        async (
          requestToFetch,
        ) => {
          fallbackRequest =
            requestToFetch;

          return new Response(
            new Uint8Array([
              0xaa,
            ]),
            {
              status: 206,
            },
          );
        },
        "https://api.hypersynced.app/api",
      );

    assert.equal(
      response.status,
      206,
    );

    assert.ok(
      fallbackRequest instanceof
        Request,
    );

    assert.equal(
      fallbackRequest.url,
      "https://api.hypersynced.app/api/audio/api-base-track",
    );

    assert.equal(
      fallbackRequest.headers.get(
        "Range",
      ),
      "bytes=0-255",
    );
  },
);

test(
  "service worker cache miss schedules a bounded network range for persistent storage",
  async () => {
    const mediaStore =
      await import(
        "./mediaStore.js"
      );

    const serviceWorker =
      await loadServiceWorkerModule();

    const chunkSize =
      mediaStore.MEDIA_CHUNK_SIZE;

    const trackId =
      "network-fill-track";

    const mediaVersion =
      "network-fill-version";

    const fileSize =
      chunkSize * 2;

    const record =
      mediaStore.createMediaRecord({
        trackId,
        mediaVersion,
        mimeType:
          "audio/mpeg",
        fileSize,
        state:
          "NONE",
      });

    await mediaStore.saveMediaRecord(
      record,
    );

    const bytes =
      new Uint8Array(
        chunkSize,
      );

    bytes[0] =
      0xaa;

    bytes[
      chunkSize - 1
    ] =
      0xbb;

    const request =
      new Request(
        `https://example.test/__hypersync/media/${trackId}/${mediaVersion}`,
        {
          headers: {
            Range:
              `bytes=0-${chunkSize - 1}`,
          },
        },
      );

    const backgroundTasks =
      [];

    const response =
      await serviceWorker.handleMediaRequest(
        request,
        async () =>
          new Response(
            bytes,
            {
              status:
                206,
              headers: {
                "Content-Length":
                  String(
                    bytes.byteLength,
                  ),
                "Content-Range":
                  `bytes 0-${chunkSize - 1}/${fileSize}`,
                "Content-Type":
                  "audio/mpeg",
              },
            },
          ),
        "/api",
        (
          task,
        ) => {
          backgroundTasks.push(
            task,
          );
        },
      );

    assert.equal(
      response.status,
      206,
    );

    assert.equal(
      backgroundTasks.length,
      1,
    );

    await Promise.all(
      backgroundTasks,
    );

    const chunk =
      await mediaStore.getMediaChunk(
        trackId,
        mediaVersion,
        0,
      );

    assert.ok(
      chunk,
    );

    assert.equal(
      chunk.byteLength,
      chunkSize,
    );

    const cachedBytes =
      new Uint8Array(
        chunk.data,
      );

    assert.equal(
      cachedBytes[0],
      0xaa,
    );

    assert.equal(
      cachedBytes[
        chunkSize - 1
      ],
      0xbb,
    );

    assert.deepEqual(
      Array.from(
        new Uint8Array(
          await response.arrayBuffer(),
        ),
      ),
      Array.from(
        bytes,
      ),
    );
  },
);

test(
  "service worker fetch listener keeps background cache fill alive with waitUntil",
  async () => {
    const mediaStore =
      await import(
        "./mediaStore.js"
      );

    const serviceWorker =
      await loadServiceWorkerModule();

    const chunkSize =
      mediaStore.MEDIA_CHUNK_SIZE;

    const trackId =
      "wait-until-track";

    const mediaVersion =
      "wait-until-version";

    const fileSize =
      chunkSize * 2;

    const record =
      mediaStore.createMediaRecord({
        trackId,
        mediaVersion,
        mimeType:
          "audio/mpeg",
        fileSize,
        state:
          "NONE",
      });

    await mediaStore.saveMediaRecord(
      record,
    );

    const bytes =
      new Uint8Array(
        chunkSize,
      );

    bytes[0] =
      0x11;

    bytes[
      chunkSize - 1
    ] =
      0x22;

    let fetchHandler =
      null;

    const scope = {
      addEventListener(
        type,
        handler,
      ) {
        if (
          type ===
          "fetch"
        ) {
          fetchHandler =
            handler;
        }
      },
    };

    serviceWorker.registerMediaFetchHandler(
      scope,
      async () =>
        new Response(
          bytes,
          {
            status:
              206,
            headers: {
              "Content-Length":
                String(
                  bytes.byteLength,
                ),
              "Content-Range":
                `bytes 0-${chunkSize - 1}/${fileSize}`,
              "Content-Type":
                "audio/mpeg",
            },
          },
        ),
    );

    assert.equal(
      typeof fetchHandler,
      "function",
    );

    let responsePromise =
      null;

    const lifetimePromises =
      [];

    const event = {
      request:
        new Request(
          `https://example.test/__hypersync/media/${trackId}/${mediaVersion}`,
          {
            headers: {
              Range:
                `bytes=0-${chunkSize - 1}`,
            },
          },
        ),

      respondWith(
        promise,
      ) {
        responsePromise =
          Promise.resolve(
            promise,
          );
      },

      waitUntil(
        promise,
      ) {
        lifetimePromises.push(
          Promise.resolve(
            promise,
          ),
        );
      },
    };

    fetchHandler(
      event,
    );

    assert.ok(
      responsePromise,
    );

    assert.equal(
      lifetimePromises.length,
      1,
    );

    const response =
      await responsePromise;

    assert.equal(
      response.status,
      206,
    );

    await Promise.all(
      lifetimePromises,
    );

    const chunk =
      await mediaStore.getMediaChunk(
        trackId,
        mediaVersion,
        0,
      );

    assert.ok(
      chunk,
    );

    assert.equal(
      chunk.byteLength,
      chunkSize,
    );

    const cachedBytes =
      new Uint8Array(
        chunk.data,
      );

    assert.equal(
      cachedBytes[0],
      0x11,
    );

    assert.equal(
      cachedBytes[
        chunkSize - 1
      ],
      0x22,
    );
  },
);

test(
  "open-ended cold media request coalesces cache chunks into bounded network windows",
  async () => {
    const mediaStore =
      await import(
        "./mediaStore.js"
      );

    const serviceWorker =
      await loadServiceWorkerModule();

    const chunkSize =
      mediaStore.MEDIA_CHUNK_SIZE;

    /*
     * Persistent storage remains
     * 256 KiB per chunk.
     *
     * Cold network transfer should
     * coalesce 8 of those chunks into
     * one 2 MiB request.
     */
    const networkWindowSize =
      chunkSize * 8;

    const trackId =
      "windowed-cold-track";

    const mediaVersion =
      "windowed-cold-version";

    /*
     * Ten cache chunks total:
     *
     * first network window:
     * chunks 0 through 7
     *
     * second network window:
     * chunks 8 through 9
     */
    const fileSize =
      chunkSize * 10;

    await mediaStore.saveMediaRecord(
      mediaStore.createMediaRecord({
        trackId,
        mediaVersion,
        mimeType:
          "audio/mpeg",
        fileSize,
        state:
          "NONE",
      }),
    );

    const requestedRanges =
      [];

    const request =
      new Request(
        `https://example.test/__hypersync/media/${trackId}/${mediaVersion}`,
        {
          headers: {
            Range:
              "bytes=0-",
          },
        },
      );

    const response =
      await serviceWorker.handleMediaRequest(
        request,

        async (
          networkRequest,
        ) => {
          const rangeHeader =
            networkRequest.headers.get(
              "Range",
            );

          requestedRanges.push(
            rangeHeader,
          );

          const boundedMatch =
            /^bytes=(\d+)-(\d+)$/.exec(
              rangeHeader ?? "",
            );

          assert.ok(
            boundedMatch,
            "cold media network requests must use bounded byte ranges",
          );

          const byteStart =
            Number(
              boundedMatch[1],
            );

          const byteEnd =
            Number(
              boundedMatch[2],
            );

          const bytes =
            new Uint8Array(
              byteEnd -
                byteStart +
                1,
            );

          /*
           * Fill each network window
           * differently so we can later
           * prove that both windows made
           * it through correctly.
           */
          bytes.fill(
            requestedRanges.length,
          );

          return new Response(
            bytes,
            {
              status:
                206,

              headers: {
                "Content-Length":
                  String(
                    bytes.byteLength,
                  ),

                "Content-Range":
                  `bytes ${byteStart}-${byteEnd}/${fileSize}`,

                "Content-Type":
                  "audio/mpeg",
              },
            },
          );
        },

        "/api",
      );

    assert.equal(
      response.status,
      206,
    );

    /*
     * Streaming is lazy:
     * merely creating the response
     * should not start network IO.
     */
    assert.deepEqual(
      requestedRanges,
      [],
    );

    const streamedBytes =
      new Uint8Array(
        await response.arrayBuffer(),
      );

    assert.equal(
      streamedBytes.byteLength,
      fileSize,
    );

    /*
     * Ten cache chunks should require
     * only TWO physical network requests.
     */
    assert.deepEqual(
      requestedRanges,
      [
        `bytes=0-${
          networkWindowSize - 1
        }`,

        `bytes=${networkWindowSize}-${
          fileSize - 1
        }`,
      ],
    );

    /*
     * First network window was filled
     * with 0x01.
     */
    assert.equal(
      streamedBytes[0],
      0x01,
    );

    assert.equal(
      streamedBytes[
        networkWindowSize - 1
      ],
      0x01,
    );

    /*
     * Second network window was filled
     * with 0x02.
     */
    assert.equal(
      streamedBytes[
        networkWindowSize
      ],
      0x02,
    );

    assert.equal(
      streamedBytes[
        fileSize - 1
      ],
      0x02,
    );

    /*
     * The larger NETWORK requests must
     * still be split back into our
     * normal 256 KiB persistent chunks.
     */
    for (
      let chunkIndex = 0;
      chunkIndex < 10;
      chunkIndex += 1
    ) {
      const storedChunk =
        await mediaStore.getMediaChunk(
          trackId,
          mediaVersion,
          chunkIndex,
        );

      assert.ok(
        storedChunk,
        `cache chunk ${chunkIndex} should be persisted`,
      );

      assert.equal(
        storedChunk.byteLength,
        chunkSize,
      );
    }

    const firstStoredChunk =
      await mediaStore.getMediaChunk(
        trackId,
        mediaVersion,
        0,
      );

    const eighthStoredChunk =
      await mediaStore.getMediaChunk(
        trackId,
        mediaVersion,
        7,
      );

    const ninthStoredChunk =
      await mediaStore.getMediaChunk(
        trackId,
        mediaVersion,
        8,
      );

    assert.equal(
      new Uint8Array(
        firstStoredChunk.data,
      )[0],
      0x01,
    );

    assert.equal(
      new Uint8Array(
        eighthStoredChunk.data,
      )[0],
      0x01,
    );

    assert.equal(
      new Uint8Array(
        ninthStoredChunk.data,
      )[0],
      0x02,
    );
  },
);

test(
  "service worker serves downloaded artwork without the network",
  async () => {
    const mediaStore =
      await import(
        "./mediaStore.js"
      );

    const serviceWorker =
      await loadServiceWorkerModule();

    await mediaStore.saveArtwork({
      trackId:
        "offline-art-track",
      data:
        new Uint8Array([
          1,
          2,
          3,
          4,
        ]).buffer,
      mimeType:
        "image/webp",
    });

    let networkCalled =
      false;

    const response =
      await serviceWorker.handleArtworkRequest(
        new Request(
          "https://example.test/__hypersync/artwork/offline-art-track",
        ),
        async () => {
          networkCalled =
            true;

          throw new Error(
            "Artwork should come from IndexedDB.",
          );
        },
      );

    assert.equal(
      networkCalled,
      false,
    );

    assert.equal(
      response.status,
      200,
    );

    assert.equal(
      response.headers.get(
        "Content-Type",
      ),
      "image/webp",
    );

    assert.equal(
      response.headers.get(
        "Cache-Control",
      ),
      "private, no-store",
    );

    assert.deepEqual(
      Array.from(
        new Uint8Array(
          await response.arrayBuffer(),
        ),
      ),
      [
        1,
        2,
        3,
        4,
      ],
    );
  },
);


test(
  "service worker marks versioned offline artwork immutable",
  async () => {
    const mediaStore =
      await import(
        "./mediaStore.js"
      );

    const serviceWorker =
      await loadServiceWorkerModule();

    await mediaStore.saveArtwork({
      trackId:
        "versioned-offline-art-track",
      data:
        new Uint8Array([
          7,
          8,
          9,
        ]).buffer,
      mimeType:
        "image/png",
      artworkVersion:
        "art-version-1",
    });

    const response =
      await serviceWorker.handleArtworkRequest(
        new Request(
          "https://example.test/__hypersync/artwork/versioned-offline-art-track?v=art-version-1",
        ),
        async () => {
          throw new Error(
            "Versioned artwork should come from IndexedDB.",
          );
        },
      );

    assert.equal(
      response.status,
      200,
    );

    assert.equal(
      response.headers.get(
        "Cache-Control",
      ),
      "private, max-age=31536000, immutable",
    );
  },
);
