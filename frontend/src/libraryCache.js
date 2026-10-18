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


export async function clearCachedLibraryScopeAsync(userKey) {
  try {
    localStorage.removeItem(getScopeKey(userKey));
  } catch {
    // Storage cleanup must not prevent account logout.
  }
  await deleteIndexedDbLibrary(userKey);
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

  // Remove the larger snapshot as well; it is keyed by the same user scope.
  void deleteIndexedDbLibrary(userKey);
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

  void deleteIndexedDbLibrary(userKey);
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

const LIBRARY_PAGE_SIZE = 1000;

function getLibraryPageRecordKey(userKey, offset) {
  return `library-page:${getScopeKey(userKey)}:${offset}`;
}

export async function getCachedLibraryPageAsync(userKey, offset = 0) {
  if (!Number.isInteger(offset) || offset < 0) return [];
  let db;
  try {
    db = await openLibraryCacheDb();
    if (db) {
      const transaction = db.transaction(LIBRARY_STORE_NAME, "readonly");
      const record = await idbRequest(
        transaction.objectStore(LIBRARY_STORE_NAME).get(
          getLibraryPageRecordKey(userKey, offset),
        ),
      );
      db.close();
      if (Array.isArray(record?.tracks)) return record.tracks;
    }
  } catch {
    try { db?.close(); } catch { /* best-effort cleanup */ }
  }

  const legacy = getCachedLibrary(userKey);
  if (offset === 0 && Array.isArray(legacy?.tracks)) {
    return legacy.tracks.slice(0, LIBRARY_PAGE_SIZE);
  }
  return [];
}

export async function setCachedLibraryPageAsync(userKey, offset, tracks) {
  if (!Number.isInteger(offset) || offset < 0 || !Array.isArray(tracks)) return;
  let db;
  try {
    db = await openLibraryCacheDb();
    if (db) {
      const transaction = db.transaction(LIBRARY_STORE_NAME, "readwrite");
      await idbRequest(
        transaction.objectStore(LIBRARY_STORE_NAME).put({
          key: getLibraryPageRecordKey(userKey, offset),
          tracks,
          cachedAt: Date.now(),
        }),
      );
      db.close();
      return;
    }
  } catch {
    try { db?.close(); } catch { /* best-effort cleanup */ }
  }
  if (offset === 0) {
    const legacy = getCachedLibrary(userKey) ?? {};
    setCachedLibrary(userKey, { ...legacy, tracks });
  }
}

export async function getCachedLibraryAsync(userKey) {
  let db;
  let metadata = null;
  try {
    db = await openLibraryCacheDb();
    if (db) {
      const transaction = db.transaction(LIBRARY_STORE_NAME, "readonly");
      const record = await idbRequest(
        transaction.objectStore(LIBRARY_STORE_NAME).get(getScopeKey(userKey)),
      );
      db.close();
      metadata = record?.library ?? null;
      if (metadata) {
        // Migrate old full-catalog snapshots into page zero and discard the
        // giant aggregate; only the requested page is hydrated into memory.
        if (Array.isArray(metadata.tracks) && metadata.tracks.length) {
          await setCachedLibraryPageAsync(
            userKey, 0, metadata.tracks.slice(0, LIBRARY_PAGE_SIZE),
          );
          metadata = {
            ...metadata,
            tracks: [],
            tracksStoredInIndexedDB: true,
          };
          await writeLibraryMetadataAsync(userKey, metadata);
        }
        const tracks = await getCachedLibraryPageAsync(userKey, 0);
        return { ...metadata, tracks };
      }
    }
  } catch {
    try { db?.close(); } catch { /* best-effort cleanup */ }
  }

  const legacy = getCachedLibrary(userKey);
  if (!legacy) return null;
  const tracks = Array.isArray(legacy.tracks)
    ? legacy.tracks.slice(0, LIBRARY_PAGE_SIZE)
    : [];
  if (Array.isArray(legacy.tracks) && legacy.tracks.length > 0) {
    // One-time migration for pre-IndexedDB localStorage snapshots. The
    // persisted copy is immediately reduced to page zero plus metadata.
    await setCachedLibraryAsync(userKey, { ...legacy, tracks });
  }
  return { ...legacy, tracks };
}

export async function setCachedLibraryMetadataAsync(userKey, metadata) {
  await writeLibraryMetadataAsync(userKey, metadata);
}

async function writeLibraryMetadataAsync(userKey, metadata) {
  let db;
  try {
    db = await openLibraryCacheDb();
    if (!db) return;
    const transaction = db.transaction(LIBRARY_STORE_NAME, "readwrite");
    await idbRequest(
      transaction.objectStore(LIBRARY_STORE_NAME).put({
        key: getScopeKey(userKey),
        library: { ...metadata, tracks: [], cachedAt: Date.now() },
      }),
    );
    db.close();
    setCachedLibrary(userKey, {
      owned: Array.isArray(metadata.owned) ? metadata.owned : [],
      saved: Array.isArray(metadata.saved) ? metadata.saved : [],
      tracks: [],
      tracksStoredInIndexedDB: true,
    });
  } catch {
    try { db?.close(); } catch { /* best-effort cleanup */ }
  }
}

export async function setCachedLibraryAsync(userKey, library) {
  const snapshot = {
    ...library,
    tracks: [],
    tracksStoredInIndexedDB: true,
    cachedAt: Date.now(),
  };
  const tracks = Array.isArray(library?.tracks) ? library.tracks : [];
  await setCachedLibraryPageAsync(userKey, 0, tracks.slice(0, LIBRARY_PAGE_SIZE));
  await writeLibraryMetadataAsync(userKey, snapshot);
  // Preserve the old fallback only when IndexedDB is unavailable.
  if (!globalThis.indexedDB) {
    setCachedLibrary(userKey, { ...library, tracks: tracks.slice(0, LIBRARY_PAGE_SIZE) });
  }
}


async function deleteIndexedDbLibrary(userKey) {
  let db;
  try {
    db = await openLibraryCacheDb();
    if (!db) return;
    const transaction = db.transaction(LIBRARY_STORE_NAME, "readwrite");
    const store = transaction.objectStore(LIBRARY_STORE_NAME);
    const scopeKey = getScopeKey(userKey);
    const keys = await idbRequest(store.getAllKeys());
    for (const key of keys) {
      if (
        key === scopeKey ||
        (typeof key === "string" &&
          (key.startsWith(`playlist:${scopeKey}:`) ||
           key.startsWith(`library-page:${scopeKey}:`)))
      ) {
        store.delete(key);
      }
    }
    db.close();
  } catch {
    try { db?.close(); } catch { /* best-effort cleanup */ }
  }
}

function getPlaylistRecordKey(userKey, playlistId) {
  return `playlist:${getScopeKey(userKey)}:${String(playlistId)}`;
}

export async function getCachedPlaylistAsync(userKey, playlistId) {
  if (!playlistId) return null;
  let db;
  try {
    db = await openLibraryCacheDb();
    if (db) {
      const transaction = db.transaction(LIBRARY_STORE_NAME, "readonly");
      const record = await idbRequest(
        transaction.objectStore(LIBRARY_STORE_NAME).get(
          getPlaylistRecordKey(userKey, playlistId),
        ),
      );
      db.close();
      if (record?.playlist) return record.playlist;
    }
  } catch {
    try { db?.close(); } catch { /* best-effort cleanup */ }
  }

  const legacy = getCachedPlaylist(userKey, playlistId);
  if (
    legacy &&
    Array.isArray(legacy.tracks) &&
    legacy.tracksStoredInIndexedDB !== true
  ) {
    // Migrate older localStorage snapshots the next time they are read.
    await setCachedPlaylistAsync(userKey, legacy);
    return legacy;
  }
  return null;
}

export async function setCachedPlaylistAsync(userKey, playlist) {
  if (!playlist?.id) return;
  const snapshot = {
    ...playlist,
    tracks: Array.isArray(playlist.tracks) ? playlist.tracks : [],
    cachedAt: Date.now(),
  };
  let db;
  try {
    db = await openLibraryCacheDb();
    if (db) {
      const transaction = db.transaction(LIBRARY_STORE_NAME, "readwrite");
      await idbRequest(
        transaction.objectStore(LIBRARY_STORE_NAME).put({
          key: getPlaylistRecordKey(userKey, snapshot.id),
          playlist: snapshot,
        }),
      );
      db.close();

      // Keep only metadata in localStorage; full track arrays stay in IndexedDB.
      setCachedPlaylist(userKey, {
        ...snapshot,
        trackCount: snapshot.tracks.length,
        tracks: [],
        tracksStoredInIndexedDB: true,
      });
      return;
    }
  } catch {
    try { db?.close(); } catch { /* best-effort cleanup */ }
  }

  // Best-effort compatibility for browsers without usable IndexedDB.
  setCachedPlaylist(userKey, snapshot);
}

export async function removeCachedPlaylistAsync(userKey, playlistId) {
  if (!playlistId) return;
  let db;
  try {
    db = await openLibraryCacheDb();
    if (db) {
      const transaction = db.transaction(LIBRARY_STORE_NAME, "readwrite");
      await idbRequest(
        transaction.objectStore(LIBRARY_STORE_NAME).delete(
          getPlaylistRecordKey(userKey, playlistId),
        ),
      );
      db.close();
    }
  } catch {
    try { db?.close(); } catch { /* best-effort cleanup */ }
  }
  removeCachedPlaylist(userKey, playlistId);
}
