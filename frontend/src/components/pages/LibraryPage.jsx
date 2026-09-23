import {
  useCallback,
  useEffect,
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
  createPlaylist,
  deletePlaylist,
  getMyPlaylists,
  getPlaylist,
  getSavedPlaylists,
  removeTrackFromPlaylist,
  reorderPlaylistTracks,
} from "../../playlistApi.js";

import {
  LIBRARY_TABS,
} from "../../constants.js";

import Icon from
  "../ui/Icon.jsx";

import TrackActionMenu from
  "../music/TrackActionMenu.jsx";

import useTrackActionMenu from
  "../../hooks/useTrackActionMenu.js";

import {
  downloadTracksForOffline,
  getDownloadedPlaylists,
} from "../../offlineDownloads.js";

import {
  getCachedLibrary,
  getCachedPlaylist,
  setCachedLibrary,
  setCachedPlaylist,
} from "../../libraryCache.js";

function formatDuration(
  seconds,
) {
  const total =
    Number(
      seconds ?? 0,
    );

  if (
    !Number.isFinite(total) ||
    total <= 0
  ) {
    return "0 min";
  }

  const minutes =
    Math.floor(
      total / 60,
    );

  const hours =
    Math.floor(
      minutes / 60,
    );

  if (hours > 0) {
    return (
      `${hours} hr ${minutes % 60} min`
    );
  }

  return `${minutes} min`;
}


