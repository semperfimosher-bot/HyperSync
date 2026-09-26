function clean(
  value,
) {
  return String(
    value ??
    "",
  )
    .normalize(
      "NFKC",
    )
    .trim()
    .replace(
      /\s+/g,
      " ",
    )
    .toLocaleLowerCase();
}


export function resolveSharedMusicLibraryTarget(
  item,
  {
    tracks = [],
    ownedPlaylists = [],
    savedPlaylists = [],
  } = {},
) {
  if (!item) {
    return null;
  }

  if (
    item.kind ===
      "playlist"
  ) {
    const id =
      String(
        item.key ??
        "",
      );

    const playlist =
      [
        ...(
          Array.isArray(
            ownedPlaylists,
          )
            ? ownedPlaylists
            : []
        ),
        ...(
          Array.isArray(
            savedPlaylists,
          )
            ? savedPlaylists
            : []
        ),
      ].find(
        (candidate) =>
          String(
            candidate?.id ??
            "",
          ) === id,
      ) ??
      null;

    return playlist
      ? {
          kind:
            "playlist",
          playlist,
        }
      : null;
  }

  const sourceTracks =
    Array.isArray(
      tracks,
    )
      ? tracks
      : [];

  if (
    item.kind ===
      "track"
  ) {
    const id =
      String(
        item.key ??
        "",
      );

    const track =
      sourceTracks.find(
        (candidate) =>
          String(
            candidate?.id ??
            "",
          ) === id,
      ) ??
      null;

    return track
      ? {
          kind:
            "track",
          track,
        }
      : null;
  }

  if (
    item.kind ===
      "artist"
  ) {
    const wanted =
      clean(
        item.title,
      );

    const track =
      sourceTracks.find(
        (candidate) =>
          clean(
            candidate?.artist,
          ) === wanted,
      ) ??
      null;

    return track
      ? {
          kind:
            "artist",
          key:
            wanted,
          title:
            item.title,
        }
      : null;
  }

  if (
    item.kind ===
      "album"
  ) {
    const wantedTitle =
      clean(
        item.title,
      );

    const wantedArtist =
      clean(
        item.subtitle,
      );

    const track =
      sourceTracks.find(
        (candidate) => (
          clean(
            candidate?.album,
          ) === wantedTitle &&
          (
            !wantedArtist ||
            clean(
              candidate?.artist,
            ) === wantedArtist
          )
        ),
      ) ??
      null;

    if (!track) {
      return null;
    }

    const artist =
      clean(
        track.artist,
      );

    return {
      kind:
        "album",
      key:
        artist +
        "::" +
        wantedTitle,
      title:
        item.title,
      artist:
        track.artist ??
        item.subtitle ??
        "",
    };
  }

  return null;
}


export function sharedMusicSearchQuery(
  item,
) {
  if (!item) {
    return "";
  }

  if (
    item.kind ===
      "track"
  ) {
    return [
      item.title,
      item.subtitle,
    ]
      .filter(Boolean)
      .join(
        " ",
      )
      .trim();
  }

  if (
    item.kind ===
      "album"
  ) {
    return [
      item.title,
      item.subtitle,
    ]
      .filter(Boolean)
      .join(
        " ",
      )
      .trim();
  }

  return String(
    item.title ??
    "",
  ).trim();
}
