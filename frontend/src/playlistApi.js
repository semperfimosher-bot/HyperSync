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


const TRACKS_PAGE_SIZE = 1000;


function buildTrackPageQuery(
  limit,
  offset,
) {
  const params = new URLSearchParams();

  if (Number.isInteger(limit) && limit > 0) {
    params.set("limit", String(limit));
    params.set(
      "offset",
      String(
        Number.isInteger(offset) && offset >= 0
          ? offset
          : 0,
      ),
    );
  }

  return params.toString();
}


async function getAllLibraryTrackPages() {
  const tracks = [];

  for (
    let offset = 0;
    ;
    offset += TRACKS_PAGE_SIZE
  ) {
    const query = buildTrackPageQuery(
      TRACKS_PAGE_SIZE,
      offset,
    );
    const page = await apiRequest(
      `/playlists/library/tracks?${query}`,
    );
    const pageTracks = Array.isArray(page)
      ? page
      : [];

    tracks.push(...pageTracks);

    if (pageTracks.length < TRACKS_PAGE_SIZE) {
      return tracks;
    }
  }
}


export function getLibraryTracks({
  limit,
  offset,
} = {}) {
  if (
    !Number.isInteger(limit) &&
    !Number.isInteger(offset)
  ) {
    return getAllLibraryTrackPages();
  }

  const query = buildTrackPageQuery(
    limit,
    offset,
  );

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


export async function getPlaylist(
  playlistId,
  {
    limit,
    offset,
  } = {},
) {
  const encodedId = encodeURIComponent(
    playlistId,
  );
  const explicitlyPaged =
    Number.isInteger(limit) ||
    Number.isInteger(offset);

  if (explicitlyPaged) {
    const query = buildTrackPageQuery(
      limit,
      offset,
    );

    return apiRequest(
      `/playlists/${encodedId}` +
        (query ? `?${query}` : ""),
    );
  }

  const firstQuery = buildTrackPageQuery(
    TRACKS_PAGE_SIZE,
    0,
  );
  const firstPage = await apiRequest(
    `/playlists/${encodedId}?${firstQuery}`,
  );
  const tracks = Array.isArray(firstPage?.tracks)
    ? [...firstPage.tracks]
    : [];

  if (tracks.length < TRACKS_PAGE_SIZE) {
    return {
      ...firstPage,
      tracks,
    };
  }

  for (
    let pageOffset = TRACKS_PAGE_SIZE;
    ;
    pageOffset += TRACKS_PAGE_SIZE
  ) {
    const query = buildTrackPageQuery(
      TRACKS_PAGE_SIZE,
      pageOffset,
    );
    const page = await apiRequest(
      `/playlists/${encodedId}?${query}`,
    );
    const pageTracks = Array.isArray(page?.tracks)
      ? page.tracks
      : [];

    tracks.push(...pageTracks);

    if (pageTracks.length < TRACKS_PAGE_SIZE) {
      return {
        ...firstPage,
        tracks,
      };
    }
  }
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

