import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  API_BASE,
} from "../../api/client.js";

import {
  resolveArtworkUrl,
} from "../../artworkUrl.js";

import * as player from
  "../../audioPlayer.js";

import {
  getDownloadedPlaylists,
  getOfflineOwnerKey,
  getPlaylistDownloadJob,
  getPlaylistDownloadJobId,
  reconcileDownloadedPlaylistMembership,
  removePlaylistFromOffline,
  searchDownloadedTracks,
  startPlaylistDownloadForOffline,
} from "../../offlineDownloads.js";

import {
  getSearchPreferences,
  saveSearchPreferences,
  searchHypersync,
  SEARCH_SORT_OPTIONS,
} from "../../searchApi.js";

import {
  SEARCH_QUICK_COMMANDS,
} from "../../constants.js";

import {
  alphabetizeSearchResults,
} from "../../searchAlphabetical.js";

import {
  pickTopSignal,
} from "../../searchTopSignal.js";

import Avatar from
  "../profile/Avatar.jsx";

import Icon from
  "../ui/Icon.jsx";

import DownloadRemovalConfirm from
  "../ui/DownloadRemovalConfirm.jsx";

import TrackActionMenu from
  "../music/TrackActionMenu.jsx";

import useTrackActionMenu from
  "../../hooks/useTrackActionMenu.js";

import {
  getPlaylist,
  savePlaylist,
  unsavePlaylist,
} from "../../playlistApi.js";


const EMPTY_RESULTS = {
  query: "",
  interpreted_query: "",
  intent: "general",
  sort_mode: "smart",
  processing_ms: 0,

  counts: {
  tracks: 0,
  artists: 0,
  collaborations: 0,
  albums: 0,
  people: 0,
  playlists: 0,
},

  tracks: [],
  artists: [],
  collaborations: [],
  albums: [],
  people: [],
  playlists: [],
};


const FILTERS = [
  ["all", "All"],
  ["albums", "Albums"],
  ["artists", "Artists"],
  [
    "collaborations",
    "Collaborations",
  ],
  ["people", "People"],
  ["playlists", "Playlists"],
  ["tracks", "Tracks"],
];

function memberFor(value) {
  if (!value) {
    return "New member";
  }

  const days = Math.max(
    0,
    Math.floor(
      (
        Date.now() -
        new Date(value).getTime()
      ) /
        86400000,
    ),
  );

  if (days < 30) {
    return `${Math.max(
      days,
      1,
    )}d on HyperSync`;
  }

  if (days < 365) {
    return `${Math.max(
      1,
      Math.floor(days / 30),
    )}mo on HyperSync`;
  }

  return `${Math.floor(
    days / 365,
  )}y on HyperSync`;
}


function formatDuration(seconds) {
  const safe = Number(seconds);

  if (
    !Number.isFinite(safe) ||
    safe <= 0
  ) {
    return "--:--";
  }

  const minutes =
    Math.floor(
      safe / 60,
    );

  const remainder =
    Math.floor(
      safe % 60,
    )
      .toString()
      .padStart(
        2,
        "0",
      );

  return (
    `${minutes}:${remainder}`
  );
}


function totalCount(
  counts,
) {
  return (
    Number(
      counts?.tracks || 0,
    ) +
    Number(
      counts?.artists || 0,
    ) +
    Number(
      counts?.collaborations || 0,
    ) +
    Number(
      counts?.albums || 0,
    ) +
    Number(
      counts?.people || 0,
    ) +
    Number(
      counts?.playlists || 0,
    )
  );
}


function filterCount(
  filter,
  counts,
) {
  if (filter === "all") {
    return totalCount(
      counts
    );
  }

  return Number(
    counts?.[filter] || 0,
  );
}

function SearchEntityPanel({
  eyebrow,
  title,
  count,
  modifier,
  children,
}) {
  return (
    <section
      className={
        "hs-search-section " +
        "hs-search-discovery-panel " +
        modifier
      }
    >
      <div className="hs-search-section__heading">

        <div>
          <span>
            {eyebrow}
          </span>

          <h3>
            {title}
          </h3>
        </div>

        <strong>
          {count}
        </strong>

      </div>

      <div className="hs-search-entity-grid">
        {children}
      </div>

    </section>
  );
}

