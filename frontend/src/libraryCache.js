const CACHE_PREFIX =
  "hypersync-library-v1:";


function getScopeKey(
  userKey,
) {
  const normalized =
    String(
      userKey ?? "",
    ).trim();

  return (
    CACHE_PREFIX +
    (
      normalized ||
      "anonymous"
    )
  );
}


function readCache(
  userKey,
) {
  try {
    const raw =
      localStorage.getItem(
        getScopeKey(
          userKey,
        ),
      );

    if (!raw) {
      return {
        library: null,
        playlists: {},
      };
    }

    const parsed =
      JSON.parse(
        raw,
      );

    return {
      library:
        parsed?.library ??
        null,

      playlists:
        parsed?.playlists &&
        typeof parsed.playlists ===
          "object"
          ? parsed.playlists
          : {},
    };
  } catch {
    return {
      library: null,
      playlists: {},
    };
  }
}


function writeCache(
  userKey,
  value,
) {
  try {
    localStorage.setItem(
      getScopeKey(
        userKey,
      ),
      JSON.stringify(
        value,
      ),
    );
  } catch {
    /*
     * Cache failure must never
     * break the Library.
     */
  }
}


export function getCachedLibrary(
  userKey,
) {
  return readCache(
    userKey,
  ).library;
}


export function setCachedLibrary(
  userKey,
  library,
) {
  const cache =
    readCache(
      userKey,
    );

  writeCache(
    userKey,
    {
      ...cache,

      library: {
        ...library,

        cachedAt:
          Date.now(),
      },
    },
  );
}


export function clearCachedLibraryScope(
  userKey,
) {
  try {
    localStorage.removeItem(
      getScopeKey(
        userKey,
      ),
    );
  } catch {
    /*
     * Cache cleanup must never
     * break account logout.
     */
  }
}


export function clearCachedLibrary(
  userKey,
) {
  const cache =
    readCache(
      userKey,
    );

  writeCache(
    userKey,
    {
      ...cache,
      library: null,
    },
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


export function setCachedPlaylist(
  userKey,
  playlist,
) {
  if (!playlist?.id) {
    return;
  }

  const cache =
    readCache(
      userKey,
    );

  writeCache(
    userKey,
    {
      ...cache,

      playlists: {
        ...cache.playlists,

        [String(
          playlist.id,
        )]: {
          ...playlist,

          cachedAt:
            Date.now(),
        },
      },
    },
  );
}


export function removeCachedPlaylist(
  userKey,
  playlistId,
) {
  if (!playlistId) {
    return;
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

  writeCache(
    userKey,
    {
      ...cache,

      playlists:
        nextPlaylists,
    },
  );
}


// Large library snapshots belong in IndexedDB, not localStorage. localStorage
// has a small per-origin quota and serializes the whole value on every write.
const LIBRARY_DB_NAME = "hypersync-library-cache-v1";
const LIBRARY_DB_VERSION = 1;
const LIBRARY_STORE_NAME = "libraries";

function openLibraryCacheDb() {
  if (!globalThis.indexedDB) {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    let request;
    try {
      request = globalThis.indexedDB.open(
        LIBRARY_DB_NAME,
        LIBRARY_DB_VERSION,
      );
    } catch (error) {
      reject(error);
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LIBRARY_STORE_NAME)) {
        db.createObjectStore(LIBRARY_STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open library cache."));
    request.onblocked = () => reject(new Error("Library cache upgrade is blocked."));
  });
}

function idbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Library cache request failed."));
  });
}

export async function getCachedLibraryAsync(userKey) {
  let db;
  try {
    db = await openLibraryCacheDb();
    if (db) {
      const transaction = db.transaction(LIBRARY_STORE_NAME, "readonly");
      const record = await idbRequest(
        transaction.objectStore(LIBRARY_STORE_NAME).get(getScopeKey(userKey)),
      );
      db.close();
      if (record?.library) {
        return record.library;
      }
    }
  } catch {
    try { db?.close(); } catch { /* best-effort cleanup */ }
  }

  return getCachedLibrary(userKey);
}

export async function setCachedLibraryAsync(userKey, library) {
  const snapshot = {
    ...library,
    cachedAt: Date.now(),
  };
  let db;
  try {
    db = await openLibraryCacheDb();
    if (db) {
      const transaction = db.transaction(LIBRARY_STORE_NAME, "readwrite");
      await idbRequest(transaction.objectStore(LIBRARY_STORE_NAME).put({
        key: getScopeKey(userKey),
        library: snapshot,
      }));
      db.close();

      // Keep only small metadata in localStorage. This also prevents every
      // playlist-cache update from serializing the entire music catalog.
      setCachedLibrary(userKey, {
        owned: Array.isArray(snapshot.owned) ? snapshot.owned : [],
        saved: Array.isArray(snapshot.saved) ? snapshot.saved : [],
        tracks: [],
        tracksStoredInIndexedDB: true,
      });
      return;
    }
  } catch {
    try { db?.close(); } catch { /* best-effort cleanup */ }
  }

  // Browsers without usable IndexedDB retain the legacy best-effort behavior.
  setCachedLibrary(userKey, snapshot);
}
