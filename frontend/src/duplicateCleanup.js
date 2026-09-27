export function duplicateTrackIdsToDelete(
  duplicates,
) {
  const groups =
    Array.isArray(
      duplicates?.groups,
    )
      ? duplicates.groups
      : [];

  const ids =
    new Set();

  for (const group of groups) {
    const tracks =
      Array.isArray(
        group?.tracks,
      )
        ? group.tracks
        : [];

    const keepTrackId =
      String(
        group?.keep_track_id ??
        tracks[0]?.id ??
        "",
      ).trim();

    for (const track of tracks) {
      const trackId =
        String(
          track?.id ??
          "",
        ).trim();

      if (
        !trackId ||
        trackId === keepTrackId
      ) {
        continue;
      }

      ids.add(
        trackId,
      );
    }
  }

  return Array.from(
    ids,
  );
}
