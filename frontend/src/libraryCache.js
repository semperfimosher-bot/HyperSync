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
