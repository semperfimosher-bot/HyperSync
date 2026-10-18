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


export function getLibraryTracks({
  limit,
  offset,
} = {}) {
  const params = new URLSearchParams();

  if (Number.isInteger(limit) && limit > 0) {
    params.set("limit", String(limit));
  }

  if (Number.isInteger(offset) && offset >= 0) {
    params.set("offset", String(offset));
  }

  const query = params.toString();

  return apiRequest(
    "/playlists/library/tracks" +
      (query ? `?${query}` : ""),
  );
}


export async function getLibraryTrack(
  trackId,
) {
  const normalizedTrackId =
    String(
      trackId ?? "",
    ).trim();

  if (!normalizedTrackId) {
    return null;
  }

  /*
   * Resolve a single track directly instead of downloading and scanning
   * the user's entire library for every track action. This is important
   * for large libraries and avoids multiplying a full-library response
   * by each offline-download or liked-song action.
   */
  try {
    return await apiRequest(
      `/catalog/tracks/${encodeURIComponent(
        normalizedTrackId,
      )}`,
    );
  } catch {
    return null;
  }
}


export function getPlaylist(
  playlistId,
  {
    limit,
    offset,
  } = {},
) {
  const params = new URLSearchParams();

  if (Number.isInteger(limit) && limit > 0) {
    params.set("limit", String(limit));
  }

  if (Number.isInteger(offset) && offset >= 0) {
    params.set("offset", String(offset));
  }

  const query = params.toString();

  return apiRequest(
    `/playlists/${encodeURIComponent(
      playlistId,
    )}` + (query ? `?${query}` : ""),
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


export function generateSmartPlaylist(
  query,
) {
  return apiRequest(
    "/playlists/generated",
    {
      method:
        "POST",

      body:
        JSON.stringify({
          query:
            String(
              query ?? "",
            ).trim(),
        }),
    },
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

