import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  cleanupLegacyUnscopedDownloads,
  getActivePlaylistDownloads,
  getDownloadedPlaylists,
  getOfflineOwnerKey,
  getPlaylistDownloadJobId,
  reconcileDownloadedPlaylistMembership,
  recoverInterruptedDownloadJobs,
  removePlaylistFromOffline,
  startPlaylistDownloadForOffline,
} from "../offlineDownloads.js";

import {
  getPlaylist,
} from "../playlistApi.js";

import {
  findMissingPlaylistTracks,
  mergeDetectedPlaylistUpdates,
  missingPlaylistDownloadProgress,
  playlistUpdateKey,
} from "../playlistDownloadUpdates.js";


function playlistJobMetadata(
  playlist,
) {
  return {
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
  };
}


export default function useDownloadedPlaylistUpdates({
  currentUser,
  onStatusMessage,
}) {
  const [
    playlistUpdates,
    setPlaylistUpdates,
  ] = useState([]);

  const [
    activePlaylistDownloads,
    setActivePlaylistDownloads,
  ] = useState([]);

  const updateCheckRef =
    useRef(false);

  const dismissedUpdateKeysRef =
    useRef(
      new Set(),
    );


  const resetDownloadedPlaylistUpdates =
    useCallback(
      () => {
        updateCheckRef.current =
          false;

        dismissedUpdateKeysRef
          .current
          .clear();

        setPlaylistUpdates(
          [],
        );

        setActivePlaylistDownloads(
          [],
        );
      },
      [],
    );


  const syncActivePlaylistDownloads =
    useCallback(
      () => {
        if (
          currentUser?.account_type !==
            "registered"
        ) {
          setActivePlaylistDownloads(
            [],
          );

          return;
        }

        setActivePlaylistDownloads(
          getActivePlaylistDownloads(
            getOfflineOwnerKey(
              currentUser,
            ),
          ),
        );
      },
      [
        currentUser,
      ],
    );


  const checkDownloadedPlaylistUpdates =
    useCallback(
      async () => {
        if (
          currentUser?.account_type !==
            "registered" ||
          globalThis.navigator
            ?.onLine ===
            false ||
          updateCheckRef.current
        ) {
          return;
        }

        updateCheckRef.current =
          true;

        try {
          const offlineOwnerKey =
            getOfflineOwnerKey(
              currentUser,
            );

          const downloadedPlaylists =
            await getDownloadedPlaylists(
              offlineOwnerKey,
            );

          const detected =
            (
              await Promise.all(
                downloadedPlaylists.map(
                  async (
                    downloadedPlaylist,
                  ) => {
                    try {
                      const livePlaylist =
                        await getPlaylist(
                          downloadedPlaylist.id,
                        );

                      await reconcileDownloadedPlaylistMembership(
                        livePlaylist,
                        offlineOwnerKey,
                      );

                      const missingTracks =
                        findMissingPlaylistTracks(
                          livePlaylist,
                          downloadedPlaylist,
                        );

                      if (
                        livePlaylist.is_liked_songs
                      ) {
                        if (
                          missingTracks.length >
                          0
                        ) {
                          await startPlaylistDownloadForOffline(
                            livePlaylist.tracks,
                            {
                              jobId:
                                getPlaylistDownloadJobId(
                                  offlineOwnerKey,
                                  livePlaylist.id,
                                ),
                              ownerKey:
                                offlineOwnerKey,
                              jobMetadata:
                                playlistJobMetadata(
                                  livePlaylist,
                                ),
                            },
                          );

                          window.dispatchEvent(
                            new CustomEvent(
                              "hypersync:offline-playlist-updated",
                              {
                                detail: {
                                  playlistId:
                                    livePlaylist.id,
                                },
                              },
                            ),
                          );
                        }

                        return null;
                      }

                      if (
                        livePlaylist.visibility !==
                          "generated" ||
                        missingTracks.length ===
                          0
                      ) {
                        return null;
                      }

                      const key =
                        playlistUpdateKey(
                          livePlaylist,
                          missingTracks,
                        );

                      if (
                        dismissedUpdateKeysRef
                          .current
                          .has(
                            key,
                          )
                      ) {
                        return null;
                      }

                      return {
                        key,
                        playlist:
                          livePlaylist,
                        missingTracks,
                        status:
                          "ready",
                        progress:
                          0,
                      };

                    } catch (error) {
                      if (
                        error?.status ===
                          404
                      ) {
                        await removePlaylistFromOffline(
                          downloadedPlaylist.id,
                          offlineOwnerKey,
                        ).catch(
                          () => false,
                        );

                        window.dispatchEvent(
                          new CustomEvent(
                            "hypersync:offline-downloads-changed",
                          ),
                        );
                      }

                      return null;
                    }
                  },
                ),
              )
            ).filter(
              Boolean,
            );

          setPlaylistUpdates(
            (current) =>
              mergeDetectedPlaylistUpdates(
                current,
                detected,
              ),
          );

        } finally {
          updateCheckRef.current =
            false;
        }
      },
      [
        currentUser,
      ],
    );


  const dismissPlaylistUpdate =
    useCallback(
      () => {
        setPlaylistUpdates(
          (current) => {
            const [
              active,
              ...rest
            ] = current;

            if (
              active?.key
            ) {
              dismissedUpdateKeysRef
                .current
                .add(
                  active.key,
                );
            }

            return rest;
          },
        );
      },
      [],
    );


  const downloadActivePlaylistUpdate =
    useCallback(
      async () => {
        const update =
          playlistUpdates[0];

        if (
          !update ||
          update.status ===
            "downloading"
        ) {
          return;
        }

        const {
          playlist,
          missingTracks,
          key,
        } = update;

        const offlineOwnerKey =
          getOfflineOwnerKey(
            currentUser,
          );

        setPlaylistUpdates(
          (current) =>
            current.map(
              (item) =>
                item.key ===
                  key
                  ? {
                      ...item,
                      status:
                        "downloading",
                      progress:
                        0,
                    }
                  : item,
            ),
        );

        try {
          await startPlaylistDownloadForOffline(
            playlist.tracks,
            {
              jobId:
                getPlaylistDownloadJobId(
                  offlineOwnerKey,
                  playlist.id,
                ),
              ownerKey:
                offlineOwnerKey,
              jobMetadata:
                playlistJobMetadata(
                  playlist,
                ),
              onProgress: ({
                trackProgress,
              }) => {
                const progress =
                  missingPlaylistDownloadProgress(
                    missingTracks,
                    trackProgress,
                  );

                setPlaylistUpdates(
                  (current) =>
                    current.map(
                      (item) =>
                        item.key ===
                          key
                          ? {
                              ...item,
                              status:
                                "downloading",
                              progress,
                            }
                          : item,
                    ),
                );
              },
            },
          );

          setPlaylistUpdates(
            (current) =>
              current.filter(
                (item) =>
                  item.key !==
                  key,
              ),
          );

          onStatusMessage?.(
            `${missingTracks.length} ${missingTracks.length === 1 ? "new song" : "new songs"} downloaded to ${playlist.title}.`,
          );

          window.dispatchEvent(
            new CustomEvent(
              "hypersync:offline-playlist-updated",
              {
                detail: {
                  playlistId:
                    playlist.id,
                },
              },
            ),
          );

        } catch (error) {
          setPlaylistUpdates(
            (current) =>
              current.map(
                (item) =>
                  item.key ===
                    key
                    ? {
                        ...item,
                        status:
                          "ready",
                        progress:
                          0,
                      }
                    : item,
              ),
          );

          onStatusMessage?.(
            error instanceof Error
              ? error.message
              : "Unable to download new playlist songs.",
          );
        }
      },
      [
        currentUser,
        onStatusMessage,
        playlistUpdates,
      ],
    );


  useEffect(() => {
    syncActivePlaylistDownloads();

    window.addEventListener(
      "hypersync:offline-download-progress",
      syncActivePlaylistDownloads,
    );

    window.addEventListener(
      "hypersync:offline-downloads-changed",
      syncActivePlaylistDownloads,
    );

    return () => {
      window.removeEventListener(
        "hypersync:offline-download-progress",
        syncActivePlaylistDownloads,
      );

      window.removeEventListener(
        "hypersync:offline-downloads-changed",
        syncActivePlaylistDownloads,
      );
    };
  }, [
    syncActivePlaylistDownloads,
  ]);


  useEffect(() => {
    if (
      currentUser?.account_type !==
        "registered"
    ) {
      setPlaylistUpdates(
        [],
      );

      return undefined;
    }

    let cancelled =
      false;

    void (
      async () => {
        try {
          await cleanupLegacyUnscopedDownloads();

          if (
            cancelled
          ) {
            return;
          }

          await recoverInterruptedDownloadJobs(
            getOfflineOwnerKey(
              currentUser,
            ),
          );

          if (
            cancelled
          ) {
            return;
          }

          await checkDownloadedPlaylistUpdates();

        } catch (error) {
          if (
            !cancelled
          ) {
            console.warn(
              "Offline playlist recovery failed.",
              error,
            );
          }
        }
      }
    )();

    const intervalId =
      window.setInterval(
        () => {
          void checkDownloadedPlaylistUpdates();
        },
        15_000,
      );

    const handleFocus =
      () => {
        void checkDownloadedPlaylistUpdates();
      };

    const handleVisibility =
      () => {
        if (
          document.visibilityState ===
            "visible"
        ) {
          void checkDownloadedPlaylistUpdates();
        }
      };

    window.addEventListener(
      "focus",
      handleFocus,
    );

    window.addEventListener(
      "online",
      handleFocus,
    );

    window.addEventListener(
      "hypersync:library-changed",
      handleFocus,
    );

    document.addEventListener(
      "visibilitychange",
      handleVisibility,
    );

    return () => {
      cancelled =
        true;

      window.clearInterval(
        intervalId,
      );

      window.removeEventListener(
        "focus",
        handleFocus,
      );

      window.removeEventListener(
        "online",
        handleFocus,
      );

      window.removeEventListener(
        "hypersync:library-changed",
        handleFocus,
      );

      document.removeEventListener(
        "visibilitychange",
        handleVisibility,
      );
    };
  }, [
    checkDownloadedPlaylistUpdates,
    currentUser,
  ]);


  return {
    activePlaylistDownloads,
    activePlaylistUpdate:
      playlistUpdates[0] ??
      null,
    dismissPlaylistUpdate,
    downloadActivePlaylistUpdate,
    resetDownloadedPlaylistUpdates,
    refreshDownloadedPlaylistUpdates:
      checkDownloadedPlaylistUpdates,
  };
}
