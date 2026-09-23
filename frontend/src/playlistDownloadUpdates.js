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
