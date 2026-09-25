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


globalThis.localStorage =
  globalThis.localStorage ??
  createStorage();

globalThis.sessionStorage =
  globalThis.sessionStorage ??
  createStorage();

const {
  resolveMediaUrl,
} =
  await import(
    "./mediaCache.js"
  );


test(
  "blob media URLs pass through unchanged",
  () => {
    const url =
      "blob:http://localhost:5173/73730be7-ac2f-4912-ab3c-6ca55311cfa1";

    assert.equal(
      resolveMediaUrl(url),
      url,
    );
  },
);


test(
  "data media URLs pass through unchanged",
  () => {
    const url =
      "data:audio/mpeg;base64,SUQz";

    assert.equal(
      resolveMediaUrl(url),
      url,
    );
  },
);
