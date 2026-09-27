const PLAYLIST_PIN_PREFIX =
  "hypersync:playlist-pins-v1:";


function storageKey(
  ownerKey,
) {
  return (
    PLAYLIST_PIN_PREFIX +
    String(
      ownerKey ??
      "anonymous",
    )
  );
}


export function readPinnedPlaylistIds(
  ownerKey,
) {
  try {
    const parsed =
      JSON.parse(
        globalThis.localStorage
          ?.getItem(
            storageKey(
              ownerKey,
            ),
          ) ??
          "[]",
      );

    if (!Array.isArray(parsed)) {
      return [];
    }

    return Array.from(
      new Set(
        parsed
          .map(
            (value) =>
              String(
                value ??
                "",
              ).trim(),
          )
          .filter(Boolean),
      ),
    );
  } catch {
    return [];
  }
}


export function writePinnedPlaylistIds(
  ownerKey,
  playlistIds,
) {
  const normalized =
    Array.from(
      new Set(
        (
          Array.isArray(
            playlistIds,
          )
            ? playlistIds
            : []
        )
          .map(
            (value) =>
              String(
                value ??
                "",
              ).trim(),
          )
          .filter(Boolean),
      ),
    );

  try {
    globalThis.localStorage
      ?.setItem(
        storageKey(
          ownerKey,
        ),
        JSON.stringify(
          normalized,
        ),
      );
  } catch {
    // Pin persistence must never break Library.
  }

  return normalized;
}


export function togglePinnedPlaylistId(
  playlistIds,
  playlistId,
) {
  const id =
    String(
      playlistId ??
      "",
    ).trim();

  if (!id) {
    return (
      Array.isArray(
        playlistIds,
      )
        ? playlistIds
        : []
    );
  }

  const current =
    new Set(
      (
        Array.isArray(
          playlistIds,
        )
          ? playlistIds
          : []
      ).map(
        (value) =>
          String(
            value,
          ),
      ),
    );

  if (current.has(id)) {
    current.delete(id);
  } else {
    current.add(id);
  }

  return Array.from(
    current,
  );
}


export function sortPinnedPlaylists(
  playlists,
  pinnedPlaylistIds,
) {
  const pinned =
    new Set(
      (
        Array.isArray(
          pinnedPlaylistIds,
        )
          ? pinnedPlaylistIds
          : []
      ).map(
        (value) =>
          String(
            value,
          ),
      ),
    );

  const input =
    Array.isArray(
      playlists,
    )
      ? playlists
      : [];

  return [
    ...input.filter(
      (playlist) =>
        pinned.has(
          String(
            playlist?.id ??
            "",
          ),
        ),
    ),
    ...input.filter(
      (playlist) =>
        !pinned.has(
          String(
            playlist?.id ??
            "",
          ),
        ),
    ),
  ];
}
