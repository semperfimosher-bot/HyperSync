import {
  deleteLibrarySnapshot,
  deleteLibrarySnapshotsByPrefix,
  getLibrarySnapshot,
  saveLibrarySnapshot,
} from "./mediaStore.js";

const CACHE_PREFIX =
  "hypersync-library-v1:";

/*
 * Keep only a small fast-start mirror in localStorage. Large libraries and
 * playlists can exceed the browser's localStorage quota; their complete
 * account-scoped snapshots are stored in IndexedDB instead.
 */
const LOCAL_STORAGE_CACHE_LIMIT =
  256_000;


function normalizeOwnerKey(
  userKey,
) {
  return (
    String(
      userKey ?? "",
    ).trim() ||
    "anonymous"
  );
}


function getScopeKey(
  userKey,
) {
  return (
    CACHE_PREFIX +
    normalizeOwnerKey(
      userKey,
    )
  );
}


function getSnapshotPrefix(
  userKey,
) {
  return (
    encodeURIComponent(
      normalizeOwnerKey(
        userKey,
      ),
    ) +
    "|"
  );
}


function getLibrarySnapshotKey(
  userKey,
) {
  return (
    getSnapshotPrefix(
      userKey,
    ) +
    "library"
  );
}


function getPlaylistSnapshotKey(
  userKey,
  playlistId,
) {
  const normalizedPlaylistId =
    String(
      playlistId ?? "",
    ).trim();

  if (!normalizedPlaylistId) {
    return null;
  }

  return (
    getSnapshotPrefix(
      userKey,
    ) +
    "playlist|" +
    encodeURIComponent(
      normalizedPlaylistId,
    )
  );
}


function getStorage() {
  try {
    return globalThis.localStorage ??
      null;
  } catch {
    return null;
  }
}


function emptyCache() {
  return {
    library: null,
    playlists: {},
  };
}


function readCache(
  userKey,
) {
  const storage =
    getStorage();

  try {
    const raw =
      storage?.getItem(
        getScopeKey(
          userKey,
        ),
      );

    if (!raw) {
      return emptyCache();
    }

    const parsed =
      JSON.parse(
        raw,
      );

    const library =
      parsed?.library &&
      parsed.library._indexedDbOnly !==
        true
        ? parsed.library
        : null;

    return {
      library,

      playlists:
        parsed?.playlists &&
        typeof parsed.playlists ===
          "object" &&
        !Array.isArray(
          parsed.playlists,
        )
          ? parsed.playlists
          : {},
    };
  } catch {
    return emptyCache();
  }
}


function exceedsLocalStorageLimit(
  value,
) {
  try {
    return JSON.stringify(
      value,
    ).length >
      LOCAL_STORAGE_CACHE_LIMIT;
  } catch {
    return true;
  }
}


function writeCache(
  userKey,
  value,
) {
  const storage =
    getStorage();

  if (!storage?.setItem) {
    return false;
  }

  let serialized;

  try {
    serialized =
      JSON.stringify(
        value,
      );
  } catch {
    return false;
  }

  try {
    if (
      serialized.length <=
      LOCAL_STORAGE_CACHE_LIMIT
    ) {
      storage.setItem(
        getScopeKey(
          userKey,
        ),
        serialized,
      );
    } else {
      /*
       * Full values are saved in IndexedDB by the caller. This small marker
       * avoids repeated quota errors and prevents a partial mirror looking like
       * a complete offline snapshot.
       */
      storage.setItem(
        getScopeKey(
          userKey,
        ),
        JSON.stringify({
          library:
            value.library
              ? {
                  _indexedDbOnly: true,
                  cachedAt:
                    value.library.cachedAt ??
                    Date.now(),
                }
              : null,
          playlists: {},
        }),
      );
    }

    return true;
  } catch {
    /*
     * Browser storage may be blocked or full. Cache failure must not break UI.
     */
    return false;
  }
}


function persistSnapshot(
  key,
  value,
) {
  if (!key) {
    return Promise.resolve(false);
  }

  return saveLibrarySnapshot(
    key,
    value,
  ).catch(
    () => false,
  );
}


function persistCacheSnapshots(
  userKey,
  cache,
) {
  const tasks = [];

  if (cache.library) {
    tasks.push(
      persistSnapshot(
        getLibrarySnapshotKey(
          userKey,
        ),
        cache.library,
      ),
    );
  }

  for (
    const [
      playlistId,
      playlist,
    ]
    of Object.entries(
      cache.playlists ?? {},
    )
  ) {
    tasks.push(
      persistSnapshot(
        getPlaylistSnapshotKey(
          userKey,
          playlistId,
        ),
        playlist,
      ),
    );
  }

  return Promise.all(
    tasks,
  ).then(
    () => true,
  );
}


export function getCachedLibrary(
  userKey,
) {
  return readCache(
    userKey,
  ).library;
}


