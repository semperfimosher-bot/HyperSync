import test from "node:test";
import assert from "node:assert/strict";


function createStorage() {
  const values =
    new Map();

  return {
    getItem(key) {
      return values.has(key)
        ? values.get(key)
        : null;
    },

    setItem(key, value) {
      values.set(
        key,
        String(value),
      );
    },

    removeItem(key) {
      values.delete(
        key,
      );
    },

    clear() {
      values.clear();
    },
  };
}


if (
  typeof globalThis.localStorage ===
  "undefined"
) {
  globalThis.localStorage =
    createStorage();
}

if (
  typeof globalThis.sessionStorage ===
  "undefined"
) {
  globalThis.sessionStorage =
    createStorage();
}


async function loadDownloads() {
  return import(
    "./offlineDownloads.js"
  );
}


test(
  "resume storage math counts only missing bytes",
  async () => {
    const {
      getMissingDownloadBytes,
    } =
      await loadDownloads();

    assert.equal(
      getMissingDownloadBytes(
        1_000_000,
        {
          cachedBytes:
            750_000,
        },
      ),
      250_000,
    );
  },
);


test(
  "resume storage math clamps stale cached-byte metadata",
  async () => {
    const {
      getMissingDownloadBytes,
    } =
      await loadDownloads();

    assert.equal(
      getMissingDownloadBytes(
        1_000_000,
        {
          cachedBytes:
            2_000_000,
        },
      ),
      0,
    );

    assert.equal(
      getMissingDownloadBytes(
        1_000_000,
        {
          cachedBytes:
            -100,
        },
      ),
      1_000_000,
    );
  },
);


test(
  "resume storage math rejects invalid file sizes safely",
  async () => {
    const {
      getMissingDownloadBytes,
    } =
      await loadDownloads();

    assert.equal(
      getMissingDownloadBytes(
        0,
        {
          cachedBytes:
            10,
        },
      ),
      0,
    );

    assert.equal(
      getMissingDownloadBytes(
        Number.NaN,
        null,
      ),
      0,
    );
  },
);
