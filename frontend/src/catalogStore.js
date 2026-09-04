import {
  useCallback,
  useEffect,
  useState,
} from "react";

import { apiRequest } from "./api/client.js";

import * as player
  from "./audioPlayer.js";

import { clearCachedTrack } from "./mediaCache.js";

let catalogTracks = [];

let catalogLoaded = false;

let catalogRequest = null;

const listeners = new Set();


function notifyCatalogListeners() {
  for (const listener of listeners) {
    listener(catalogTracks);
  }
}


function setCatalogTracks(nextTracks) {
  catalogTracks = nextTracks;

  notifyCatalogListeners();
}


export function subscribeToCatalog(listener) {
  listeners.add(listener);

  listener(catalogTracks);

  return () => {
    listeners.delete(listener);
  };
}


export async function loadCatalog({
  force = false,
} = {}) {
  if (catalogLoaded && !force) {
    return catalogTracks;
  }

  if (catalogRequest) {
    return catalogRequest;
  }

  catalogRequest = (async () => {
    const tracks = await apiRequest(
      "/catalog/tracks",
      {
        method: "GET",

        cache: "no-store",

        headers: {
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
      },
    );

    const nextTracks =
  Array.isArray(tracks)
    ? tracks
    : [];

setCatalogTracks(
  nextTracks,
);


catalogLoaded = true;

    return catalogTracks;
  })();

  try {
    return await catalogRequest;
  } finally {
    catalogRequest = null;
  }
}


export function removeCatalogTrack(trackId) {
  const normalizedTrackId =
    String(trackId);

  setCatalogTracks(
    catalogTracks.filter(
      (track) =>
        String(track.id) !==
        normalizedTrackId,
    ),
  );
}


export async function deleteCatalogTrack(
  trackId,
) {
  const normalizedTrackId =
    String(trackId);

  const previousTracks =
    catalogTracks;

  /*
   * Remove the song from every mounted UI
   * immediately.
   */

  removeCatalogTrack(
    normalizedTrackId,
  );

  try {
    const result = await apiRequest(
      `/admin/tracks/${normalizedTrackId}`,
      {
        method: "DELETE",

        cache: "no-store",
      },
    );

    /*
     * Use the ID returned by the backend too,
     * just in case formatting differs.
     */

    if (result?.deleted_track_id) {
  removeCatalogTrack(
    result.deleted_track_id,
  );
}

const deletedTrackId =
  result?.deleted_track_id ??
  normalizedTrackId;


/*
 * Stop playback if the deleted song
 * is currently playing.
 */

player.stopTrack(
  deletedTrackId,
);


/*
 * Remove both the cached audio and
 * cached artwork for this song.
 *
 * Do this only after the backend has
 * successfully deleted the B2 files
 * and database row.
 */

await Promise.allSettled([
  clearCachedTrack(
    deletedTrackId,
  ),
]);

return result;

  } catch (error) {

    /*
     * The delete failed.
     * Put the UI back in sync with the real
     * backend state.
     */

    setCatalogTracks(
      previousTracks,
    );

    await loadCatalog({
      force: true,
    }).catch(() => {});

    throw error;
  }
}


export function useCatalogTracks() {
  const [tracks, setTracks] =
    useState(catalogTracks);

  const [loading, setLoading] =
    useState(!catalogLoaded);

  const [error, setError] =
    useState("");


  useEffect(() => {
    return subscribeToCatalog(
      setTracks,
    );
  }, []);


  const refreshCatalog =
    useCallback(
      async ({
        force = false,
      } = {}) => {
        setLoading(true);
        setError("");

        try {
          await loadCatalog({
            force,
          });
        } catch (error) {
          setError(
            error instanceof Error
              ? error.message
              : "Unable to load catalog.",
          );
        } finally {
          setLoading(false);
        }
      },
      [],
    );


  useEffect(() => {
    refreshCatalog();
  }, [
    refreshCatalog,
  ]);


  return {
    tracks,
    loading,
    error,
    refreshCatalog,
  };
}