function formatTrackDuration(
  seconds,
) {
  const value =
    Number(
      seconds,
    );

  if (
    !Number.isFinite(value) ||
    value <= 0
  ) {
    return "--:--";
  }

  const minutes =
    Math.floor(
      value / 60,
    );

  const remainder =
    Math.floor(
      value % 60,
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


function LibraryPage({
  currentUser,
  onOpenAuth,
  initialPlaylistId = null,
  onInitialPlaylistHandled,
  resetToken = 0,
}) {
  const trackActionMenu =
  useTrackActionMenu();
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
  const [
    activeTab,
    setActiveTab,
  ] = useState(
    "Playlists",
  );

  const libraryCacheKey =
  currentUser?.id ??
  currentUser?.username ??
  "anonymous";

  const cachedLibrary =
  getCachedLibrary(
    libraryCacheKey,
  );

const [
  ownedPlaylists,
  setOwnedPlaylists,
] = useState(
  () =>
    cachedLibrary?.owned ??
    [],
);

const [
  savedPlaylists,
  setSavedPlaylists,
] = useState(
  () =>
    cachedLibrary?.saved ??
    [],
);

  const [
    selectedPlaylist,
    setSelectedPlaylist,
  ] = useState(
    null,
  );

  useEffect(() => {
  setSelectedPlaylist(
    null,
  );

  setOpeningPlaylistId(
    null,
  );

  setError("");

  setPlaylistDownload({
    status: "idle",
    progress: 0,
    trackProgress: {},
  });
}, [
  resetToken,
]);

  const [
    loading,
    setLoading,
  ] = useState(
    false,
  );

  const [
    openingPlaylistId,
    setOpeningPlaylistId,
  ] = useState(
    null,
  );

  const [
    error,
    setError,
  ] = useState(
    "",
  );

  const [
    createOpen,
    setCreateOpen,
  ] = useState(
    false,
  );

  const [
    createTitle,
    setCreateTitle,
  ] = useState(
    "",
  );

  const [
    createDescription,
    setCreateDescription,
  ] = useState(
    "",
  );

  const [
    createVisibility,
    setCreateVisibility,
  ] = useState(
    "private",
  );

  const [
    creating,
    setCreating,
  ] = useState(
    false,
  );

  const [
    actionBusy,
    setActionBusy,
  ] = useState(
    false,
  );

  const [
  playlistDownload,
  setPlaylistDownload,
] = useState({
  status: "idle",
  progress: 0,
});

  const [
    downloadedPlaylists,
    setDownloadedPlaylists,
  ] = useState([]);

  useEffect(() => {
    let cancelled =
      false;

    void getDownloadedPlaylists()
      .then((playlists) => {
        if (!cancelled) {
          setDownloadedPlaylists(
            playlists,
          );
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDownloadedPlaylists(
            [],
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    resetToken,
    playlistDownload.status,
  ]);

  const isRegistered =
    currentUser?.account_type ===
    "registered";


  const loadLibrary =
  useCallback(
    async () => {
      if (!isRegistered) {
        setOwnedPlaylists([]);
        setSavedPlaylists([]);

        return;
      }

      const cached =
        getCachedLibrary(
          libraryCacheKey,
        );

      const offline =
        typeof navigator !==
          "undefined" &&
        navigator.onLine ===
          false;


      /*
       * OFFLINE:
       *
       * Never attempt the API.
       * Restore the last saved Library
       * snapshot immediately.
       */
      if (offline) {
        if (cached) {
          setOwnedPlaylists(
            Array.isArray(
              cached.owned,
            )
              ? cached.owned
              : [],
          );

          setSavedPlaylists(
            Array.isArray(
              cached.saved,
            )
              ? cached.saved
              : [],
          );

          setError("");
        } else {
          setOwnedPlaylists([]);
          setSavedPlaylists([]);

          setError(
            "This Library has not been cached on this device yet.",
          );
        }

        setLoading(false);

        return;
      }


      if (!cached) {
        setLoading(true);
      }

      setError("");

      try {
        const [
          mine,
          saved,
        ] =
          await Promise.all([
            getMyPlaylists(),
            getSavedPlaylists(),
          ]);

        const nextOwned =
          Array.isArray(mine)
            ? mine
            : [];

        const nextSaved =
          Array.isArray(saved)
            ? saved
            : [];

        setOwnedPlaylists(
          nextOwned,
        );

        setSavedPlaylists(
          nextSaved,
        );

        setCachedLibrary(
          libraryCacheKey,
          {
            owned:
              nextOwned,

            saved:
              nextSaved,
          },
        );
      } catch (requestError) {
        /*
         * If the connection disappeared
         * during the request, fall back
         * to the persisted snapshot.
         */
        const fallback =
          getCachedLibrary(
            libraryCacheKey,
          );

        if (fallback) {
          setOwnedPlaylists(
            Array.isArray(
              fallback.owned,
            )
              ? fallback.owned
              : [],
          );

          setSavedPlaylists(
            Array.isArray(
              fallback.saved,
            )
              ? fallback.saved
              : [],
          );

          setError("");
        } else {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Unable to load your library.",
          );
        }
      } finally {
        setLoading(false);
      }
    },
    [
      isRegistered,
      libraryCacheKey,
    ],
  );

  useEffect(() => {
    void loadLibrary();
  }, [
    loadLibrary,
  ]);


  useEffect(() => {
  if (
    !initialPlaylistId
  ) {
    return undefined;
  }

  let cancelled =
    false;

  async function loadInitialPlaylist() {
    const cached =
      getCachedPlaylist(
        libraryCacheKey,
        initialPlaylistId,
      );

    if (cached) {
      setSelectedPlaylist(
        cached,
      );
    } else {
      setOpeningPlaylistId(
        initialPlaylistId,
      );
    }

    setError("");

    const offline =
      typeof navigator !==
        "undefined" &&
      navigator.onLine ===
        false;

    if (offline) {
      if (!cached) {
        setError(
          "Open this playlist once while online before using it offline.",
        );
      }

      setOpeningPlaylistId(
        null,
      );

      onInitialPlaylistHandled?.();

      return;
    }

    try {
      const playlist =
        await getPlaylist(
          initialPlaylistId,
        );

      if (cancelled) {
        return;
      }

      setCachedPlaylist(
        libraryCacheKey,
        playlist,
      );

      setSelectedPlaylist(
        playlist,
      );

      window.scrollTo({
        top: 0,
        behavior: "smooth",
      });
    } catch (requestError) {
      if (
        cancelled ||
        cached
      ) {
        return;
      }

      setError(
        requestError
          instanceof Error
          ? requestError.message
          : "Unable to open playlist.",
      );
    } finally {
      if (!cancelled) {
        setOpeningPlaylistId(
          null,
        );

        onInitialPlaylistHandled?.();
      }
    }
  }

  void loadInitialPlaylist();

  return () => {
    cancelled =
      true;
  };
}, [
  initialPlaylistId,
  libraryCacheKey,
  onInitialPlaylistHandled,
]);


useEffect(() => {
  if (!createOpen) {
    return undefined;
  }

  const previousOverflow =
    document.body.style.overflow;

  document.body.style.overflow =
    "hidden";

  function handleKeyDown(
    event,
  ) {
    if (
      event.key === "Escape" &&
      !creating
    ) {
      setCreateOpen(
        false,
      );
    }
  }

  window.addEventListener(
    "keydown",
    handleKeyDown,
  );

  return () => {
    document.body.style.overflow =
      previousOverflow;

    window.removeEventListener(
      "keydown",
      handleKeyDown,
    );
  };
}, [
  createOpen,
  creating,
]);


  async function openPlaylist(
  playlistId,
) {
  if (openingPlaylistId) {
    return;
  }

  const downloaded =
    downloadedPlaylists.find(
      (playlist) =>
        String(
          playlist.id,
        ) ===
        String(
          playlistId,
        ),
    ) ??
    null;

  const cached =
    downloaded ??
    getCachedPlaylist(
      libraryCacheKey,
      playlistId,
    )

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
  } else {
    setPlaylistDownload({
      status:
        "idle",
      progress:
        0,
      trackProgress:
        {},
    });
  }

  /*
   * If we've loaded this playlist before,
   * show it immediately.
   */
  if (cached) {
    setSelectedPlaylist(
      cached,
    );

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  } else {
    setOpeningPlaylistId(
      playlistId,
    );
  }

  setError("");

  const offline =
  typeof navigator !==
    "undefined" &&
  navigator.onLine ===
    false;

if (offline) {
  if (!cached) {
    setError(
      "Open this playlist once while online before using it offline.",
    );
  }

  setOpeningPlaylistId(
    null,
  );

  return;
}

  try {
    /*
     * Still refresh from the server so
     * cached data never becomes permanently stale.
     */
    const playlist =
      await getPlaylist(
        playlistId,
      );

    setCachedPlaylist(
  libraryCacheKey,
  playlist,
);

    setSelectedPlaylist(
      playlist,
    );
  } catch (requestError) {
    /*
     * If cached data exists, don't destroy
     * the working page because refresh failed.
     */
    if (!cached) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to open playlist.",
      );
    }
  } finally {
    setOpeningPlaylistId(
      null,
    );
  }
}


  async function handleCreatePlaylist(
    event,
  ) {
    event.preventDefault();

    const title =
      createTitle.trim();

    if (!title) {
      return;
    }

    setCreating(true);
    setError("");

    try {
      const playlist =
        await createPlaylist({
          title,

          description:
            createDescription.trim()
              ? createDescription.trim()
              : null,

          visibility:
            createVisibility,
        });

      setOwnedPlaylists(
        (current) => [
          playlist,
          ...current,
        ],
      );

      setCreateTitle("");
      setCreateDescription("");

      setCreateVisibility(
        "private",
      );

      setCreateOpen(false);

      setSelectedPlaylist(
        playlist,
      );
    } catch (requestError) {
      setError(
        requestError
          instanceof Error
          ? requestError.message
          : "Unable to create playlist.",
      );
    } finally {
      setCreating(false);
    }
  }


  async function handleDeletePlaylist() {
    if (
      !selectedPlaylist ||
      !selectedPlaylist.is_owner ||
      actionBusy
    ) {
      return;
    }

    const confirmed =
      window.confirm(
        `Delete "${selectedPlaylist.title}"?`,
      );

    if (!confirmed) {
      return;
    }

    setActionBusy(true);
    setError("");

    try {
      await deletePlaylist(
        selectedPlaylist.id,
      );

      setOwnedPlaylists(
        (current) =>
          current.filter(
            (playlist) =>
              playlist.id !==
              selectedPlaylist.id,
          ),
      );

      setSelectedPlaylist(
        null,
      );
    } catch (requestError) {
      setError(
        requestError
          instanceof Error
          ? requestError.message
          : "Unable to delete playlist.",
      );
    } finally {
      setActionBusy(false);
    }
  }


  async function handleRemoveTrack(
    playlistTrackId,
  ) {
    if (
      !selectedPlaylist ||
      !selectedPlaylist.is_owner ||
      actionBusy
    ) {
      return;
    }

    setActionBusy(true);
    setError("");

    try {
      await removeTrackFromPlaylist(
        selectedPlaylist.id,
        playlistTrackId,
      );

      const refreshed =
        await getPlaylist(
          selectedPlaylist.id,
        );

      setSelectedPlaylist(
        refreshed,
      );

      await loadLibrary();
    } catch (requestError) {
      setError(
        requestError
          instanceof Error
          ? requestError.message
          : "Unable to remove track.",
      );
    } finally {
      setActionBusy(false);
    }
  }


  async function moveTrack(
    trackIndex,
    direction,
  ) {
    if (
      !selectedPlaylist ||
      !selectedPlaylist.is_owner ||
      actionBusy
    ) {
      return;
    }

    const nextIndex =
      trackIndex + direction;

    if (
      nextIndex < 0 ||
      nextIndex >=
        selectedPlaylist.tracks.length
    ) {
      return;
    }

    const nextTracks = [
      ...selectedPlaylist.tracks,
    ];

    const [movedTrack] =
      nextTracks.splice(
        trackIndex,
        1,
      );

    nextTracks.splice(
      nextIndex,
      0,
      movedTrack,
    );

    setSelectedPlaylist(
      (current) => ({
        ...current,
        tracks:
          nextTracks.map(
            (
              track,
              index,
            ) => ({
              ...track,
              position:
                index,
            }),
          ),
      }),
    );

    setActionBusy(true);

    try {
      const updated =
        await reorderPlaylistTracks(
          selectedPlaylist.id,
          nextTracks.map(
            (track) =>
              track.playlist_track_id,
          ),
        );

      setSelectedPlaylist(
        updated,
      );
    } catch (requestError) {
      setError(
        requestError
          instanceof Error
          ? requestError.message
          : "Unable to reorder playlist.",
      );

      const refreshed =
        await getPlaylist(
          selectedPlaylist.id,
        );

      setSelectedPlaylist(
        refreshed,
      );
    } finally {
      setActionBusy(false);
    }
  }

  async function downloadPlaylist() {
    const tracks =
      selectedPlaylist?.tracks ??
      [];

    if (
      tracks.length === 0 ||
      playlistDownload.status ===
        "downloading"
    ) {
      return;
    }

    setError("");

    setPlaylistDownload({
      status:
        "downloading",
      progress:
        0,
      trackProgress:
        {},
    });

    try {
      await downloadTracksForOffline(
        tracks,
        {
          jobId:
            "playlist:" +
            String(
              selectedPlaylist.id,
            ),
          jobMetadata: {
            kind:
              "playlist",
            playlistId:
              selectedPlaylist.id,
            playlistTitle:
              selectedPlaylist.title,
            playlistDescription:
              selectedPlaylist.description ??
              null,
            playlistArtworkUrl:
              selectedPlaylist.artwork_url ??
              null,
            playlistOwnerUsername:
              selectedPlaylist.owner_username ??
              null,
            playlistVisibility:
              selectedPlaylist.visibility ??
              null,
          },
          onProgress: ({
            progress,
            trackProgress,
          }) => {
            setPlaylistDownload({
              status:
                "downloading",
              progress:
                Number.isFinite(
                  progress,
                )
                  ? progress
                  : 0,
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

      setDownloadedPlaylists(
        await getDownloadedPlaylists(),
      );
    } catch (requestError) {
      setPlaylistDownload({
        status:
          "error",
        progress:
          0,
        trackProgress:
          {},
      });

      setError(
        requestError
          instanceof Error
          ? requestError.message
          : "Unable to download playlist.",
      );
    }
  }

  function playPlaylist(
    startIndex = 0,
  ) {
    const tracks =
      selectedPlaylist?.tracks ??
      [];

    if (
      tracks.length === 0
    ) {
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
      .catch(() => {});
  }


  const onlinePlaylists = [
    ...ownedPlaylists,

    ...savedPlaylists.filter(
      (savedPlaylist) =>
        !ownedPlaylists.some(
          (ownedPlaylist) =>
            ownedPlaylist.id ===
            savedPlaylist.id,
        ),
    ),
  ];

  const downloadedById =
    new Map(
      downloadedPlaylists.map(
        (playlist) => [
          String(
            playlist.id,
          ),
          playlist,
        ],
      ),
    );

  const visiblePlaylists = [
    ...onlinePlaylists.map(
      (playlist) => {
        const downloaded =
          downloadedById.get(
            String(
              playlist.id,
            ),
          );

        return downloaded
          ? {
              ...playlist,
              is_offline_download:
                true,
            }
          : playlist;
      },
    ),

    ...downloadedPlaylists.filter(
      (downloaded) =>
        !onlinePlaylists.some(
          (playlist) =>
            String(
              playlist.id,
            ) ===
            String(
              downloaded.id,
            ),
        ),
    ),
  ];

  if (
    !isRegistered &&
    downloadedPlaylists.length ===
      0
  ) {
  return (
    <div className="page-stack hs-search-page hs-library-page">

      <section className="hs-search-console hs-library-console">

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

                HYPERSYNCED LIBRARY
              </span>

            </div>


            <h2>
              Keep your music together
            </h2>

          </div>


          <div className="hs-search-console__actions">
            <button
              type="button"
              className="hs-search-primary-action"
              onClick={
                onOpenAuth
              }
            >
              <Icon
                name="library"
                size={16}
              />

              Sign in
            </button>

          </div>

        </div>


        <div className="hs-search-console__status">

          <span
            className={
              "hs-search-status-chip " +
              "hs-search-status-chip--primary"
            }
          >
            <i />

            ACCOUNT REQUIRED
          </span>


          <span className="hs-search-status-chip">
            PLAYLIST SYNC
          </span>


          <span className="hs-search-status-chip">
            CLOUD LIBRARY
          </span>

        </div>

      </section>


      <section className="hs-search-message">

        <div>
          <strong>
            Sign in to use your Library
          </strong>

          <p>
            Create playlists, save collections,
            and keep them synced across HyperSync.
          </p>
        </div>

      </section>

    </div>
  );
}

  const playlistDownloadPercent =
  Math.round(
    (
      playlistDownload.progress ??
      0
    ) *
      100,
  );

  if (selectedPlaylist) {
  const artwork =
    resolveArtworkUrl(
      selectedPlaylist.artwork_url,
    );

  return (
    <div className="page-stack hs-search-page hs-library-page">

      <section className="hs-search-playlist-view">

        <div className="hs-search-playlist-view__nav">

          <button
            type="button"
            className="hs-search-playlist-back"
            onClick={() => {
              setSelectedPlaylist(
                null,
              );
            }}
          >
            <Icon
              name="chevron"
              size={15}
            />

            Back to Library
          </button>

        </div>


        <section className="hs-search-playlist-view__hero">

          <div className="hs-search-playlist-view__art">

            {artwork ? (
              <img
                src={
                  artwork
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
              {String(
                selectedPlaylist.visibility ||
                  "playlist",
              ).toUpperCase()}
              {" PLAYLIST"}
            </span>


            <h2>
              {selectedPlaylist.title}
            </h2>


            {selectedPlaylist.description ? (
              <p>
                {selectedPlaylist.description}
              </p>
            ) : null}


            <small>
              {selectedPlaylist.owner_username ||
                "HyperSync"}

              {" • "}

              {selectedPlaylist.track_count}

              {" "}

              {selectedPlaylist.track_count ===
              1
                ? "track"
                : "tracks"}

              {" • "}

              {formatDuration(
                selectedPlaylist.total_duration_seconds,
              )}
            </small>


            <div className="hs-search-playlist-view__actions">

              <button
                type="button"
                className="hs-search-playlist-primary"
                disabled={
                  selectedPlaylist.tracks.length ===
                  0
                }
                onClick={() => {
                  playPlaylist(
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
                  selectedPlaylist.tracks.length ===
                    0 ||
                  playlistDownload.status ===
                    "downloading"
                }
                onClick={() => {
                  void downloadPlaylist();
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
                    : "Download"}
              </button>


              {selectedPlaylist.is_owner ? (
                <button
                  type="button"
                  className={
                    "hs-search-playlist-action " +
                    "hs-library-danger-action"
                  }
                  disabled={
                    actionBusy
                  }
                  onClick={() => {
                    void handleDeletePlaylist();
                  }}
                >
                  Delete
                </button>
              ) : null}

            </div>

          </div>

        </section>


        {error ? (
          <section className="hs-search-message hs-search-message--error">

            <div>
              <strong>
                PLAYLIST ERROR
              </strong>

              <p>
                {error}
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
              {selectedPlaylist.tracks.length}
            </strong>

          </div>


          {selectedPlaylist.tracks.length ===
          0 ? (

            <div className="hs-library-empty">

              <Icon
                name="music"
                size={22}
              />

              <div>
                <strong>
                  Nothing here yet
                </strong>

                <p>
                  Add songs from Search and they’ll
                  appear here instantly.
                </p>
              </div>

            </div>

          ) : (

            <div className="hs-search-track-list">

              {selectedPlaylist.tracks.map(
                (
                  track,
                  trackIndex,
                ) => {
                  const trackArtwork =
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
                        track.playlist_track_id
                      }
                      role="button"
                      tabIndex={0}
                      {...trackActionMenu.getTriggerProps(
                        track,
                      )}
                      className={[
                        "hs-search-track",
                        "hs-search-track--playlist-download",
                        "hs-library-track-row",

                        selectedPlaylist.is_owner
                          ? "is-owner"
                          : "",

                        isCurrentTrack
                          ? "is-current-track"
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() => {
                        playPlaylist(
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

                          playPlaylist(
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

                        {trackArtwork ? (
                          <img
                            src={
                              trackArtwork
                            }
                            alt=""
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
                            selectedPlaylist.title}
                        </small>

                      </span>


                      <span className="hs-search-track__duration">
                        {formatTrackDuration(
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


                      {selectedPlaylist.is_owner ? (

                        <div
                          className="hs-library-track-actions"
                          onClick={(
                            event,
                          ) => {
                            event.stopPropagation();
                          }}
                        >

                          <button
                            type="button"
                            title="Move up"
                            disabled={
                              actionBusy ||
                              trackIndex ===
                                0
                            }
                            onClick={(
                              event,
                            ) => {
                              event.stopPropagation();

                              void moveTrack(
                                trackIndex,
                                -1,
                              );
                            }}
                          >
                            ↑
                          </button>


                          <button
                            type="button"
                            title="Move down"
                            disabled={
                              actionBusy ||
                              trackIndex ===
                                selectedPlaylist.tracks.length -
                                  1
                            }
                            onClick={(
                              event,
                            ) => {
                              event.stopPropagation();

                              void moveTrack(
                                trackIndex,
                                1,
                              );
                            }}
                          >
                            ↓
                          </button>


                          <button
                            type="button"
                            title="Remove"
                            disabled={
                              actionBusy
                            }
                            onClick={(
                              event,
                            ) => {
                              event.stopPropagation();

                              void handleRemoveTrack(
                                track.playlist_track_id,
                              );
                            }}
                          >
                            ×
                          </button>

                        </div>

                      ) : (

                        <span className="hs-search-track__play">
                          <Icon
                            name="play"
                            size={16}
                          />
                        </span>

                      )}

                    </div>
                  );
                },
              )}

            </div>

          )}

        </section>

      </section>


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

  return (
  <div className="page-stack hs-search-page hs-library-page">

    <section className="hs-search-console hs-library-console">

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

              HYPERSYNCED LIBRARY
            </span>

          </div>


          <h2>
            Your music, all in one place
          </h2>

        </div>


        {isRegistered ? (
          <button
            type="button"
            className="hs-search-primary-action"
            onClick={() => {
              setCreateOpen(
                true,
              );
            }}
          >
            <Icon
              name="plus"
              size={16}
            />

            New Playlist
          </button>
        ) : (
          <button
            type="button"
            className="hs-search-primary-action"
            onClick={
              onOpenAuth
            }
          >
            <Icon
              name="library"
              size={16}
            />

            Sign in
          </button>
        )}

      </div>


      <div
        className="hs-search-filterbar"
        role="tablist"
      >

        {LIBRARY_TABS.map(
          (tab) => (
            <button
              type="button"
              role="tab"
              key={
                tab
              }
              aria-selected={
                activeTab ===
                tab
              }
              className={
                activeTab ===
                tab
                  ? "is-active"
                  : ""
              }
              onClick={() => {
                setActiveTab(
                  tab,
                );
              }}
            >

              <span>
                {tab}
              </span>


              {tab === "Playlists" ? (
              <strong>
                {visiblePlaylists.length}
              </strong>
            ) : null}

            </button>
          ),
        )}

      </div>


      <div className="hs-search-console__status">

        <span
          className={
            "hs-search-status-chip " +
            "hs-search-status-chip--primary"
          }
        >
          <i />
        </span>


        <span className="hs-search-status-chip">
          {ownedPlaylists.length}
          {" OWNED"}
        </span>


        <span className="hs-search-status-chip">
          {savedPlaylists.length}
          {" SAVED"}
        </span>

      </div>

    </section>


    {error ? (
      <section className="hs-search-message hs-search-message--error">

        <div>
          <strong>
            LIBRARY ERROR
          </strong>

          <p>
            {error}
          </p>
        </div>

      </section>
    ) : null}


    {activeTab !== "Playlists" ? (

      <section className="hs-search-message">

        <div>
          <strong>
            {activeTab} are coming next
          </strong>

          <p>
            Playlists are live first. Saved
            albums, artists, and liked songs can
            use this same Library interface.
          </p>
        </div>

      </section>

    ) : (

      <section className="hs-search-section hs-library-collection">

        <div className="hs-search-section__heading">

          <div>
            <span>
              LIBRARY CONTENT
            </span>

            <h3>
              Playlists
            </h3>
          </div>

          <strong>
            {visiblePlaylists.length}
          </strong>

        </div>


        {loading ? (

          <div className="hs-library-loading">

            <span className="library-spinner" />

            <span>
              Loading playlists...
            </span>

          </div>

        ) : visiblePlaylists.length ===
          0 ? (

          <div className="hs-library-empty">

            <Icon
              name="playlist"
              size={22}
            />

            <div>
              <strong>
  Your Library is empty
</strong>

<p>
  Create a playlist or add a generated
  playlist and it will appear here.
</p>
            </div>

          </div>

        ) : (

          <div className="hs-search-track-list">

            {visiblePlaylists.map(
              (
                playlist,
                index,
              ) => {
                const artwork =
                  resolveArtworkUrl(
                    playlist.artwork_url,
                  );

                const opening =
                  openingPlaylistId ===
                  playlist.id;

                return (
                  <div
                    key={
                      playlist.id
                    }
                    role="button"
                    tabIndex={0}
                    aria-disabled={
                      Boolean(
                        openingPlaylistId,
                      )
                    }
                    className={[
                      "hs-search-track",
                      "hs-library-playlist-row",

                      opening
                        ? "is-opening"
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => {
                      if (
                        !openingPlaylistId
                      ) {
                        void openPlaylist(
                          playlist.id,
                        );
                      }
                    }}
                    onKeyDown={(
                      event,
                    ) => {
                      if (
                        (
                          event.key ===
                            "Enter" ||
                          event.key ===
                            " "
                        ) &&
                        !openingPlaylistId
                      ) {
                        event.preventDefault();

                        void openPlaylist(
                          playlist.id,
                        );
                      }
                    }}
                  >

                    <span className="hs-search-track__rank">
                      {String(
                        index + 1,
                      ).padStart(
                        2,
                        "0",
                      )}
                    </span>


                    <span className="hs-search-track__art">

                      {artwork ? (
                        <img
                          src={
                            artwork
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
                          name="play"
                          size={15}
                        />
                      </i>

                    </span>


                    <span className="hs-search-track__copy">

                      <strong>
                        {playlist.title}
                      </strong>

                      <small>
                        {playlist.owner_username ||
                          currentUser?.username ||
                          "HyperSync"}
                      </small>

                    </span>


                    <span className="hs-search-track__signals">

                      <em>
                        {playlist.is_offline_download
                          ? "DOWNLOADED"
                          : String(
                              playlist.visibility ||
                                "playlist",
                            ).toUpperCase()}
                      </em>

                      <small>
                        {playlist.track_count}
                        {" "}
                        {playlist.track_count ===
                        1
                          ? "track"
                          : "tracks"}
                      </small>

                    </span>


                    <span className="hs-search-track__duration">
                      {formatDuration(
                        playlist.total_duration_seconds,
                      )}
                    </span>


                    <span className="hs-search-track__play">

                      {opening ? (
                        <span className="library-spinner" />
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

        )}

      </section>

    )}

      {createOpen ? (
        <div
          className="library-modal-backdrop"
          role="presentation"
          onMouseDown={(
            event,
          ) => {
            if (
              event.target ===
                event.currentTarget &&
              !creating
            ) {
              setCreateOpen(
                false,
              );
            }
          }}
        >

          <form
            className="library-modal hs-library-modal"
            onSubmit={
              handleCreatePlaylist
            }
          >

            <div className="library-modal__header">

              <div>
                <span>
                  NEW PLAYLIST
                </span>

                <h2>
                  Create playlist
                </h2>
              </div>


              <button
                type="button"
                disabled={
                  creating
                }
                onClick={() => {
                  setCreateOpen(
                    false,
                  );
                }}
              >
                <Icon
                  name="close"
                  size={17}
                />
              </button>

            </div>


            <label className="library-field">

              <span>
                Name
              </span>

              <input
                type="text"
                autoFocus
                maxLength={120}
                placeholder="Playlist name"
                value={
                  createTitle
                }
                onChange={(
                  event,
                ) => {
                  setCreateTitle(
                    event.target.value,
                  );
                }}
              />

            </label>


            <label className="library-field">

              <span>
                Description
              </span>

              <textarea
                rows={3}
                maxLength={1000}
                placeholder="Optional description"
                value={
                  createDescription
                }
                onChange={(
                  event,
                ) => {
                  setCreateDescription(
                    event.target.value,
                  );
                }}
              />

            </label>


            <label className="library-field">

              <span>
                Visibility
              </span>

              <select
                value={
                  createVisibility
                }
                onChange={(
                  event,
                ) => {
                  setCreateVisibility(
                    event.target.value,
                  );
                }}
              >
                <option value="private">
                  Private
                </option>

                <option value="unlisted">
                  Unlisted
                </option>

                <option value="public">
                  Public
                </option>
              </select>

            </label>


            <div className="library-modal__actions">

              <button
                type="button"
                className="hs-search-playlist-action"
                disabled={
                  creating
                }
                onClick={() => {
                  setCreateOpen(
                    false,
                  );
                }}
              >
                Cancel
              </button>


              <button
                type="submit"
                className="hs-search-playlist-primary"
                disabled={
                  creating ||
                  !createTitle.trim()
                }
              >
                {creating
                  ? "Creating..."
                  : "Create Playlist"}
              </button>

            </div>

          </form>

        </div>
      ) : null}

    </div>
  );
}



export default LibraryPage;
