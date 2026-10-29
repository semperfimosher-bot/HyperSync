import "fake-indexeddb/auto";

import assert from "node:assert/strict";
import test from "node:test";

import {
  clearCachedLibraryScope,
  getCachedLibrary,
  getCachedLibraryAsync,
  getCachedLibraryPageAsync,
  getCachedPlaylist,
  getCachedPlaylistAsync,
  setCachedLibrary,
  setCachedLibraryPageAsync,
  setCachedPlaylist,
} from "./libraryCache.js";


function ensureLocalStorage() {
  if (typeof globalThis.localStorage !== "undefined") {
    return;
  }

  const values = new Map();
  globalThis.localStorage = {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

ensureLocalStorage();


test(
  "large Library and playlist snapshots use IndexedDB instead of overflowing localStorage",
  async () => {
    const owner = "large-library-cache-" + Date.now();

    const tracks = Array.from(
      { length: 4_000 },
      (_, index) => ({
        id: "large-track-" + index,
        title: "Long track title ".repeat(8) + index,
        artist: "Long artist name ".repeat(5),
        album: "Long album name ".repeat(5),
      }),
    );

    await setCachedLibrary(
      owner,
      {
        owned: [],
        saved: [],
        tracks,
      },
    );

    const localRaw =
      globalThis.localStorage.getItem(
        "hypersync-library-v1:" + owner,
      );

    assert.ok(localRaw);
    assert.ok(localRaw.length < 1_000);
    assert.equal(getCachedLibrary(owner), null);

    const cachedLibrary =
      await getCachedLibraryAsync(owner);

    assert.equal(cachedLibrary.tracks.length, 4_000);
    assert.equal(
      cachedLibrary.tracks[3_999].id,
      "large-track-3999",
    );

    const playlist = {
      id: "large-playlist-" + Date.now(),
      title: "Big offline playlist",
      tracks,
    };

    await setCachedPlaylist(owner, playlist);

    const cachedPlaylist =
      await getCachedPlaylistAsync(
        owner,
        playlist.id,
      );

    assert.equal(cachedPlaylist.tracks.length, 4_000);
    assert.equal(
      cachedPlaylist.tracks[0].id,
      "large-track-0",
    );

    assert.equal(
      getCachedPlaylist(owner, playlist.id),
      null,
    );
  },
);


test(
  "IndexedDB snapshots are isolated by account and removed by logout cleanup",
  async () => {
    const suffix = Date.now().toString();
    const ownerA = "snapshot-owner-a-" + suffix;
    const ownerB = "snapshot-owner-b-" + suffix;
    const playlistA = "private-playlist-a-" + suffix;
    const playlistB = "private-playlist-b-" + suffix;

    await setCachedLibrary(
      ownerA,
      {
        owned: [{ id: "owner-a-playlist" }],
        saved: [],
        tracks: [{ id: "owner-a-track" }],
      },
    );
    await setCachedPlaylist(
      ownerA,
      {
        id: playlistA,
        title: "Owner A private playlist",
        tracks: [{ id: "owner-a-private-track" }],
      },
    );

    await setCachedLibrary(
      ownerB,
      {
        owned: [],
        saved: [],
        tracks: [{ id: "owner-b-track" }],
      },
    );
    await setCachedPlaylist(
      ownerB,
      {
        id: playlistB,
        title: "Owner B private playlist",
        tracks: [{ id: "owner-b-private-track" }],
      },
    );

    assert.equal(
      (
        await getCachedLibraryAsync(ownerB)
      ).tracks[0].id,
      "owner-b-track",
    );
    assert.equal(
      await getCachedPlaylistAsync(ownerB, playlistA),
      null,
    );

    await clearCachedLibraryScope(ownerA);

    assert.equal(
      await getCachedLibraryAsync(ownerA),
      null,
    );
    assert.equal(
      await getCachedPlaylistAsync(ownerA, playlistA),
      null,
    );

    assert.equal(
      (
        await getCachedLibraryAsync(ownerB)
      ).tracks[0].id,
      "owner-b-track",
    );
    assert.equal(
      (
        await getCachedPlaylistAsync(ownerB, playlistB)
      ).tracks[0].id,
      "owner-b-private-track",
    );
  },
);


test(
  "library pages are cached separately, isolated by account, and cleared on logout",
  async () => {
    const suffix = Date.now().toString();
    const ownerA = "page-cache-owner-a-" + suffix;
    const ownerB = "page-cache-owner-b-" + suffix;
    const pageA = [{ id: "owner-a-page-1000" }];
    const pageB = [{ id: "owner-b-page-1000" }];

    await setCachedLibraryPageAsync(ownerA, 1000, pageA);
    await setCachedLibraryPageAsync(ownerB, 1000, pageB);

    assert.deepEqual(
      await getCachedLibraryPageAsync(ownerA, 1000),
      pageA,
    );
    assert.deepEqual(
      await getCachedLibraryPageAsync(ownerB, 1000),
      pageB,
    );

    await clearCachedLibraryScope(ownerA);

    assert.equal(
      await getCachedLibraryPageAsync(ownerA, 1000),
      null,
    );
    assert.deepEqual(
      await getCachedLibraryPageAsync(ownerB, 1000),
      pageB,
    );
  },
);
