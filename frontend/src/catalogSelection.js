export function toggleTrackSelection(
  selection,
  trackId,
) {
  const next =
    new Set(
      selection instanceof Set
        ? selection
        : [],
    );

  const normalizedTrackId =
    String(
      trackId ??
      "",
    ).trim();

  if (!normalizedTrackId) {
    return next;
  }

  if (
    next.has(
      normalizedTrackId,
    )
  ) {
    next.delete(
      normalizedTrackId,
    );
  } else {
    next.add(
      normalizedTrackId,
    );
  }

  return next;
}


export function toggleTrackGroupSelection(
  selection,
  trackIds,
) {
  const next =
    new Set(
      selection instanceof Set
        ? selection
        : [],
    );

  const normalizedTrackIds =
    Array.from(
      new Set(
        (
          Array.isArray(
            trackIds,
          )
            ? trackIds
            : []
        )
          .map(
            (trackId) =>
              String(
                trackId ??
                "",
              ).trim(),
          )
          .filter(Boolean),
      ),
    );

  if (
    normalizedTrackIds.length ===
    0
  ) {
    return next;
  }

  const allSelected =
    normalizedTrackIds.every(
      (trackId) =>
        next.has(
          trackId,
        ),
    );

  normalizedTrackIds.forEach(
    (trackId) => {
      if (allSelected) {
        next.delete(
          trackId,
        );
      } else {
        next.add(
          trackId,
        );
      }
    },
  );

  return next;
}


export function addTrackGroupSelection(
  selection,
  trackIds,
) {
  const next =
    new Set(
      selection instanceof Set
        ? selection
        : [],
    );

  (
    Array.isArray(
      trackIds,
    )
      ? trackIds
      : []
  ).forEach(
    (trackId) => {
      const normalizedTrackId =
        String(
          trackId ??
          "",
        ).trim();

      if (normalizedTrackId) {
        next.add(
          normalizedTrackId,
        );
      }
    },
  );

  return next;
}


export function pruneTrackSelection(
  selection,
  tracks,
) {
  const availableTrackIds =
    new Set(
      (
        Array.isArray(
          tracks,
        )
          ? tracks
          : []
      ).map(
        (track) =>
          String(
            track?.id ??
            "",
          ),
      ),
    );

  return new Set(
    Array.from(
      selection instanceof Set
        ? selection
        : [],
    ).filter(
      (trackId) =>
        availableTrackIds.has(
          String(
            trackId,
          ),
        ),
    ),
  );
}


export function getTrackGroupSelectionState(
  selection,
  trackIds,
) {
  const normalizedTrackIds =
    (
      Array.isArray(
        trackIds,
      )
        ? trackIds
        : []
    )
      .map(
        (trackId) =>
          String(
            trackId ??
              "",
          ).trim(),
      )
      .filter(Boolean);

  const selectedCount =
    normalizedTrackIds.filter(
      (trackId) =>
        selection instanceof Set &&
        selection.has(
          trackId,
        ),
    ).length;

  return {
    selectedCount,
    totalCount:
      normalizedTrackIds.length,
    allSelected:
      normalizedTrackIds.length >
        0 &&
      selectedCount ===
        normalizedTrackIds.length,
    partiallySelected:
      selectedCount > 0 &&
      selectedCount <
        normalizedTrackIds.length,
  };
}
