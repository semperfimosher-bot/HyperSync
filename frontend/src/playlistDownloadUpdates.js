function trackDownloadIdentity(
  track,
) {
  const trackId =
    String(
      track?.id ??
      track?.trackId ??
      "",
    );

  const mediaVersion =
    String(
      track?.media_version ??
      track?.mediaVersion ??
      "",
    );

  return (
    trackId +
    "::" +
    mediaVersion
  );
}


export function findMissingPlaylistTracks(
  livePlaylist,
  downloadedPlaylist,
) {
  const liveTracks =
    Array.isArray(
      livePlaylist?.tracks,
    )
      ? livePlaylist.tracks
      : [];

  const downloadedTracks =
    Array.isArray(
      downloadedPlaylist?.tracks,
    )
      ? downloadedPlaylist.tracks
      : [];

  const downloadedKeys =
    new Set(
      downloadedTracks.map(
        trackDownloadIdentity,
      ),
    );

  return liveTracks.filter(
    (track) =>
      !downloadedKeys.has(
        trackDownloadIdentity(
          track,
        ),
      ),
  );
}


export function playlistUpdateKey(
  playlist,
  missingTracks,
) {
  return [
    String(
      playlist?.id ?? "",
    ),
    ...(
      Array.isArray(
        missingTracks,
      )
        ? missingTracks.map(
            trackDownloadIdentity,
          )
        : []
    ),
  ].join("|");
}



export function mergeDetectedPlaylistUpdates(
  current,
  detected,
) {
  const currentItems =
    Array.isArray(
      current,
    )
      ? current
      : [];

  const detectedItems =
    Array.isArray(
      detected,
    )
      ? detected
      : [];

  return detectedItems.map(
    (update) => {
      const existing =
        currentItems.find(
          (item) =>
            item?.key ===
            update?.key,
        );

      return (
        existing?.status ===
          "downloading"
          ? existing
          : update
      );
    },
  );
}


export function missingPlaylistDownloadProgress(
  missingTracks,
  trackProgress,
) {
  const tracks =
    Array.isArray(
      missingTracks,
    )
      ? missingTracks
      : [];

  if (
    tracks.length ===
    0
  ) {
    return 1;
  }

  const progress =
    tracks.reduce(
      (
        total,
        track,
      ) => {
        const raw =
          Number(
            trackProgress?.[
              String(
                track?.id ??
                  "",
              )
            ]?.progress ??
              0,
          );

        return (
          total +
          (
            Number.isFinite(
              raw,
            )
              ? Math.max(
                  0,
                  Math.min(
                    1,
                    raw,
                  ),
                )
              : 0
          )
        );
      },
      0,
    ) /
    tracks.length;

  return (
    Number.isFinite(
      progress,
    )
      ? progress
      : 0
  );
}