export async function getCachedLibraryAsync(
  userKey,
) {
  try {
    const snapshot =
      await getLibrarySnapshot(
        getLibrarySnapshotKey(
          userKey,
        ),
      );

    if (
      snapshot &&
      typeof snapshot === "object"
    ) {
      return snapshot;
    }
  } catch {
    // Fall back to the small/legacy localStorage snapshot.
  }

  const legacy =
    getCachedLibrary(
      userKey,
    );

  if (legacy) {
    void persistSnapshot(
      getLibrarySnapshotKey(
        userKey,
      ),
      legacy,
    );
  }

  return legacy;
}


export function setCachedLibrary(
  userKey,
  library,
) {
  const cache =
    readCache(
      userKey,
    );

  const nextLibrary = {
    ...library,
    cachedAt:
      Date.now(),
  };

  const nextCache = {
    ...cache,
    library:
      nextLibrary,
  };

  writeCache(
    userKey,
    nextCache,
  );

  if (
    exceedsLocalStorageLimit(
      nextCache,
    )
  ) {
    return persistCacheSnapshots(
      userKey,
      nextCache,
    );
  }

  return persistSnapshot(
    getLibrarySnapshotKey(
      userKey,
    ),
    nextLibrary,
  );
}


export function clearCachedLibraryScope(
  userKey,
) {
  const storage =
    getStorage();

  try {
    storage?.removeItem(
      getScopeKey(
        userKey,
      ),
    );
  } catch {
    // Cache cleanup must never break logout.
  }

  return deleteLibrarySnapshotsByPrefix(
    getSnapshotPrefix(
      userKey,
    ),
  ).catch(
    () => 0,
  );
}


export function clearCachedLibrary(
  userKey,
) {
  const cache =
    readCache(
      userKey,
    );

  const nextCache = {
    ...cache,
    library: null,
  };

  writeCache(
    userKey,
    nextCache,
  );

  const persistRemaining =
    exceedsLocalStorageLimit(
      nextCache,
    )
      ? persistCacheSnapshots(
          userKey,
          nextCache,
        )
      : Promise.resolve(true);

  return Promise.all([
    persistRemaining,
    deleteLibrarySnapshot(
      getLibrarySnapshotKey(
        userKey,
      ),
    ).catch(
      () => false,
    ),
  ]).then(
    (values) =>
      values.every(Boolean),
  );
}


export function getCachedPlaylist(
  userKey,
  playlistId,
) {
  if (!playlistId) {
    return null;
  }

  const cache =
    readCache(
      userKey,
    );

  return (
    cache.playlists[
      String(
        playlistId,
      )
    ] ??
    null
  );
}


export async function getCachedPlaylistAsync(
  userKey,
  playlistId,
) {
  const key =
    getPlaylistSnapshotKey(
      userKey,
      playlistId,
    );

  if (!key) {
    return null;
  }

  try {
    const snapshot =
      await getLibrarySnapshot(
        key,
      );

    if (
      snapshot &&
      typeof snapshot === "object"
    ) {
      return snapshot;
    }
  } catch {
    // Fall back to the localStorage mirror.
  }

  const legacy =
    getCachedPlaylist(
      userKey,
      playlistId,
    );

  if (legacy) {
    void persistSnapshot(
      key,
      legacy,
    );
  }

  return legacy;
}


export function setCachedPlaylist(
  userKey,
  playlist,
) {
  if (!playlist?.id) {
    return Promise.resolve(false);
  }

  const id =
    String(
      playlist.id,
    );

  const nextPlaylist = {
    ...playlist,
    cachedAt:
      Date.now(),
  };

  const cache =
    readCache(
      userKey,
    );

  const nextCache = {
    ...cache,

    playlists: {
      ...cache.playlists,

      [id]:
        nextPlaylist,
    },
  };

  writeCache(
    userKey,
    nextCache,
  );

  if (
    exceedsLocalStorageLimit(
      nextCache,
    )
  ) {
    return persistCacheSnapshots(
      userKey,
      nextCache,
    );
  }

  return persistSnapshot(
    getPlaylistSnapshotKey(
      userKey,
      id,
    ),
    nextPlaylist,
  );
}


export function removeCachedPlaylist(
  userKey,
  playlistId,
) {
  if (!playlistId) {
    return Promise.resolve(false);
  }

  const cache =
    readCache(
      userKey,
    );

  const nextPlaylists = {
    ...cache.playlists,
  };

  delete nextPlaylists[
    String(
      playlistId,
    )
  ];

  const nextCache = {
    ...cache,

    playlists:
      nextPlaylists,
  };

  writeCache(
    userKey,
    nextCache,
  );

  const persistRemaining =
    exceedsLocalStorageLimit(
      nextCache,
    )
      ? persistCacheSnapshots(
          userKey,
          nextCache,
        )
      : Promise.resolve(true);

  return Promise.all([
    persistRemaining,
    deleteLibrarySnapshot(
      getPlaylistSnapshotKey(
        userKey,
        playlistId,
      ),
    ).catch(
      () => false,
    ),
  ]).then(
    (values) =>
      values.every(Boolean),
  );
}
