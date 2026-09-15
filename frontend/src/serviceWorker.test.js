import "fake-indexeddb/auto";

import assert from "node:assert/strict";
import test from "node:test";

async function loadServiceWorkerModule() {
  return import(
    `./serviceWorker.js?test=${Date.now()}-${Math.random()}`
  );
}

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
  "open-ended media request is served lazily through bounded cache chunks",
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
      "open-ended-track";

    const mediaVersion =
      "open-ended-version";

    const fileSize =
      chunkSize * 2;

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

          let byteStart =
            0;

          let byteEnd =
            fileSize - 1;

          const boundedMatch =
            /^bytes=(\d+)-(\d+)$/.exec(
              rangeHeader ?? "",
            );

          if (boundedMatch) {
            byteStart =
              Number(
                boundedMatch[1],
              );

            byteEnd =
              Number(
                boundedMatch[2],
              );
          }

          const bytes =
            new Uint8Array(
              byteEnd -
                byteStart +
                1,
            );

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

    assert.deepEqual(
      requestedRanges,
      [],
    );

    const reader =
      response.body.getReader();

    const first =
      await reader.read();

    assert.equal(
      first.done,
      false,
    );

    assert.equal(
      first.value.byteLength,
      chunkSize,
    );

    assert.deepEqual(
      requestedRanges,
      [
        `bytes=0-${chunkSize - 1}`,
      ],
    );

    const second =
      await reader.read();

    assert.equal(
      second.done,
      false,
    );

    assert.equal(
      second.value.byteLength,
      chunkSize,
    );

    assert.deepEqual(
      requestedRanges,
      [
        `bytes=0-${chunkSize - 1}`,
        `bytes=${chunkSize}-${fileSize - 1}`,
      ],
    );

    const finished =
      await reader.read();

    assert.equal(
      finished.done,
      true,
    );

    const firstStoredChunk =
      await mediaStore.getMediaChunk(
        trackId,
        mediaVersion,
        0,
      );

    const secondStoredChunk =
      await mediaStore.getMediaChunk(
        trackId,
        mediaVersion,
        1,
      );

    assert.ok(
      firstStoredChunk,
    );

    assert.ok(
      secondStoredChunk,
    );
  },
);
