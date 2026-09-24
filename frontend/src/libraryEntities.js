function cleanLabel(
  value,
  fallback = "",
) {
  const text =
    String(
      value ?? "",
    )
      .trim()
      .replace(
        /\s+/g,
        " ",
      );

  return text || fallback;
}


function normalizedKey(
  value,
) {
  return cleanLabel(
    value,
  )
    .normalize(
      "NFKC",
    )
    .toLocaleLowerCase();
}


function trackIdentity(
  track,
  fallbackIndex,
) {
  const id =
    cleanLabel(
      track?.id,
    );

  if (id) {
    return (
      "id:" +
      id
    );
  }

  return (
    "fallback:" +
    normalizedKey(
      track?.artist,
    ) +
    "::" +
    normalizedKey(
      track?.album,
    ) +
    "::" +
    normalizedKey(
      track?.title,
    ) +
    "::" +
    String(
      track?.media_version ??
      track?.mediaVersion ??
      fallbackIndex,
    )
  );
}


function uniqueTracks(
  tracks,
) {
  const seen =
    new Set();

  const result =
    [];

  (
    Array.isArray(
      tracks,
    )
      ? tracks
      : []
  ).forEach(
    (
      track,
      index,
    ) => {
      if (
        !track ||
        typeof track !==
          "object"
      ) {
        return;
      }

      const key =
        trackIdentity(
          track,
          index,
        );

      if (
        seen.has(
          key,
        )
      ) {
        return;
      }

      seen.add(
        key,
      );

      result.push(
        track,
      );
    },
  );

  return result;
}


export function mergeLibraryTracks(
  primaryTracks,
  offlineTracks,
) {
  return uniqueTracks([
    ...(
      Array.isArray(
        primaryTracks,
      )
        ? primaryTracks
        : []
    ),
    ...(
      Array.isArray(
        offlineTracks,
      )
        ? offlineTracks
        : []
    ),
  ]);
}


export function buildLibraryArtists(
  tracks,
) {
  const artists =
    new Map();

  for (
    const track
    of uniqueTracks(
      tracks,
    )
  ) {
    const name =
      cleanLabel(
        track?.artist,
        "Unknown Artist",
      );

    const key =
      normalizedKey(
        name,
      );

    let artist =
      artists.get(
        key,
      );

    if (!artist) {
      artist = {
        key,
        name,
        artwork_url:
          track?.artwork_url ??
          null,
        tracks: [],
        albums:
          new Set(),
      };

      artists.set(
        key,
        artist,
      );
    }

    artist.tracks.push(
      track,
    );

    if (
      !artist.artwork_url &&
      track?.artwork_url
    ) {
      artist.artwork_url =
        track.artwork_url;
    }

    const album =
      cleanLabel(
        track?.album,
      );

    if (album) {
      artist.albums.add(
        normalizedKey(
          album,
        ),
      );
    }
  }

  return Array.from(
    artists.values(),
  )
    .map(
      (artist) => ({
        key:
          artist.key,
        name:
          artist.name,
        artwork_url:
          artist.artwork_url,
        tracks:
          artist.tracks,
        track_count:
          artist.tracks.length,
        album_count:
          artist.albums.size,
      }),
    )
    .sort(
      (left, right) =>
        left.name.localeCompare(
          right.name,
          undefined,
          {
            sensitivity:
              "base",
          },
        ),
    );
}


export function buildLibraryAlbums(
  tracks,
) {
  const albums =
    new Map();

  for (
    const track
    of uniqueTracks(
      tracks,
    )
  ) {
    const title =
      cleanLabel(
        track?.album,
      );

    /*
     * A track without album metadata is still
     * visible under its artist, but it should
     * not create a fake "Unknown Album" card.
     */
    if (!title) {
      continue;
    }

    const artist =
      cleanLabel(
        track?.artist,
        "Unknown Artist",
      );

    const key =
      (
        normalizedKey(
          artist,
        ) +
        "::" +
        normalizedKey(
          title,
        )
      );

    let album =
      albums.get(
        key,
      );

    if (!album) {
      album = {
        key,
        title,
        artist,
        artwork_url:
          track?.artwork_url ??
          null,
        tracks: [],
      };

      albums.set(
        key,
        album,
      );
    }

    album.tracks.push(
      track,
    );

    if (
      !album.artwork_url &&
      track?.artwork_url
    ) {
      album.artwork_url =
        track.artwork_url;
    }
  }

  return Array.from(
    albums.values(),
  )
    .map(
      (album) => ({
        ...album,
        track_count:
          album.tracks.length,
      }),
    )
    .sort(
      (left, right) => {
        const titleOrder =
          left.title.localeCompare(
            right.title,
            undefined,
            {
              sensitivity:
                "base",
            },
          );

        if (
          titleOrder !==
          0
        ) {
          return titleOrder;
        }

        return left.artist.localeCompare(
          right.artist,
          undefined,
          {
            sensitivity:
              "base",
          },
        );
      },
    );
}
