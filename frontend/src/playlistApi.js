import {
  apiRequest,
} from "./api/client.js";


export function getMyPlaylists() {
  return apiRequest(
    "/playlists/mine",
  );
}


export function getSavedPlaylists() {
  return apiRequest(
    "/playlists/saved",
  );
}


export function getLibraryTracks() {
  return apiRequest(
    "/playlists/library/tracks",
  );
}


export function getPlaylist(
  playlistId,
) {
  return apiRequest(
    `/playlists/${encodeURIComponent(
      playlistId,
    )}`,
  );
}


export function searchPlaylists(
  query,
) {
  const params =
    new URLSearchParams({
      q:
        String(
          query ?? "",
        ).trim(),
    });

  return apiRequest(
    `/playlists/search?${params.toString()}`,
  );
}


export function createPlaylist({
  title,
  description = null,
  visibility = "private",
}) {
  return apiRequest(
    "/playlists",
    {
      method:
        "POST",

      body:
        JSON.stringify({
          title,
          description,
          visibility,
        }),
    },
  );
}


export function updatePlaylist(
  playlistId,
  changes,
) {
  return apiRequest(
    `/playlists/${encodeURIComponent(
      playlistId,
    )}`,
    {
      method:
        "PATCH",

      body:
        JSON.stringify(
          changes,
        ),
    },
  );
}


export function deletePlaylist(
  playlistId,
) {
  return apiRequest(
    `/playlists/${encodeURIComponent(
      playlistId,
    )}`,
    {
      method:
        "DELETE",
    },
  );
}


export function addTrackToPlaylist(
  playlistId,
  trackId,
) {
  return apiRequest(
    `/playlists/${encodeURIComponent(
      playlistId,
    )}/tracks`,
    {
      method:
        "POST",

      body:
        JSON.stringify({
          track_id:
            trackId,
        }),
    },
  );
}


export function removeTrackFromPlaylist(
  playlistId,
  playlistTrackId,
) {
  return apiRequest(
    `/playlists/${encodeURIComponent(
      playlistId,
    )}/tracks/${encodeURIComponent(
      playlistTrackId,
    )}`,
    {
      method:
        "DELETE",
    },
  );
}


export function reorderPlaylistTracks(
  playlistId,
  playlistTrackIds,
) {
  return apiRequest(
    `/playlists/${encodeURIComponent(
      playlistId,
    )}/tracks/reorder`,
    {
      method:
        "PUT",

      body:
        JSON.stringify({
          playlist_track_ids:
            playlistTrackIds,
        }),
    },
  );
}


export function savePlaylist(
  playlistId,
) {
  return apiRequest(
    `/playlists/${encodeURIComponent(
      playlistId,
    )}/save`,
    {
      method:
        "POST",
    },
  );
}


export function unsavePlaylist(
  playlistId,
) {
  return apiRequest(
    `/playlists/${encodeURIComponent(
      playlistId,
    )}/save`,
    {
      method:
        "DELETE",
    },
  );
}

export function getLikedTrackState(
  trackId,
) {
  return apiRequest(
    `/playlists/liked/tracks/${encodeURIComponent(
      trackId,
    )}`,
  );
}


export function likeTrack(
  trackId,
) {
  return apiRequest(
    `/playlists/liked/tracks/${encodeURIComponent(
      trackId,
    )}`,
    {
      method: "POST",
    },
  );
}


export function unlikeTrack(
  trackId,
) {
  return apiRequest(
    `/playlists/liked/tracks/${encodeURIComponent(
      trackId,
    )}`,
    {
      method: "DELETE",
    },
  );
}

