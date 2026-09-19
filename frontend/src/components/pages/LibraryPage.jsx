import {
  useCallback,
  useEffect,
  useState,
} from "react";

import {
  API_BASE,
} from "../../api/client.js";

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
  savePlaylist,
  unsavePlaylist,
} from "../../playlistApi.js";

import {
  LIBRARY_TABS,
} from "../../constants.js";

import Icon from
  "../ui/Icon.jsx";

import SectionHeading from
  "../ui/SectionHeading.jsx";

import TrackActionMenu from
  "../music/TrackActionMenu.jsx";

import useTrackActionMenu from
  "../../hooks/useTrackActionMenu.js";

import {
  downloadTrackForOffline,
  isTrackDownloaded,
} from "../../offlineDownloads.js";

function resolveArtworkUrl(
  url,
) {
  if (!url) {
    return null;
  }

  if (
    url.startsWith("http://") ||
    url.startsWith("https://")
  ) {
    return url;
  }

  return `${API_BASE}${url.replace(
    /^\/api/,
    "",
  )}`;
}


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


function PlaylistSkeleton() {
  return (
    <div className="library-card library-card--skeleton">
      <div className="library-card__art library-skeleton" />

      <div className="library-card__body">
        <span className="library-skeleton library-skeleton--title" />

        <span className="library-skeleton library-skeleton--meta" />
      </div>
    </div>
  );
}


