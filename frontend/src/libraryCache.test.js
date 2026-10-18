import "fake-indexeddb/auto";

import assert from "node:assert/strict";
import test from "node:test";

function createStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    clear() {
      values.clear();
    },
  };
}

if (typeof globalThis.localStorage === "undefined") {
  globalThis.localStorage = createStorage();
}

test("large library snapshots round-trip through IndexedDB without localStorage catalog copies", async () => {
  const cache = await import(`./libraryCache.js?large-snapshot=${Date.now()}`);
  const userKey = `large-library-${Date.now()}`;
  const tracks = Array.from({ length: 100_000 }, (_, index) => ({
    id: `track-${index}`,
    title: `Track ${index}`,
    artist: `Artist ${index % 250}`,
  }));
  const snapshot = {
    owned: [{ id: "owned-1", title: "Owned" }],
    saved: [{ id: "saved-1", title: "Saved" }],
    tracks,
  };

  await cache.setCachedLibraryAsync(userKey, snapshot);

  const localSnapshot = cache.getCachedLibrary(userKey);
  assert.deepEqual(localSnapshot.tracks, []);
  assert.equal(localSnapshot.tracksStoredInIndexedDB, true);

  const restored = await cache.getCachedLibraryAsync(userKey);
  assert.equal(restored.tracks.length, 100_000);
  assert.equal(restored.tracks[0].id, "track-0");
  assert.equal(restored.tracks[99_999].id, "track-99999");
  assert.equal(restored.owned[0].id, "owned-1");

  await cache.clearCachedLibraryScopeAsync(userKey);
  assert.equal(await cache.getCachedLibraryAsync(userKey), null);
});

test("clearing one library scope does not clear another user's IndexedDB snapshot", async () => {
  const cache = await import(`./libraryCache.js?scope-isolation=${Date.now()}`);
  const suffix = Date.now();
  const ownerA = `owner-a-${suffix}`;
  const ownerB = `owner-b-${suffix}`;

  await cache.setCachedLibraryAsync(ownerA, {
    owned: [],
    saved: [],
    tracks: [{ id: "private-a" }],
  });
  await cache.setCachedLibraryAsync(ownerB, {
    owned: [],
    saved: [],
    tracks: [{ id: "private-b" }],
  });

  await cache.clearCachedLibraryScopeAsync(ownerA);

  assert.equal(await cache.getCachedLibraryAsync(ownerA), null);
  assert.equal(
    (await cache.getCachedLibraryAsync(ownerB)).tracks[0].id,
    "private-b",
  );

  await cache.clearCachedLibraryScopeAsync(ownerB);
});
