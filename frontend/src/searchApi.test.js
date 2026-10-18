import assert from "node:assert/strict";
import test from "node:test";

const localStorageValues =
  new Map();

if (typeof globalThis.localStorage === "undefined") {
  globalThis.localStorage = {
    getItem(key) {
      return localStorageValues.get(key) ?? null;
    },
    setItem(key, value) {
      localStorageValues.set(key, String(value));
    },
    removeItem(key) {
      localStorageValues.delete(key);
    },
    clear() {
      localStorageValues.clear();
    },
  };
}

function setCachedProfile(id, username = id) {
  globalThis.localStorage.setItem(
    "hypersync_user_profile",
    JSON.stringify({
      id,
      username,
      account_type: "registered",
    }),
  );
}

async function loadSearchApi() {
  return import(
    `./searchApi.js?test=${Date.now()}-${Math.random()}`
  );
}

function responseFor(value) {
  return new Response(
    JSON.stringify(value),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    },
  );
}

function waitForTurn() {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}


test(
  "concurrent identical searches share one fetch and abort independently",
  async (t) => {
    globalThis.localStorage.clear?.();
    setCachedProfile("search-dedupe-user");

    const api =
      await loadSearchApi();

    let fetchCount = 0;
    let requestSignal = null;
    let resolveResponse;

    const pendingResponse =
      new Promise((resolve) => {
        resolveResponse = resolve;
      });

    t.mock.method(
      globalThis,
      "fetch",
      async (_url, options) => {
        fetchCount += 1;
        requestSignal = options.signal;
        return pendingResponse;
      },
    );

    const firstController =
      new AbortController();
    const secondController =
      new AbortController();

    const first =
      api.searchHypersync(
        "ambient electronic",
        "smart",
        {
          signal: firstController.signal,
        },
      );

    const second =
      api.searchHypersync(
        "ambient electronic",
        "smart",
        {
          signal: secondController.signal,
        },
      );

    await waitForTurn();

    assert.equal(fetchCount, 1);

    firstController.abort();

    await assert.rejects(
      first,
      {
        name: "AbortError",
      },
    );

    assert.equal(
      requestSignal.aborted,
      false,
      "one caller cancelling must not cancel the shared transport for another caller",
    );

    const result = {
      query: "ambient electronic",
      tracks: [{ id: "shared-result" }],
    };

    resolveResponse(
      responseFor(result),
    );

    assert.deepEqual(
      await second,
      result,
    );
  },
);


test(
  "aborting every caller cancels and removes the shared in-flight search",
  async (t) => {
    globalThis.localStorage.clear?.();
    setCachedProfile("search-abort-user");

    const api =
      await loadSearchApi();

    let fetchCount = 0;
    let requestSignal = null;

    t.mock.method(
      globalThis,
      "fetch",
      (_url, options) =>
        new Promise(
          (
            _resolve,
            reject,
          ) => {
            fetchCount += 1;
            requestSignal = options.signal;

            const rejectAbort = () => {
              reject(
                new DOMException(
                  "The fetch was aborted.",
                  "AbortError",
                ),
              );
            };

            if (options.signal?.aborted) {
              rejectAbort();
              return;
            }

            options.signal?.addEventListener(
              "abort",
              rejectAbort,
              {
                once: true,
              },
            );
          },
        ),
    );

    const firstController =
      new AbortController();
    const secondController =
      new AbortController();

    const first =
      api.searchHypersync(
        "slow query",
        "smart",
        {
          signal: firstController.signal,
        },
      );

    const second =
      api.searchHypersync(
        "slow query",
        "smart",
        {
          signal: secondController.signal,
        },
      );

    await waitForTurn();

    assert.equal(fetchCount, 1);

    firstController.abort();
    secondController.abort();

    await Promise.all([
      assert.rejects(first, { name: "AbortError" }),
      assert.rejects(second, { name: "AbortError" }),
    ]);

    assert.equal(
      requestSignal.aborted,
      true,
    );

    const replacementController =
      new AbortController();

    const replacement =
      api.searchHypersync(
        "slow query",
        "smart",
        {
          signal: replacementController.signal,
        },
      );

    await waitForTurn();

    assert.equal(
      fetchCount,
      2,
      "a later search must not join the already-aborted transport",
    );

    replacementController.abort();

    await assert.rejects(
      replacement,
      {
        name: "AbortError",
      },
    );
  },
);


test(
  "personalized search caches are isolated by account",
  async (t) => {
    globalThis.localStorage.clear?.();
    setCachedProfile("search-cache-user-a");

    const api =
      await loadSearchApi();

    let fetchCount = 0;

    t.mock.method(
      globalThis,
      "fetch",
      async () => {
        fetchCount += 1;

        return responseFor({
          fetchNumber: fetchCount,
        });
      },
    );

    const first =
      await api.searchHypersync(
        "my most played",
        "smart",
      );

    setCachedProfile("search-cache-user-b");

    const second =
      await api.searchHypersync(
        "my most played",
        "smart",
      );

    const secondCached =
      await api.searchHypersync(
        "my most played",
        "smart",
      );

    assert.equal(fetchCount, 2);
    assert.equal(first.fetchNumber, 1);
    assert.equal(second.fetchNumber, 2);
    assert.equal(secondCached.fetchNumber, 2);
  },
);


test(
  "search result cache stays bounded after bursts of unique queries",
  async (t) => {
    globalThis.localStorage.clear?.();
    setCachedProfile("search-cache-cap-user");

    const api =
      await loadSearchApi();

    let fetchCount = 0;

    t.mock.method(
      globalThis,
      "fetch",
      async (url) => {
        fetchCount += 1;

        return responseFor({
          query: new URL(
            String(url),
            "https://app.example.test",
          ).searchParams.get("q"),
          fetchNumber: fetchCount,
        });
      },
    );

    for (let index = 0; index < 101; index += 1) {
      await api.searchHypersync(
        "cache-item-" + index,
        "smart",
      );
    }

    assert.equal(fetchCount, 101);

    const evicted =
      await api.searchHypersync(
        "cache-item-0",
        "smart",
      );

    assert.equal(fetchCount, 102);
    assert.equal(evicted.query, "cache-item-0");
  },
);


test(
  "bypassing the search cache refreshes the cached result",
  async (t) => {
    globalThis.localStorage.clear?.();
    setCachedProfile("search-bypass-user");

    const api =
      await loadSearchApi();

    let fetchCount = 0;

    t.mock.method(
      globalThis,
      "fetch",
      async () => {
        fetchCount += 1;
        return responseFor({
          revision: fetchCount,
        });
      },
    );

    const first =
      await api.searchHypersync(
        "new releases",
        "smart",
      );

    const fresh =
      await api.searchHypersync(
        "new releases",
        "smart",
        {
          bypassCache: true,
          signal: new AbortController().signal,
        },
      );

    const cachedFresh =
      await api.searchHypersync(
        "new releases",
        "smart",
      );

    assert.equal(first.revision, 1);
    assert.equal(fresh.revision, 2);
    assert.equal(cachedFresh.revision, 2);
    assert.equal(fetchCount, 2);
  },
);