function SearchPage({
  query,
  onQueryChange,
  onOpenProfile,
  onOpenPlaylist,
  onOpenAuth,
  currentUser,
  resetToken = 0,
  activePlaylistDownloads = [],
}) {
  const trackActionMenu =
  useTrackActionMenu();

  const normalizedQuery =
    query.trim();

  const isRegistered =
    currentUser?.account_type ===
    "registered";

  const offlineOwnerKey =
    getOfflineOwnerKey(
      currentUser,
    );

  const [
  openedPlaylist,
  setOpenedPlaylist,
] = useState(null);

const [
  playlistOpeningId,
  setPlaylistOpeningId,
] = useState(null);

const [
  playlistError,
  setPlaylistError,
] = useState("");

const [
  playlistActionBusy,
  setPlaylistActionBusy,
] = useState(false);

const [
  playlistDownload,
  setPlaylistDownload,
] = useState({
  status: "idle",
  progress: 0,
  trackProgress: {},
});

const playlistRowDownloads =
  useMemo(
    () =>
      Object.fromEntries(
        activePlaylistDownloads.map(
          (download) => [
            String(
              download.playlistId,
            ),
            {
              status:
                download.state,
              progress:
                download.progress,
            },
          ],
        ),
      ),
    [
      activePlaylistDownloads,
    ],
  );

const [
  removeDownloadOpen,
  setRemoveDownloadOpen,
] = useState(false);


useEffect(() => {
  const activeOpenedDownload =
    activePlaylistDownloads.find(
      (download) =>
        String(
          download.playlistId,
        ) ===
        String(
          openedPlaylist?.id ??
          "",
        ),
    ) ??
    null;

  if (activeOpenedDownload) {
    setPlaylistDownload({
      status:
        "downloading",
      progress:
        activeOpenedDownload
          .progress,
      trackProgress:
        activeOpenedDownload
          .trackProgress ??
        {},
    });
  }
}, [
  activePlaylistDownloads,
  openedPlaylist?.id,
]);

const [
  removingDownload,
  setRemovingDownload,
] = useState(false);

useEffect(() => {
  const handleOfflinePlaylistUpdated =
    async (event) => {
      const playlistId =
        event?.detail
          ?.playlistId;

      if (
        !playlistId ||
        String(
          openedPlaylist?.id ??
          "",
        ) !==
          String(
            playlistId,
          )
      ) {
        return;
      }

      try {
        const [
          refreshed,
          downloads,
        ] =
          await Promise.all([
            getPlaylist(
              playlistId,
            ),
            getDownloadedPlaylists(
              offlineOwnerKey,
            ),
          ]);

        setOpenedPlaylist(
          refreshed,
        );

        const downloaded =
          downloads.find(
            (playlist) =>
              String(
                playlist.id,
              ) ===
              String(
                playlistId,
              ),
          );

        if (downloaded) {
          setPlaylistDownload({
            status:
              "downloaded",
            progress:
              1,
            trackProgress:
              Object.fromEntries(
                downloaded.tracks.map(
                  (track) => [
                    String(
                      track.id,
                    ),
                    {
                      status:
                        "downloaded",
                      progress:
                        1,
                    },
                  ],
                ),
              ),
          });
        }
      } catch {
        // The global update action already
        // completed; this only syncs visible UI.
      }
    };

  window.addEventListener(
    "hypersync:offline-playlist-updated",
    handleOfflinePlaylistUpdated,
  );

  return () => {
    window.removeEventListener(
      "hypersync:offline-playlist-updated",
      handleOfflinePlaylistUpdated,
    );
  };
}, [
  offlineOwnerKey,
  openedPlaylist?.id,
]);


useEffect(() => {
  setOpenedPlaylist(
    null,
  );

  setPlaylistError(
    "",
  );

  setPlaylistDownload({
    status: "idle",
    progress: 0,
    trackProgress: {},
  });
}, [
  resetToken,
]);

  const [
    sortMode,
    setSortMode,
  ] = useState("smart");

  const [
    preferenceReady,
    setPreferenceReady,
  ] = useState(
    !currentUser,
  );

  const [
    preferenceStatus,
    setPreferenceStatus,
  ] = useState(
    currentUser
      ? "loading"
      : "guest",
  );

  const [
    activeFilter,
    setActiveFilter,
  ] = useState("all");

  const [
    selectedTrackIndex,
    setSelectedTrackIndex,
  ] = useState(-1);

  const [
  currentTrackId,
  setCurrentTrackId,
  ] = useState(
  () =>
    player.getState()?.trackId
      ? String(
          player.getState().trackId,
        )
      : null,
  );

  const [
    results,
    setResults,
  ] = useState(
    EMPTY_RESULTS,
  );

  const [
    loading,
    setLoading,
  ] = useState(false);

  const [
    searchError,
    setSearchError,
  ] = useState("");

  const searchInputRef =
  useRef(null);


  /*
   * Load the user's dropdown
   * choice from PostgreSQL.
   *
   * No localStorage is used.
   */
  useEffect(() => {
    let cancelled = false;

    if (!currentUser) {
      setSortMode("smart");

      setPreferenceReady(
        true,
      );

      setPreferenceStatus(
        "guest",
      );

      return undefined;
    }

    setPreferenceReady(false);

    setPreferenceStatus(
      "loading",
    );

    getSearchPreferences()
      .then((data) => {
        if (cancelled) {
          return;
        }

        setSortMode(
          data?.sort_mode ||
            "smart",
        );

        setPreferenceStatus(
          "synced",
        );

        setPreferenceReady(
          true,
        );
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        setSortMode("smart");

        setPreferenceStatus(
          "error",
        );

        setPreferenceReady(
          true,
        );
      });

    return () => {
      cancelled = true;
    };
  }, [
    currentUser?.username,
  ]);

  useEffect(() => {
  return player.subscribe(
    (nextState) => {
      setCurrentTrackId(
        nextState?.trackId
          ? String(
              nextState.trackId,
            )
          : null,
      );
    },
  );
}, []);


  /*
   * Search debounce.
   *
   * Old SearchPage hit both
   * endpoints immediately after
   * every query change.
   *
   * We wait 220ms and abort stale
   * searches while the user types.
   */
  useEffect(() => {
    if (!preferenceReady) {
      return undefined;
    }

    if (!normalizedQuery) {
      setResults(
        EMPTY_RESULTS,
      );

      setLoading(false);
      setSearchError("");

      setSelectedTrackIndex(
        -1,
      );

      return undefined;
    }

    const controller =
      new AbortController();

    setLoading(true);
    setSearchError("");

    const setLocalResults =
      (localTracks) => {
        setResults({
          ...EMPTY_RESULTS,
          query:
            normalizedQuery,
          interpreted_query:
            normalizedQuery,
          counts: {
            ...EMPTY_RESULTS.counts,
            tracks:
              localTracks.length,
          },
          tracks:
            localTracks,
        });

        setSelectedTrackIndex(
          -1,
        );
      };

    const timer =
      window.setTimeout(
        async () => {
          const offline =
            typeof navigator !==
              "undefined" &&
            navigator.onLine ===
              false;

          if (offline) {
            try {
              const localTracks =
                await searchDownloadedTracks(
                  normalizedQuery,
                  offlineOwnerKey,
                );

              if (
                controller.signal
                  .aborted
              ) {
                return;
              }

              setLocalResults(
                localTracks,
              );

              setSearchError(
                localTracks.length > 0
                  ? ""
                  : "No downloaded matches are available offline.",
              );
            } catch {
              if (
                !controller.signal
                  .aborted
              ) {
                setLocalResults(
                  [],
                );

                setSearchError(
                  "Unable to search downloaded tracks.",
                );
              }
            } finally {
              if (
                !controller.signal
                  .aborted
              ) {
                setLoading(false);
              }
            }

            return;
          }

          try {
            const data =
              await searchHypersync(
                normalizedQuery,
                sortMode,
                {
                  signal:
                    controller.signal,
                },
              );

            if (
              controller.signal
                .aborted
            ) {
              return;
            }

            setResults({
              ...EMPTY_RESULTS,
              ...(data || {}),

              counts: {
                ...EMPTY_RESULTS.counts,
                ...(data?.counts || {}),
              },

              tracks:
                data?.tracks || [],

              artists:
                data?.artists || [],

              collaborations:
                data?.collaborations || [],

              albums:
                data?.albums || [],

              people:
                data?.people || [],

              playlists:
                data?.playlists || [],
            });

            setSelectedTrackIndex(
              -1,
            );

            setSearchError(
              "",
            );
          } catch (error) {
            if (
              error?.name ===
              "AbortError"
            ) {
              return;
            }

            let localTracks =
              [];

            try {
              localTracks =
                await searchDownloadedTracks(
                  normalizedQuery,
                  offlineOwnerKey,
                );
            } catch {
              localTracks =
                [];
            }

            if (
              controller.signal
                .aborted
            ) {
              return;
            }

            if (
              localTracks.length > 0
            ) {
              setLocalResults(
                localTracks,
              );

              setSearchError(
                "",
              );
            } else {
              setSearchError(
                error instanceof Error
                  ? error.message
                  : "Unable to search.",
              );
            }
          } finally {
            if (
              !controller.signal
                .aborted
            ) {
              setLoading(false);
            }
          }
        },
        220,
      );

    return () => {
      window.clearTimeout(
        timer,
      );

      controller.abort();
    };

  }, [
    normalizedQuery,
    offlineOwnerKey,
    preferenceReady,
    sortMode,
  ]);

  const alphabeticalResults =
  useMemo(
    () =>
      alphabetizeSearchResults(
        results,
      ),
    [results],
  );


  const resultTotal =
    useMemo(
      () =>
        totalCount(
          results.counts,
        ),
      [results.counts],
    );

    function runQuickCommand(
  command,
) {
  setActiveFilter(
    command.filter,
  );

  setSelectedTrackIndex(
    -1,
  );

  onQueryChange(
    command.query,
  );

  if (command.focus) {
    window.requestAnimationFrame(
      () => {
        searchInputRef
          .current
          ?.focus();
      },
    );
  }
}

  /*
   * IMPORTANT:
   *
   * No extra request happens
   * when play is pressed.
   *
   * The signed B2 audio_url from
   * /api/search is placed directly
   * into the queue.
   */
  function playTrack(
    trackIndex,
  ) {
    const queue =
  alphabeticalResults.tracks.map(
    (track) => ({
      id:
        track.id,

      audioUrl:
        track.audio_url,

      artworkUrl:
        resolveArtworkUrl(
          track.artwork_url,
        ),

      mimeType:
        track.mime_type ??
        null,

      fileSize:
        track.file_size ??
        null,

      mediaVersion:
        track.media_version ??
        null,

      title:
        track.title,

      artist:
        track.artist,

      album:
        track.album ??
        "",
    }),
  );

    void player
      .playTrackQueue(
        queue,
        trackIndex,
      )
      .catch(() => {});
  }

  function activateTopSignal() {
  if (!topSignal) {
    return;
  }

  if (
    topSignal.actionType ===
    "play"
  ) {
    playTrack(
      topSignal.trackIndex,
    );

    return;
  }

  if (
    topSignal.actionType ===
    "artist"
  ) {
    onQueryChange(
      `songs by ${topSignal.item.name}`,
    );

    return;
  }

  if (
    topSignal.actionType ===
    "album"
  ) {
    onQueryChange(
      topSignal.item.title,
    );

    return;
  }

  if (
    topSignal.actionType ===
    "person"
  ) {
    onOpenProfile?.(
      topSignal.item.username,
    );
  }
}

  function handleSearchKeyDown(
    event,
  ) {
    const trackCount =
  alphabeticalResults.tracks.length;

    if (
      event.key ===
        "ArrowDown" &&
      trackCount > 0
    ) {
      event.preventDefault();

      setSelectedTrackIndex(
        (current) =>
          Math.min(
            current + 1,
            trackCount - 1,
          ),
      );

      return;
    }

    if (
      event.key ===
        "ArrowUp" &&
      trackCount > 0
    ) {
      event.preventDefault();

      setSelectedTrackIndex(
        (current) =>
          Math.max(
            current - 1,
            0,
          ),
      );

      return;
    }

    if (
      event.key ===
        "Enter" &&
      trackCount > 0
    ) {
      event.preventDefault();

      playTrack(
        selectedTrackIndex >= 0
          ? selectedTrackIndex
          : 0,
      );

      return;
    }

    if (
      event.key === "Escape"
    ) {
      onQueryChange("");
    }
  }


  function changeSortMode(
    event,
  ) {
    const nextMode =
      event.target.value;

    setSortMode(
      nextMode,
    );

    if (!currentUser) {
      setPreferenceStatus(
        "guest",
      );

      return;
    }

    setPreferenceStatus(
      "saving",
    );

    void saveSearchPreferences(
      nextMode,
    )
      .then(() => {
        setPreferenceStatus(
          "synced",
        );
      })
      .catch(() => {
        setPreferenceStatus(
          "error",
        );
      });
  }

  async function openSearchPlaylist(
  playlistId,
) {
  if (
    !playlistId ||
    playlistOpeningId
  ) {
    return;
  }

  setPlaylistOpeningId(
    String(playlistId),
  );

  setPlaylistError("");

  try {
    const [
      playlist,
      downloadedPlaylists,
      downloadJob,
    ] =
      await Promise.all([
        getPlaylist(
          playlistId,
        ),
        getDownloadedPlaylists(
              offlineOwnerKey,
            )
          .catch(
            () => [],
          ),
        getPlaylistDownloadJob(
          offlineOwnerKey,
          playlistId,
        ).catch(
          () => null,
        ),
      ]);

    await reconcileDownloadedPlaylistMembership(
      playlist,
      offlineOwnerKey,
    );

    setOpenedPlaylist(
      playlist,
    );

    const downloaded =
      downloadedPlaylists.find(
        (item) =>
          String(
            item.id,
          ) ===
          String(
            playlistId,
          ),
      ) ??
      null;

    const activeDownload =
      activePlaylistDownloads.find(
        (item) =>
          String(
            item.playlistId,
          ) ===
          String(
            playlistId,
          ),
      ) ??
      null;

    if (activeDownload) {
      setPlaylistDownload({
        status:
          "downloading",
        progress:
          activeDownload.progress,
        trackProgress:
          activeDownload.trackProgress ??
          {},
      });
    } else if (downloaded) {
      const downloadedIds =
        new Set(
          downloaded.tracks.map(
            (track) =>
              String(
                track.id,
              ),
          ),
        );

      const trackProgress =
        Object.fromEntries(
          downloaded.tracks.map(
            (track) => [
              String(
                track.id,
              ),
              {
                status:
                  "downloaded",
                progress:
                  1,
              },
            ],
          ),
        );

      const allCurrentTracksDownloaded =
        playlist.tracks.length > 0 &&
        playlist.tracks.every(
          (track) =>
            downloadedIds.has(
              String(
                track.id,
              ),
            ),
        );

      setPlaylistDownload({
        status:
          allCurrentTracksDownloaded
            ? "downloaded"
            : "idle",
        progress:
          playlist.tracks.length > 0
            ? Math.min(
                1,
                downloadedIds.size /
                  playlist.tracks.length,
              )
            : 0,
        trackProgress,
      });
    } else if (
      downloadJob?.state ===
        "paused" ||
      downloadJob?.state ===
        "downloading"
    ) {
      const totalBytes =
        Number(
          downloadJob.totalBytes ??
          0,
        );

      const downloadedBytes =
        Number(
          downloadJob.downloadedBytes ??
          0,
        );

      setPlaylistDownload({
        status: "paused",
        progress:
          totalBytes > 0
            ? Math.max(
                0,
                Math.min(
                  1,
                  downloadedBytes /
                    totalBytes,
                ),
              )
            : 0,
        trackProgress: {},
      });
    } else {
      setPlaylistDownload({
        status: "idle",
        progress: 0,
        trackProgress: {},
      });
    }
  } catch (error) {
    setPlaylistError(
      error instanceof Error
        ? error.message
        : "Unable to open playlist.",
    );
  } finally {
    setPlaylistOpeningId(
      null,
    );
  }
}


function closeSearchPlaylist() {
  setOpenedPlaylist(
    null,
  );

  setPlaylistError("");
  setRemoveDownloadOpen(
    false,
  );

  setPlaylistDownload({
    status: "idle",
    progress: 0,
    trackProgress: {},
  });
}


function playOpenedPlaylist(
  startIndex = 0,
) {
  const tracks =
    openedPlaylist?.tracks ??
    [];

  if (!tracks.length) {
    return;
  }

  const queue =
    tracks.map(
      (track) => ({
        id:
          track.id,

        audioUrl:
          track.audio_url,

        artworkUrl:
          resolveArtworkUrl(
            track.artwork_url,
          ),

        mimeType:
          track.mime_type ??
          null,

        fileSize:
          track.file_size ??
          null,

        mediaVersion:
          track.media_version ??
          null,

        title:
          track.title,

        artist:
          track.artist,

        album:
          track.album ??
          "",
      }),
    );

  void player
    .playTrackQueue(
      queue,
      startIndex,
    )
    .catch(
      () => {},
    );
}


async function toggleOpenedPlaylistSaved() {
  if (
    !openedPlaylist ||
    playlistActionBusy
  ) {
    return;
  }

  if (!currentUser) {
    onOpenAuth?.();

    return;
  }

  const shouldSave =
    !openedPlaylist.is_saved;

  setPlaylistActionBusy(
    true,
  );

  setPlaylistError("");

  setOpenedPlaylist(
    (current) => ({
      ...current,
      is_saved:
        shouldSave,
    }),
  );

  try {
    if (shouldSave) {
      await savePlaylist(
        openedPlaylist.id,
      );
    } else {
      await unsavePlaylist(
        openedPlaylist.id,
      );
    }
  } catch (error) {
    setOpenedPlaylist(
      (current) => ({
        ...current,
        is_saved:
          !shouldSave,
      }),
    );

    setPlaylistError(
      error instanceof Error
        ? error.message
        : "Unable to update your library.",
    );
  } finally {
    setPlaylistActionBusy(
      false,
    );
  }
}


async function confirmRemoveOpenedPlaylistDownload() {
  if (
    !openedPlaylist ||
    removingDownload
  ) {
    return;
  }

  setRemovingDownload(
    true,
  );

  setPlaylistError("");

  try {
    await removePlaylistFromOffline(
      openedPlaylist.id,
      offlineOwnerKey,
    );

    setPlaylistDownload({
      status: "idle",
      progress: 0,
      trackProgress: {},
    });

    setRemoveDownloadOpen(
      false,
    );
  } catch (error) {
    setPlaylistError(
      error instanceof Error
        ? error.message
        : "Unable to remove playlist download.",
    );
  } finally {
    setRemovingDownload(
      false,
    );
  }
}


async function downloadOpenedPlaylist() {
  if (
    !openedPlaylist ||
    playlistDownload.status ===
      "downloading"
  ) {
    return;
  }

  if (!isRegistered) {
    onOpenAuth?.();
    return;
  }

  setPlaylistError("");

  let playlistForDownload =
    openedPlaylist;

  try {
    /*
     * Downloading from Search should also
     * put the playlist in Library first.
     * Owned playlists are already there.
     */
    if (
      !playlistForDownload.is_owner &&
      !playlistForDownload.is_saved
    ) {
      setPlaylistActionBusy(
        true,
      );

      await savePlaylist(
        playlistForDownload.id,
      );

      playlistForDownload = {
        ...playlistForDownload,
        is_saved: true,
      };

      setOpenedPlaylist(
        playlistForDownload,
      );
    }

    /*
     * Re-fetch after saving so generated
     * playlists download the newest catalog
     * membership, not a stale Search snapshot.
     */
    playlistForDownload =
      await getPlaylist(
        playlistForDownload.id,
      );

    setOpenedPlaylist(
      playlistForDownload,
    );

    const tracks =
      playlistForDownload.tracks ??
      [];

    if (!tracks.length) {
      throw new Error(
        "This playlist has no tracks to download.",
      );
    }

    const playlistId =
      String(
        playlistForDownload.id,
      );

    setPlaylistDownload({
      status:
        "downloading",
      progress:
        0,
      trackProgress:
        {},
    });

    await startPlaylistDownloadForOffline(
      tracks,
      {
        jobId:
          getPlaylistDownloadJobId(
            offlineOwnerKey,
            playlistForDownload.id,
          ),
        ownerKey:
          offlineOwnerKey,
        jobMetadata: {
          kind:
            "playlist",
          playlistId:
            playlistForDownload.id,
          playlistTitle:
            playlistForDownload.title,
          playlistDescription:
            playlistForDownload.description ??
            null,
          playlistArtworkUrl:
            playlistForDownload.artwork_url ??
            null,
          playlistOwnerUsername:
            playlistForDownload.owner_username ??
            null,
          playlistVisibility:
            playlistForDownload.visibility ??
            null,
        },
        onProgress: ({
          progress,
          trackProgress,
        }) => {
          const safeProgress =
            Number.isFinite(
              progress,
            )
              ? progress
              : 0;

          setPlaylistDownload({
            status:
              "downloading",
            progress:
              safeProgress,
            trackProgress:
              trackProgress ??
              {},
          });

        },
      },
    );

    setPlaylistDownload({
      status:
        "downloaded",
      progress:
        1,
      trackProgress:
        Object.fromEntries(
          tracks.map(
            (track) => [
              String(track.id),
              {
                status:
                  "downloaded",
                progress:
                  1,
              },
            ],
          ),
        ),
    });

  } catch (error) {
    setPlaylistDownload({
      status:
        "error",
      progress:
        0,
      trackProgress:
        {},
    });

    if (
      typeof playlistForDownload?.id !==
        "undefined"
    ) {
      const failedPlaylistId =
        String(
          playlistForDownload.id,
        );

    }

    setPlaylistError(
      error instanceof Error
        ? error.message
        : "Unable to add and download playlist.",
    );
  } finally {
    setPlaylistActionBusy(
      false,
    );
  }
}

  const topSignal =
  useMemo(
    () =>
      pickTopSignal(
        alphabeticalResults,
      ),
    [alphabeticalResults],
  );

  const playlistDownloadPercent =
  Math.round(
    (
      playlistDownload.progress ??
      0
    ) *
      100,
  );

  const showTracks =
    activeFilter === "all" ||
    activeFilter === "tracks";

  const showPeople =
    activeFilter === "all" ||
    activeFilter === "people";

  const showPlaylists =
    activeFilter === "all" ||
    activeFilter === "playlists";

  const artistPanel =
    alphabeticalResults.artists.length > 0 ? (

      <SearchEntityPanel
        eyebrow="ENTITY INDEX"
        title="Artists"
        count={
          results.counts.artists
        }
        modifier={
          "hs-search-discovery-panel--artists"
        }
      >

        {alphabeticalResults.artists.map(
          (artist) => (

            <button
              type="button"
              key={artist.name}
              className="hs-search-entity-card"
              onClick={() => {
                onQueryChange(
                  `songs by ${artist.name}`,
                );
              }}
            >

              <span className="hs-search-entity-card__art">

                {resolveArtworkUrl(
                  artist.artwork_url,
                ) ? (
                  <img
                    src={
                      resolveArtworkUrl(
                        artist.artwork_url,
                      )
                    }
                    alt=""
                  />
                ) : (
                  <Icon
                    name="music"
                    size={26}
                  />
                )}

              </span>

              <span>

                <small>
                  ARTIST
                </small>

                <strong>
                  {artist.name}
                </strong>

                <em>
                  {artist.track_count}
                  {" "}
                  matching tracks
                </em>

              </span>

              <Icon
                name="chevron"
                size={16}
              />

            </button>
          ),
        )}

      </SearchEntityPanel>

    ) : null;


  const collaborationPanel =
    alphabeticalResults.collaborations.length >
    0 ? (

      <SearchEntityPanel
        eyebrow="RELATION INDEX"
        title="Collaborations"
        count={
          results.counts
            .collaborations
        }
        modifier={
          "hs-search-discovery-panel--collaborations"
        }
      >

        {alphabeticalResults.collaborations.map(
          (collaboration) => (

            <button
              type="button"
              key={
                collaboration.name
              }
              className="hs-search-entity-card"
              onClick={() => {
                onQueryChange(
                  `songs by ${collaboration.name}`,
                );
              }}
            >

              <span className="hs-search-entity-card__art">

                {resolveArtworkUrl(
                  collaboration.artwork_url,
                ) ? (
                  <img
                    src={
                      resolveArtworkUrl(
                        collaboration.artwork_url,
                      )
                    }
                    alt=""
                  />
                ) : (
                  <Icon
                    name="music"
                    size={26}
                  />
                )}

              </span>

              <span>

                <small>
                  COLLABORATION
                </small>

                <strong>
                  {collaboration.name}
                </strong>

                <em>
                  {
                    collaboration
                      .track_count
                  }
                  {" "}
                  matching tracks
                </em>

              </span>

              <Icon
                name="chevron"
                size={16}
              />

            </button>
          ),
        )}

      </SearchEntityPanel>

    ) : null;


  const albumPanel =
    alphabeticalResults.albums.length > 0 ? (

      <SearchEntityPanel
        eyebrow="RELEASE INDEX"
        title="Albums"
        count={
          results.counts.albums
        }
        modifier={
          "hs-search-discovery-panel--albums"
        }
      >

        {alphabeticalResults.albums.map(
          (album) => (

            <button
              type="button"
              key={
                `${album.artist}:${album.title}`
              }
              className="hs-search-entity-card"
              onClick={() => {
                onQueryChange(
                  album.title,
                );
              }}
            >

              <span className="hs-search-entity-card__art">

                {resolveArtworkUrl(
                  album.artwork_url,
                ) ? (
                  <img
                    src={
                      resolveArtworkUrl(
                        album.artwork_url,
                      )
                    }
                    alt=""
                  />
                ) : (
                  <Icon
                    name="disc"
                    size={26}
                  />
                )}

              </span>

              <span>

                <small>
                  ALBUM
                </small>

                <strong>
                  {album.title}
                </strong>

                <em>
                  {album.artist}
                </em>

              </span>

              <Icon
                name="chevron"
                size={16}
              />

            </button>
          ),
        )}

      </SearchEntityPanel>

    ) : null;


  return (
    <div className="page-stack hs-search-page">

      <section className="hs-search-console">

  <div
    className="hs-search-console__grid"
    aria-hidden="true"
  />

  <div
    className={
      "hs-search-console__ambient " +
      "hs-search-console__ambient--one"
    }
    aria-hidden="true"
  />

  <div
    className={
      "hs-search-console__ambient " +
      "hs-search-console__ambient--two"
    }
    aria-hidden="true"
  />


  <div className="hs-search-console__heading">

    <div className="hs-search-console__intro">

      <div className="hs-search-console__eyebrow-row">

        <span className="hs-search-eyebrow">
          <i aria-hidden="true" />

          HYPERSYNCED DISCOVERY
        </span>

      </div>


      <h2>
       Tune into something new
      </h2>




    </div>


    <div className="hs-search-sort">

      <label
        htmlFor="hs-search-sort-mode"
      >
      </label>

      <select
        id="hs-search-sort-mode"
        value={sortMode}
        disabled={!preferenceReady}
        onChange={changeSortMode}
      >
        {SEARCH_SORT_OPTIONS.map(
          (option) => (
            <option
              key={option.value}
              value={option.value}
            >
              {option.label}
            </option>
          ),
        )}
      </select>

      

    </div>

  </div>


  <label className="hs-search-input">

    <span className="hs-search-input__icon">
      <Icon
        name="search"
        size={23}
      />
    </span>

    <input
      ref={searchInputRef}
      type="search"
      value={query}
      placeholder={
  activeFilter === "people" &&
  !normalizedQuery
    ? "Search people by name or @username..."
    : "Search songs, artists, albums, or people..."
}
      autoComplete="off"
      spellCheck="false"
      onChange={(event) => {
        onQueryChange(
          event.target.value,
        );
      }}
      onKeyDown={
        handleSearchKeyDown
      }
    />

    <span
      className={
        loading
          ? "hs-search-scan-dot is-active"
          : "hs-search-scan-dot"
      }
      aria-hidden="true"
    />

  </label>


  <div className="hs-search-console__status">

    <span
      className={
        "hs-search-status-chip " +
        "hs-search-status-chip--primary"
      }
    >
      <i
        className={
          loading
            ? "is-scanning"
            : ""
        }
      />

      
    </span>


    <span className="hs-search-status-chip">
      {normalizedQuery
        ? `${resultTotal} RESULTS`
        : "MUSIC INDEX ONLINE"}
    </span>


    <span className="hs-search-status-chip">
      {normalizedQuery &&
      results.processing_ms
        ? `${results.processing_ms}ms`
        : "SMART MATCHING"}
    </span>

  </div>

</section>


      {openedPlaylist ? (
        <>
  <section className="hs-search-playlist-view">

    <div className="hs-search-playlist-view__nav">

      <button
        type="button"
        className="hs-search-playlist-back"
        onClick={
          closeSearchPlaylist
        }
      >
        <Icon
          name="chevron"
          size={15}
        />

        Back to search
      </button>

    </div>


    <section className="hs-search-playlist-view__hero">

      <div className="hs-search-playlist-view__art">

        {resolveArtworkUrl(
          openedPlaylist.artwork_url,
        ) ? (
          <img
            src={
              resolveArtworkUrl(
                openedPlaylist.artwork_url,
              )
            }
            alt=""
          />
        ) : (
          <div className="hs-search-playlist-view__fallback">
            <Icon
              name="playlist"
              size={32}
            />
          </div>
        )}

      </div>


      <div className="hs-search-playlist-view__copy">

        <span>
          PLAYLIST
        </span>

        <h2>
          {openedPlaylist.title}
        </h2>

        {openedPlaylist.description ? (
          <p>
            {openedPlaylist.description}
          </p>
        ) : null}

        <small>
          {
            openedPlaylist.owner_username ||
            "HyperSync"
          }
          {" • "}
          {
            openedPlaylist.tracks?.length ??
            0
          }
          {" "}
          {
            openedPlaylist.tracks?.length ===
            1
              ? "track"
              : "tracks"
          }
        </small>


        <div className="hs-search-playlist-view__actions">

          <button
            type="button"
            className="hs-search-playlist-primary"
            disabled={
              !openedPlaylist.tracks?.length
            }
            onClick={() => {
              playOpenedPlaylist(
                0,
              );
            }}
          >
            <Icon
              name="play"
              size={15}
            />

            Play
          </button>


          <button
            type="button"
            className="hs-search-playlist-action"
            disabled={
              !openedPlaylist.tracks?.length ||
              playlistDownload.status ===
                "downloading"
            }
            onClick={() => {
              if (
                playlistDownload.status ===
                  "downloaded"
              ) {
                setRemoveDownloadOpen(
                  true,
                );
              } else {
                void downloadOpenedPlaylist();
              }
            }}
          >
            <Icon
              name={
                playlistDownload.status ===
                  "downloaded"
                  ? "check"
                  : "download"
              }
              size={14}
            />

            {playlistDownload.status ===
            "downloading"
              ? `${playlistDownloadPercent}%`
              : playlistDownload.status ===
                  "downloaded"
                ? "Downloaded"
                : playlistDownload.status ===
                    "paused"
                  ? "Resume"
                  : "Download"}
          </button>


          {!openedPlaylist.is_owner ? (

  <button
    type="button"
    className="hs-search-playlist-action"
    disabled={
      playlistActionBusy
    }
    title={
      openedPlaylist.is_saved
        ? "Remove from Library"
        : "Add to Library"
    }
    onClick={() => {
      void toggleOpenedPlaylistSaved();
    }}
  >
    <Icon
      name={
        openedPlaylist.is_saved
          ? "check"
          : "plus"
      }
      size={14}
    />

    {openedPlaylist.is_saved
      ? "In Library"
      : "Add to Library"}
  </button>

) : null}

        </div>

      </div>

    </section>


    {playlistError ? (
      <section className="hs-search-message hs-search-message--error">
        <div>
          <strong>
            PLAYLIST ERROR
          </strong>

          <p>
            {playlistError}
          </p>
        </div>
      </section>
    ) : null}


    <section className="hs-search-section">

      <div className="hs-search-section__heading">

        <div>
          <span>
            PLAYLIST CONTENT
          </span>

          <h3>
            Tracks
          </h3>
        </div>

        <strong>
          {
            openedPlaylist.tracks
              ?.length ??
            0
          }
        </strong>

      </div>


      <div className="hs-search-track-list">

        {openedPlaylist.tracks?.map(
          (
            track,
            trackIndex,
          ) => {

            const artworkUrl =
              resolveArtworkUrl(
                track.artwork_url,
              );

            const isCurrentTrack =
              currentTrackId !== null &&
              String(
                track.id,
              ) ===
                currentTrackId;


            return (

              <div
                key={
                  track.playlist_track_id ??
                  `${track.id}-${trackIndex}`
                }
                role="button"
                tabIndex={0}
                {...trackActionMenu.getTriggerProps(
                  track,
                )}
                className={[
                  "hs-search-track",
                  "hs-search-track--playlist-download",

                  isCurrentTrack
                    ? "is-current-track"
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => {
                  playOpenedPlaylist(
                    trackIndex,
                  );
                }}
                onKeyDown={(
                  event,
                ) => {
                  if (
                    event.key ===
                      "Enter" ||
                    event.key ===
                      " "
                  ) {
                    event.preventDefault();

                    playOpenedPlaylist(
                      trackIndex,
                    );
                  }
                }}
              >

                <span className="hs-search-track__rank">
                  {String(
                    trackIndex + 1,
                  ).padStart(
                    2,
                    "0",
                  )}
                </span>


                <span className="hs-search-track__art">

                  {artworkUrl ? (
                    <img
                      src={
                        artworkUrl
                      }
                      alt=""
                      loading={
                        trackIndex < 6
                          ? "eager"
                          : "lazy"
                      }
                    />
                  ) : (
                    <Icon
                      name="music"
                      size={20}
                    />
                  )}

                  <i aria-hidden="true">
                    <Icon
                      name="play"
                      size={15}
                    />
                  </i>

                </span>


                <span className="hs-search-track__copy">

                  <strong>
                    {track.title}
                  </strong>

                  <small>
                    {track.artist}

                    {track.album
                      ? ` • ${track.album}`
                      : ""}
                  </small>

                </span>


                <span className="hs-search-track__signals">

                  <em>
                    PLAYLIST TRACK
                  </em>

                  <small>
                    {track.album ||
                      openedPlaylist.title}
                  </small>

                </span>


                <span className="hs-search-track__duration">
                  {formatDuration(
                    track.duration_seconds,
                  )}
                </span>


                {(() => {
                  const state =
                    playlistDownload
                      .trackProgress?.[
                        String(
                          track.id,
                        )
                      ] ??
                    null;

                  if (
                    !state &&
                    playlistDownload.status ===
                      "idle"
                  ) {
                    return (
                      <span
                        className="hs-search-track__download hs-search-playlist-spacer"
                        aria-hidden="true"
                      />
                    );
                  }

                  const progress =
                    Math.round(
                      (
                        state?.progress ??
                        (
                          playlistDownload.status ===
                            "downloaded"
                            ? 1
                            : 0
                        )
                      ) *
                        100,
                    );

                  const done =
                    state?.status ===
                      "downloaded" ||
                    playlistDownload.status ===
                      "downloaded";

                  return (
                    <span
                      className={[
                        "hs-search-track__download",
                        done
                          ? "is-downloaded"
                          : "is-downloading",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      style={{
                        "--download-progress":
                          `${progress}%`,
                      }}
                      title={
                        done
                          ? "Downloaded"
                          : `Downloading ${progress}%`
                      }
                      aria-label={
                        done
                          ? `${track.title} downloaded`
                          : `Downloading ${track.title}: ${progress}%`
                      }
                    >
                      {done ? (
                        <Icon
                          name="check"
                          size={15}
                        />
                      ) : progress > 0 ? (
                        <span className="hs-search-track__download-progress">
                          {progress}
                        </span>
                      ) : (
                        <Icon
                          name="download"
                          size={15}
                        />
                      )}
                    </span>
                  );
                })()}


                <span className="hs-search-track__play">
                  <Icon
                    name="play"
                    size={16}
                  />
                </span>

              </div>
            );
          },
        )}

      </div>

    </section>

  </section>

    <DownloadRemovalConfirm
      open={
        removeDownloadOpen
      }
      playlistTitle={
        openedPlaylist?.title
      }
      busy={
        removingDownload
      }
      onCancel={() => {
        if (
          !removingDownload
        ) {
          setRemoveDownloadOpen(
            false,
          );
        }
      }}
      onConfirm={() => {
        void confirmRemoveOpenedPlaylistDownload();
      }}
    />
        </>
) : normalizedQuery ? (
        <>

          <section className="hs-search-filterbar">

            {FILTERS.map(
              ([
                filter,
                label,
              ]) => (
                <button
                  type="button"
                  key={filter}
                  className={
                    activeFilter ===
                    filter
                      ? "is-active"
                      : ""
                  }
                  onClick={() => {
                    setActiveFilter(
                      filter,
                    );
                  }}
                >
                  <span>
                    {label}
                  </span>

                  <strong>
                    {filterCount(
                      filter,
                      results.counts,
                    )}
                  </strong>
                </button>
              ),
            )}

          </section>


          {searchError ? (
            <section className="hs-search-message hs-search-message--error">

              <Icon
                name="search"
                size={24}
              />

              <div>
                <strong>
                  SEARCH CORE ERROR
                </strong>

                <p>
                  {searchError}
                </p>
              </div>

            </section>
          ) : null}


                    {showPlaylists &&
          results.playlists?.length > 0 ? (

            <section className="hs-search-section">

              <div className="hs-search-section__heading">

                <div>
                  <span>
                    PLAYLIST INDEX
                  </span>

                  <h3>
                    Playlists
                  </h3>
                </div>

                <strong>
                  {
                    results.counts
                      .playlists
                  }
                </strong>

              </div>


              <div className="hs-search-track-list">

                {results.playlists.map(
                  (
                    playlist,
                    playlistIndex,
                  ) => {

                    const artworkUrl =
                      resolveArtworkUrl(
                        playlist.artwork_url,
                      );

                    const rowDownload =
                      playlistRowDownloads[
                        String(
                          playlist.id,
                        )
                      ] ??
                      null;

                    const rowDownloadPercent =
                      Math.round(
                        Math.max(
                          0,
                          Math.min(
                            1,
                            Number(
                              rowDownload
                                ?.progress ??
                              0,
                            ) || 0,
                          ),
                        ) *
                          100,
                      );

                    return (
                      <div
                        key={
                          playlist.id
                        }
                        role="button"
                        tabIndex={0}
                        className="hs-search-track"
                        onClick={() => {
                        void openSearchPlaylist(
                        playlist.id,
                        );
                      }}
                        onKeyDown={(
                          event,
                        ) => {
                          if (
                            event.key ===
                              "Enter" ||
                            event.key ===
                              " "
                          ) {
                            event.preventDefault();

                            void openSearchPlaylist(
                            playlist.id,
                            );
                          }
                        }}
                      >

                        <span className="hs-search-track__rank">
                          {String(
                            playlistIndex +
                              1,
                          ).padStart(
                            2,
                            "0",
                          )}
                        </span>


                        <span className="hs-search-track__art">

                          {artworkUrl ? (
                            <img
                              src={
                                artworkUrl
                              }
                              alt=""
                            />
                          ) : (
                            <Icon
                              name="playlist"
                              size={20}
                            />
                          )}

                          <i aria-hidden="true">
                            <Icon
                              name="chevron"
                              size={15}
                            />
                          </i>

                        </span>


                        <span className="hs-search-track__copy">

                          <strong>
                            {
                              playlist.title
                            }
                          </strong>

                          <small>
                            HyperSynced
                          </small>

                        </span>


                        <span className="hs-search-track__signals">

                          <em>
                            {
                              playlist.match_label ||
                              "GENERATED PLAYLIST"
                            }
                          </em>

                          <small>
                            {
                              playlist.track_count
                            }
                            {" "}
                            tracks
                          </small>

                        </span>


                        <span className="hs-search-track__duration">
                          {
                            playlist.track_count
                          }
                        </span>


                        <span className="hs-search-track__play">
                          {rowDownload?.status ===
                          "downloading" ? (
                            <span
                              className="hs-search-track__download is-downloading hs-playlist-row-download-progress"
                              style={{
                                "--download-progress":
                                  `${rowDownloadPercent}%`,
                              }}
                              title={`Downloading ${playlist.title}: ${rowDownloadPercent}%`}
                              aria-label={`Downloading ${playlist.title}: ${rowDownloadPercent}%`}
                            >
                              <span className="hs-search-track__download-progress">
                                {rowDownloadPercent}
                              </span>
                            </span>
                          ) : (
                            <Icon
                              name="chevron"
                              size={16}
                            />
                          )}
                        </span>

                      </div>
                    );
                  },
                )}

              </div>

            </section>

          ) : null}


          {showTracks &&
alphabeticalResults.tracks.length > 0 ? (

            <section className="hs-search-section">

              <div className="hs-search-section__heading">

                <div>
                  <span>
                    AUDIO INDEX
                  </span>

                  <h3>
                    Tracks
                  </h3>
                </div>

                <strong>
                  {results.counts.tracks}
                </strong>

              </div>


              <div className="hs-search-track-list">

                {alphabeticalResults.tracks.map(
                  (
                    track,
                    trackIndex,
                  ) => {

                    const artworkUrl =
                      resolveArtworkUrl(
                        track.artwork_url,
                      );

                    const isCurrentTrack =
                      activeFilter === "all" &&
                      currentTrackId !== null &&
                      String(track.id) ===
                        currentTrackId;

                    return (
                      <div
                        key={track.id}
                        role="button"
                        tabIndex={0}
                        {...trackActionMenu.getTriggerProps(
                        track,
                        )}
                        className={[
                        "hs-search-track",
                      

                        selectedTrackIndex ===
                        trackIndex
                        ? "is-selected"
                        : "",

                        isCurrentTrack
                        ? "is-current-track"
                        : "",
                        ]
                        .filter(Boolean)
                        .join(" ")}
                        onMouseEnter={() => {
                        setSelectedTrackIndex(
                        trackIndex,
                        );
                        }}
                        onMouseLeave={() => {
                        setSelectedTrackIndex(
                        -1,
                        );
                        }}
                        onClick={() => {
                        playTrack(
                        trackIndex,
                        );
                        }}
                        onKeyDown={(event) => {
                        if (
                        event.key ===
                        "Enter" ||
                        event.key ===
                        " "
                        ) {
                        event.preventDefault();

                        playTrack(
                        trackIndex,
                        );
                      }
                    }}
                      >

                        <span className="hs-search-track__rank">
                          {String(
                            trackIndex + 1,
                          ).padStart(
                            2,
                            "0",
                          )}
                        </span>


                        <span className="hs-search-track__art">

                          {artworkUrl ? (
                            <img
                              src={artworkUrl}
                              alt=""
                              loading={
                                trackIndex < 6
                                  ? "eager"
                                  : "lazy"
                              }
                              fetchPriority={
                                trackIndex < 3
                                  ? "high"
                                  : "auto"
                              }
                            />
                          ) : (
                            <Icon
                              name="music"
                              size={20}
                            />
                          )}

                          <i aria-hidden="true">
                            <Icon
                              name="play"
                              size={15}
                            />
                          </i>

                        </span>


                        <span className="hs-search-track__copy">

                          <strong>
                            {track.title}
                          </strong>

                          <small>
                            {track.artist}

                            {track.album
                              ? ` • ${track.album}`
                              : ""}
                          </small>

                        </span>


                        <span className="hs-search-track__signals">

                          <em>
                            {track.user_play_count > 0
                              ? "IN YOUR ROTATION"
                              : track.match_label}
                          </em>

                          <small>
                            {track.global_play_count}
                            {" "}
                            plays
                          </small>

                        </span>


                        <span className="hs-search-track__duration">
                          {formatDuration(
                            track.duration_seconds,
                          )}
                        </span>


                        <span className="hs-search-track__play">
                          <Icon
                            name="play"
                            size={16}
                          />
                        </span>

                      </div>
                    );
                  },
                )}

              </div>

            </section>
          ) : null}


                    {activeFilter === "all" &&
          (
            artistPanel ||
            collaborationPanel ||
            albumPanel
          ) ? (

            <div className="hs-search-discovery-shell">

              <div
                className="hs-search-discovery-mobile-head"
                aria-hidden="true"
              >
                <span>
                  DISCOVERY DECK
                </span>

                <small>
                  SWIPE TO EXPLORE
                  {" "}
                  →
                </small>
              </div>

              <div className="hs-search-discovery-grid">

                {albumPanel}

                {artistPanel}

                {collaborationPanel}

              </div>

            </div>

          ) : null}


          {activeFilter === "artists"
            ? artistPanel
            : null}


          {activeFilter ===
          "collaborations"
            ? collaborationPanel
            : null}


          {activeFilter === "albums"
            ? albumPanel
            : null}


          {showPeople &&
          alphabeticalResults.people.length > 0 ? (

            <section className="hs-search-section">

              <div className="hs-search-section__heading">

                <div>
                  <span>
                    SOCIAL INDEX
                  </span>

                  <h3>
                    People
                  </h3>
                </div>

                <strong>
                  {results.counts.people}
                </strong>

              </div>


              <div className="hs-search-people-list">

                {alphabeticalResults.people.map(
                  (person) => (

                    <button
                      type="button"
                      className="hs-search-person"
                      key={
                        person.username
                      }
                      onClick={() => {
                        onOpenProfile?.(
                          person.username,
                        );
                      }}
                    >

                      <Avatar
                        src={
                          person.avatar_url
                        }
                        name={
                          person.display_name
                        }
                        size="small"
                      />

                      <span>

                        <small>
                          {person.match_label}
                        </small>

                        <strong>
                          {person.display_name}
                        </strong>

                        <em>
                          @{person.username}
                          {" • "}
                          {person.followers_count}
                          {" followers • "}
                          {memberFor(
                            person.member_since,
                          )}
                        </em>

                      </span>

                      <Icon
                        name="chevron"
                        size={16}
                      />

                    </button>
                  ),
                )}

              </div>

            </section>
          ) : null}

        </>
      ) : (

        <section className="hs-search-standby">

          <div className="hs-search-standby__symbol">
            <Icon
              name="search"
              size={34}
            />
          </div>

          <span>
            SEARCH ARRAY STANDBY
          </span>

          <h3>
            Try searching for something you love or use one of the quick commands below.
          </h3>

          <p>
            Try typing a song title, artist, album, or username. HyperSync will prioritize the strongest music matches first.
          </p>

          <div className="hs-search-quick-commands">

            {SEARCH_QUICK_COMMANDS.map(
  (command) => (
    <button
      type="button"
      key={command.id}
      onClick={() => {
        runQuickCommand(
          command,
        );
      }}
    >
      {command.label}
    </button>
  ),
)}
          </div>
        </section>
      )}

      <TrackActionMenu
        menu={
          trackActionMenu.menu
        }
        onClose={
          trackActionMenu.closeMenu
        }
        currentUser={
          currentUser
        }
        onRequireAuth={
          onOpenAuth
        }
      />


    </div>
  );
}


export default SearchPage;