function LibraryPage({
  currentUser,
  onOpenAuth,
  initialPlaylistId = null,
  onInitialPlaylistHandled,
}) {
  const trackActionMenu =
  useTrackActionMenu();
  const [
    activeTab,
    setActiveTab,
  ] = useState(
    "Playlists",
  );

  const [
    playlistView,
    setPlaylistView,
  ] = useState(
    "mine",
  );

  const [
    ownedPlaylists,
    setOwnedPlaylists,
  ] = useState([]);

  const [
    savedPlaylists,
    setSavedPlaylists,
  ] = useState([]);

  const [
    selectedPlaylist,
    setSelectedPlaylist,
  ] = useState(
    null,
  );

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

        setLoading(true);
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

          setOwnedPlaylists(
            Array.isArray(mine)
              ? mine
              : [],
          );

          setSavedPlaylists(
            Array.isArray(saved)
              ? saved
              : [],
          );
        } catch (requestError) {
          setError(
            requestError
              instanceof Error
              ? requestError.message
              : "Unable to load your library.",
          );
        } finally {
          setLoading(false);
        }
      },
      [
        isRegistered,
      ],
    );


  useEffect(() => {
    void loadLibrary();
  }, [
    loadLibrary,
  ]);


  useEffect(() => {
    if (!createOpen) {
      return undefined;
    }

    useEffect(() => {
  if (
    !initialPlaylistId
  ) {
    return undefined;
  }

  let cancelled =
    false;

  async function loadInitialPlaylist() {
    setOpeningPlaylistId(
      initialPlaylistId,
    );

    setError("");

    try {
      const playlist =
        await getPlaylist(
          initialPlaylistId,
        );

      if (cancelled) {
        return;
      }

      setSelectedPlaylist(
        playlist,
      );

      window.scrollTo({
        top: 0,
        behavior: "smooth",
      });
    } catch (requestError) {
      if (cancelled) {
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
  onInitialPlaylistHandled,
]);

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
        setCreateOpen(false);
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

    setOpeningPlaylistId(
      playlistId,
    );

    setError("");

    try {
      const playlist =
        await getPlaylist(
          playlistId,
        );

      setSelectedPlaylist(
        playlist,
      );

      window.scrollTo({
        top: 0,
        behavior: "smooth",
      });
    } catch (requestError) {
      setError(
        requestError
          instanceof Error
          ? requestError.message
          : "Unable to open playlist.",
      );
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

      setPlaylistView(
        "mine",
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


  async function toggleSavedPlaylist() {
    if (
      !selectedPlaylist ||
      selectedPlaylist.is_owner ||
      actionBusy
    ) {
      return;
    }

    setActionBusy(true);
    setError("");

    const nextSaved =
      !selectedPlaylist.is_saved;

    setSelectedPlaylist(
      (current) => ({
        ...current,
        is_saved:
          nextSaved,
      }),
    );

    try {
      if (nextSaved) {
        await savePlaylist(
          selectedPlaylist.id,
        );
      } else {
        await unsavePlaylist(
          selectedPlaylist.id,
        );
      }

      await loadLibrary();
    } catch (requestError) {
      setSelectedPlaylist(
        (current) => ({
          ...current,
          is_saved:
            !nextSaved,
        }),
      );

      setError(
        requestError
          instanceof Error
          ? requestError.message
          : "Unable to update saved playlist.",
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
  });

  try {
    const total =
      tracks.length;

    for (
      let index = 0;
      index < total;
      index += 1
    ) {
      const track =
        tracks[index];

      const alreadyDownloaded =
        await isTrackDownloaded(
          track,
        );

      if (
        alreadyDownloaded
      ) {
        setPlaylistDownload({
          status:
            "downloading",

          progress:
            (index + 1) /
            total,
        });

        continue;
      }

      await downloadTrackForOffline(
        track,
        {
          onProgress: ({
            progress,
          }) => {
            setPlaylistDownload({
              status:
                "downloading",

              progress:
                (
                  index +
                  progress
                ) /
                total,
            });
          },
        },
      );
    }

    setPlaylistDownload({
      status:
        "downloaded",

      progress:
        1,
    });
  } catch (requestError) {
    setPlaylistDownload({
      status:
        "error",

      progress:
        0,
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
        }),
      );

    void player
      .playTrackQueue(
        queue,
        startIndex,
      )
      .catch(() => {});
  }


  const visiblePlaylists =
    playlistView === "saved"
      ? savedPlaylists
      : ownedPlaylists;


  if (!isRegistered) {
    return (
      <div className="page-stack library-page library-page--polished">

        <section className="library-welcome">

          <div className="library-welcome__icon">
            <Icon
              name="library"
              size={28}
            />
          </div>

          <div>
            <span>
              YOUR LIBRARY
            </span>

            <h2>
              Keep your music together.
            </h2>

            <p>
              Create playlists, save collections,
              and sync them across HyperSync.
            </p>
          </div>

          <button
            type="button"
            className="library-primary-action"
            onClick={
              onOpenAuth
            }
          >
            Sign in
            <Icon
              name="chevron"
              size={14}
            />
          </button>

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
      <div className="page-stack library-page library-page--polished">

        <button
          type="button"
          className="library-detail-back"
          onClick={() => {
            setSelectedPlaylist(
              null,
            );
          }}
        >
          <span>
            ←
          </span>

          Library
        </button>


        <section className="library-detail-hero">

  <div className="library-detail-art">

    {artwork ? (
      <img
        src={artwork}
        alt=""
      />
    ) : (
      <div className="library-detail-art__fallback">
        <Icon
          name="playlist"
          size={32}
        />
      </div>
    )}

  </div>


  <div className="library-detail-info">

    <span className="library-detail-eyebrow">
      {selectedPlaylist.visibility}
      {" "}
      playlist
    </span>

    <h1>
      {selectedPlaylist.title}
    </h1>

    <div className="library-detail-meta">

      <strong>
        {selectedPlaylist.owner_username}
      </strong>

      <span>
        {selectedPlaylist.track_count}
        {" "}
        {selectedPlaylist.track_count === 1
          ? "track"
          : "tracks"}
      </span>

      <span>
        {formatDuration(
          selectedPlaylist.total_duration_seconds,
        )}
      </span>

    </div>

  </div>


  <div className="library-detail-hero__actions">

    <button
      type="button"
      className="library-play-action"
      disabled={
        selectedPlaylist.tracks.length === 0
      }
      onClick={() => {
        playPlaylist(0);
      }}
    >
      <Icon
        name="play"
        size={16}
      />

      Play
    </button>

    <button
  type="button"
  className={
    playlistDownload.status ===
      "downloaded"
      ? "library-action-button is-active"
      : "library-action-button"
  }
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
    size={15}
  />

  {playlistDownload.status ===
  "downloading"
    ? `Downloading ${playlistDownloadPercent}%`
    : playlistDownload.status ===
        "downloaded"
      ? "Downloaded"
      : "Download"}
</button>


    {!selectedPlaylist.is_owner ? (
      <button
        type="button"
        className={
          selectedPlaylist.is_saved
            ? "library-action-button is-active"
            : "library-action-button"
        }
        disabled={actionBusy}
        onClick={() => {
          void toggleSavedPlaylist();
        }}
      >
        <Icon
          name={
            selectedPlaylist.is_saved
              ? "check"
              : "plus"
          }
          size={15}
        />

        {selectedPlaylist.is_saved
  ? "In Library"
  : "Add to Library"}
      </button>
    ) : null}


    {!selectedPlaylist.is_owner ? (
  <button
    type="button"
    className={
      selectedPlaylist.is_saved
        ? "library-action-button is-active"
        : "library-action-button"
    }
    disabled={
      actionBusy
    }
    onClick={() => {
      void toggleSavedPlaylist();
    }}
  >
    <Icon
      name={
        selectedPlaylist.is_saved
          ? "check"
          : "plus"
      }
      size={16}
    />

    {selectedPlaylist.is_saved
      ? "In Library"
      : "Add to Library"}
  </button>
) : null}

  </div>

</section>


        <section className="library-detail-actions">

          <button
            type="button"
            className="library-play-action"
            disabled={
              selectedPlaylist.tracks.length ===
              0
            }
            onClick={() => {
              playPlaylist(0);
            }}
          >
            <Icon
              name="play"
              size={17}
            />

            Play
          </button>

          <button
  type="button"
  className={
    playlistDownload.status ===
      "downloaded"
      ? "library-action-button is-active"
      : "library-action-button"
  }
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
    size={15}
  />

  {playlistDownload.status ===
  "downloading"
    ? `Downloading ${playlistDownloadPercent}%`
    : playlistDownload.status ===
        "downloaded"
      ? "Downloaded"
      : "Download"}
</button>


          {!selectedPlaylist.is_owner ? (
            <button
              type="button"
              className={
                selectedPlaylist.is_saved
                  ? "library-action-button is-active"
                  : "library-action-button"
              }
              disabled={
                actionBusy
              }
              onClick={() => {
                void toggleSavedPlaylist();
              }}
            >
              <Icon
                name={
                  selectedPlaylist.is_saved
                    ? "check"
                    : "plus"
                }
                size={16}
              />

              {selectedPlaylist.is_saved
  ? "In Library"
  : "Add to Library"}
            </button>
          ) : null}


          {selectedPlaylist.is_owner ? (
            <button
              type="button"
              className="library-action-button library-action-button--danger"
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

        </section>


        {error ? (
          <div className="library-inline-error">
            {error}
          </div>
        ) : null}


        <section className="library-detail-tracks">

          <SectionHeading
            title="Tracks"
          />

          {selectedPlaylist.tracks.length ===
          0 ? (
            <div className="home-empty-state">

              <div className="home-empty-state__icon">
                <Icon
                  name="music"
                  size={22}
                />
              </div>

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
            <div className="library-track-list">

  <div className="library-track-header">

    <span>
      #
    </span>

    <span>
      Title
    </span>

    <span>
      Album
    </span>

    <span>
      Time
    </span>

    <span />

  </div>

  {selectedPlaylist.tracks.map(
                (
                  track,
                  trackIndex,
                ) => {
                  const trackArtwork =
                    resolveArtworkUrl(
                      track.artwork_url,
                    );

                  return (
                    <div
                      className="library-track-row"
                      key={
                        track.playlist_track_id
                      }
                    >

                      <span className="library-track-index">
                        {trackIndex + 1}
                      </span>


                      <button
                        type="button"
                        className="library-track-main"
                        onClick={() => {
                          playPlaylist(
                            trackIndex,
                          );
                        }}
                      >

                        <span className="library-track-art">

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
                              size={16}
                            />
                          )}

                          <span className="library-track-play">
                            <Icon
                              name="play"
                              size={13}
                            />
                          </span>

                        </span>


                        <span className="library-track-copy">

                          <strong>
                            {track.title}
                          </strong>

                          <small>
                            {track.artist}
                          </small>

                        </span>

                      </button>

                      <span className="library-track-album">
                          {track.album || "—"}
                      </span>


                      <span className="library-track-duration">
                        {formatTrackDuration(
                          track.duration_seconds,
                        )}
                      </span>


                      {selectedPlaylist.is_owner ? (
                        <div className="library-track-actions">

                          <button
                            type="button"
                            title="Move up"
                            disabled={
                              actionBusy ||
                              trackIndex === 0
                            }
                            onClick={() => {
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
                            onClick={() => {
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
                            onClick={() => {
                              void handleRemoveTrack(
                                track.playlist_track_id,
                              );
                            }}
                          >
                            ×
                          </button>

                        </div>
                      ) : (
                        <span />
                      )}

                    </div>
                  );
                },
              )}

            </div>
          )}

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
    <div className="page-stack library-page library-page--polished">

      <section className="library-topbar">

        <div>
          <span>
            YOUR COLLECTION
          </span>

          <h1>
            Library
          </h1>
        </div>

        <button
          type="button"
          className="library-primary-action"
          onClick={() => {
            setCreateOpen(true);
          }}
        >
          <Icon
            name="plus"
            size={16}
          />

          New Playlist
        </button>

      </section>


      <div
        className="library-tabs"
        role="tablist"
      >

        {LIBRARY_TABS.map(
          (tab) => (
            <button
              type="button"
              role="tab"
              key={tab}
              aria-selected={
                activeTab === tab
              }
              className={
                activeTab === tab
                  ? "is-active"
                  : ""
              }
              onClick={() => {
                setActiveTab(tab);
              }}
            >
              {tab}
            </button>
          ),
        )}

      </div>


      {error ? (
        <div className="library-inline-error">
          {error}
        </div>
      ) : null}


      {activeTab !== "Playlists" ? (
        <div className="home-empty-state">

          <div className="home-empty-state__icon">
            <Icon
              name={
                activeTab === "Artists"
                  ? "people"
                  : activeTab === "Albums"
                    ? "disc"
                    : "music"
              }
              size={22}
            />
          </div>

          <div>
            <strong>
              {activeTab} are coming next
            </strong>

            <p>
              Playlists are live first. We can
              connect saved albums, artists, and
              liked songs into this same library.
            </p>
          </div>

        </div>
      ) : (
        <>

          <div className="library-view-switcher">

            <button
              type="button"
              className={
                playlistView === "mine"
                  ? "is-active"
                  : ""
              }
              onClick={() => {
                setPlaylistView(
                  "mine",
                );
              }}
            >
              Your Playlists

              <span>
                {ownedPlaylists.length}
              </span>
            </button>

            <button
              type="button"
              className={
                playlistView === "saved"
                  ? "is-active"
                  : ""
              }
              onClick={() => {
                setPlaylistView(
                  "saved",
                );
              }}
            >
              Saved

              <span>
                {savedPlaylists.length}
              </span>
            </button>

          </div>


          <section className="library-playlist-section">

            <SectionHeading
              title={
                playlistView === "mine"
                  ? "Your Playlists"
                  : "Saved Playlists"
              }
            />


            {loading ? (
              <div className="library-card-grid">

                {Array.from({
                  length: 6,
                }).map(
                  (
                    _,
                    index,
                  ) => (
                    <PlaylistSkeleton
                      key={index}
                    />
                  ),
                )}

              </div>
            ) : visiblePlaylists.length ===
              0 ? (
              <div className="home-empty-state">

                <div className="home-empty-state__icon">
                  <Icon
                    name="playlist"
                    size={22}
                  />
                </div>

                <div>
                  <strong>
                    {playlistView === "mine"
                      ? "Create your first playlist"
                      : "Nothing saved yet"}
                  </strong>

                  <p>
                    {playlistView === "mine"
                      ? "Create a collection, then add songs directly from Search."
                      : "Public playlists you save will show up here."}
                  </p>
                </div>

              </div>
            ) : (
              <div className="library-card-grid">

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
                      <button
                        type="button"
                        className={
                          opening
                            ? "library-card is-opening"
                            : "library-card"
                        }
                        key={
                          playlist.id
                        }
                        disabled={
                          Boolean(
                            openingPlaylistId,
                          )
                        }
                        onClick={() => {
                          void openPlaylist(
                            playlist.id,
                          );
                        }}
                      >

                        <span className="library-card__art">

                          {artwork ? (
                            <img
                              src={artwork}
                              alt=""
                            />
                          ) : (
                            <span
                              className={
                                "library-card__fallback " +
                                `library-card__fallback--${
                                  (index % 4) + 1
                                }`
                              }
                            >
                              <Icon
                                name="playlist"
                                size={30}
                              />
                            </span>
                          )}


                          <span className="library-card__play">

                            {opening ? (
                              <span className="library-spinner" />
                            ) : (
                              <Icon
                                name="play"
                                size={15}
                              />
                            )}

                          </span>

                        </span>


                        <span className="library-card__body">

                          <strong>
                            {playlist.title}
                          </strong>

                          <small>
                            {playlist.track_count}
                            {" "}
                            {playlist.track_count === 1
                              ? "track"
                              : "tracks"}

                            {" • "}

                            {playlist.visibility}
                          </small>

                        </span>

                      </button>
                    );
                  },
                )}

              </div>
            )}

          </section>

        </>
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
              setCreateOpen(false);
            }
          }}
        >

          <form
            className="library-modal"
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
                  setCreateOpen(false);
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
                className="library-modal-secondary"
                disabled={
                  creating
                }
                onClick={() => {
                  setCreateOpen(false);
                }}
              >
                Cancel
              </button>

              <button
                type="submit"
                className="library-primary-action"
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
