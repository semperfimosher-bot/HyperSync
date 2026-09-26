function normalizePlaylistSearchValue(
  value,
) {
  return String(
    value ??
    "",
  )
    .normalize(
      "NFKD",
    )
    .replace(
      /[\u0300-\u036f]/g,
      "",
    )
    .toLocaleLowerCase()
    .trim();
}


export function filterPlaylistTracks(
  tracks,
  query,
) {
  const source =
    Array.isArray(
      tracks,
    )
      ? tracks
      : [];

  const normalizedQuery =
    normalizePlaylistSearchValue(
      query,
    );

  if (!normalizedQuery) {
    return source;
  }

  return source.filter(
    (track) => {
      const searchable =
        [
          track?.title,
          track?.artist,
          track?.album,
        ]
          .map(
            normalizePlaylistSearchValue,
          )
          .join(
            "\n",
          );

      return searchable.includes(
        normalizedQuery,
      );
    },
  );
}
