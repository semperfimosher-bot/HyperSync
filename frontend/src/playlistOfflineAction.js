import {
  getPlaylist,
  savePlaylist,
} from "./playlistApi.js";

import {
  getOfflineOwnerKey,
  getPlaylistDownloadJobId,
  startPlaylistDownloadForOffline,
} from "./offlineDownloads.js";


export async function downloadPlaylistByIdForOffline(
  playlistId,
  currentUser,
  {
    ensureSaved = false,
    onProgress = null,
  } = {},
) {
  const id =
    String(
      playlistId ??
      "",
    ).trim();

  if (!id) {
    throw new Error(
      "Playlist is missing an id.",
    );
  }

  const ownerKey =
    getOfflineOwnerKey(
      currentUser,
    );

  if (!ownerKey) {
    throw new Error(
      "Sign in to download playlists.",
    );
  }

  let playlist =
    await getPlaylist(
      id,
    );

  if (
    ensureSaved &&
    !playlist.is_owner &&
    !playlist.is_saved
  ) {
    await savePlaylist(
      id,
    );

    playlist =
      await getPlaylist(
        id,
      );

    window.dispatchEvent(
      new CustomEvent(
        "hypersync:library-changed",
      ),
    );
  }

  const tracks =
    Array.isArray(
      playlist.tracks,
    )
      ? playlist.tracks
      : [];

  if (!tracks.length) {
    throw new Error(
      "This playlist has no tracks to download.",
    );
  }

  await startPlaylistDownloadForOffline(
    tracks,
    {
      jobId:
        getPlaylistDownloadJobId(
          ownerKey,
          playlist.id,
        ),
      ownerKey,
      jobMetadata: {
        kind:
          "playlist",
        playlistId:
          playlist.id,
        playlistTitle:
          playlist.title,
        playlistDescription:
          playlist.description ??
          null,
        playlistArtworkUrl:
          playlist.artwork_url ??
          null,
        playlistOwnerUsername:
          playlist.owner_username ??
          null,
        playlistVisibility:
          playlist.visibility ??
          null,
      },
      onProgress:
        typeof onProgress ===
          "function"
          ? onProgress
          : undefined,
    },
  );

  window.dispatchEvent(
    new CustomEvent(
      "hypersync:offline-downloads-changed",
    ),
  );

  return playlist;
}
