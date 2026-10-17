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


function catalogAbortError() {
  return new DOMException("Catalog request aborted.", "AbortError");
}


function waitForCatalog(request, signal) {
  if (!signal) return request;
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(catalogAbortError());
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    request.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}


export async function loadCatalog({
  force = false,
  signal,
} = {}) {
  if (signal?.aborted) throw catalogAbortError();
  if (catalogLoaded && !force) return catalogTracks;
  if (catalogRequest && !force) {
    return waitForCatalog(catalogRequest.promise, signal);
  }

  if (catalogRequest) catalogRequest.controller.abort();
  const request = {
    controller: new AbortController(),
    removedIds: new Set(),
    promise: null,
  };
  catalogRequest = request;
  const onAbort = () => request.controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const checkActive = () => {
    if (request.controller.signal.aborted || catalogRequest !== request) {
      throw catalogAbortError();
    }
  };

  request.promise = (async () => {
    const tracksById = new Map();
    const seenCursors = new Set();
    let cursor = null;
    do {
      checkActive();
      const params = new URLSearchParams({ page_size: "250" });
      if (cursor !== null) params.set("cursor", cursor);
      const page = await apiRequest(`/catalog/tracks?${params}`, {
        method: "GET",
        cache: "no-store",
        signal: request.controller.signal,
        headers: {
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
      });
      checkActive();
      const legacy = Array.isArray(page);
      if (!legacy && (!Array.isArray(page?.items)
          || !(page.next_cursor === null || typeof page.next_cursor === "string"))) {
        throw new Error("Invalid catalog page response.");
      }
      for (const track of legacy ? page : page.items) {
        if (track?.id != null) tracksById.set(String(track.id), track);
      }
      cursor = legacy ? null : page.next_cursor;
      if (cursor !== null) {
        if (!cursor || seenCursors.has(cursor)) {
          throw new Error("Catalog pagination returned a repeated cursor.");
        }
        seenCursors.add(cursor);
      }
    } while (cursor !== null);
    checkActive();
    const nextTracks = Array.from(tracksById.values()).filter(
      (track) => !request.removedIds.has(String(track.id)),
    );
    setCatalogTracks(nextTracks);
    catalogLoaded = true;
    return catalogTracks;
  })();

  try {
    return await waitForCatalog(request.promise, signal);
  } finally {
    signal?.removeEventListener("abort", onAbort);
    if (catalogRequest === request) catalogRequest = null;
  }
}


export function removeCatalogTrack(trackId) {
  const normalizedTrackId =
    String(trackId);

  catalogRequest?.removedIds.add(normalizedTrackId);
  setCatalogTracks(
    catalogTracks.filter(
      (track) =>
        String(track.id) !==
        normalizedTrackId,
    ),
  );
}


export function removeCatalogTracks(
  trackIds,
) {
  const normalizedTrackIds =
    new Set(
      (
        Array.isArray(
          trackIds,
        )
          ? trackIds
          : []
      ).map(
        (trackId) =>
          String(
            trackId,
          ),
      ),
    );

  if (
    normalizedTrackIds.size ===
    0
  ) {
    return;
  }

  for (const id of normalizedTrackIds) catalogRequest?.removedIds.add(id);

  setCatalogTracks(
    catalogTracks.filter(
      (track) =>
        !normalizedTrackIds.has(
          String(
            track.id,
          ),
        ),
    ),
  );
}


export async function deleteCatalogTracks(
  trackIds,
) {
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
    return {
      success:
        true,
      deleted_track_ids:
        [],
      deleted_count:
        0,
      failed:
        [],
      deleted_b2_versions:
        0,
    };
  }

  const previousTracks =
    catalogTracks;

  removeCatalogTracks(
    normalizedTrackIds,
  );

  try {
    const result =
      await apiRequest(
        "/admin/tracks/delete-bulk",
        {
          method:
            "POST",

          cache:
            "no-store",

          body:
            JSON.stringify({
              track_ids:
                normalizedTrackIds,
            }),
        },
      );

    const deletedTrackIds =
      Array.isArray(
        result?.deleted_track_ids,
      )
        ? result.deleted_track_ids.map(
            (trackId) =>
              String(
                trackId,
              ),
          )
        : [];

    removeCatalogTracks(
      deletedTrackIds,
    );

    deletedTrackIds.forEach(
      (trackId) => {
        player.stopTrack(
          trackId,
        );
      },
    );

    await Promise.allSettled(
      deletedTrackIds.map(
        (trackId) =>
          clearCachedTrack(
            trackId,
          ),
      ),
    );

    if (
      Array.isArray(
        result?.failed,
      ) &&
      result.failed.length >
        0
    ) {
      await loadCatalog({
        force:
          true,
      }).catch(
        () => {},
      );
    }

    return result;

  } catch (error) {
    setCatalogTracks(
      previousTracks,
    );

    await loadCatalog({
      force:
        true,
    }).catch(
      () => {},
    );

    throw error;
  }
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
