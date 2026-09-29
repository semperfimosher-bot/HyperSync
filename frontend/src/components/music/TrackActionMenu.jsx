import {
  useEffect,
  useState,
} from "react";

import * as player from
  "../../audioPlayer.js";

import {
  apiRequest,
} from "../../api/client.js";

import {
  queueOnDemandTrack,
} from "../../searchApi.js";

import {
  isOnDemandTrackId,
} from "../../onDemandMusic.js";

import {
  addLikedTrackOfflinePin,
  downloadTrackForOffline,
  getLikedSongsDownloadPinRef,
  getManualDownloadPinRef,
  getOfflineOwnerKey,
  isTrackDownloaded,
  removeLikedTrackFromOffline,
} from "../../offlineDownloads.js";

import {
  addTrackToPlaylist,
  getLibraryTrack,
  getLikedTrackState,
  getMyPlaylists,
  likeTrack,
  unlikeTrack,
} from "../../playlistApi.js";

import Icon from
  "../ui/Icon.jsx";

import {
  requestMusicShare,
  trackShareItem,
} from "../../musicShare.js";


function playerTrack(
  track,
  overrides = {},
) {
  return {
    id:
      overrides.id ??
      track.id,

    audioUrl:
      overrides.audioUrl ??
      track.audio_url ??
      track.audioUrl ??
      null,

    artworkUrl:
      track.artwork_url ??
      track.artworkUrl ??
      null,

    mimeType:
      track.mime_type ??
      track.mimeType ??
      null,

    fileSize:
      track.file_size ??
      track.fileSize ??
      null,

    mediaVersion:
      track.media_version ??
      track.mediaVersion ??
      null,

    artworkVersion:
      track.artwork_version ??
      track.artworkVersion ??
      null,

    durationSeconds:
      track.duration_seconds ??
      track.durationSeconds ??
      null,

    title:
      track.title ?? "",

    artist:
      track.artist ?? "",

    album:
      track.album ?? "",

    genre:
      track.genre ?? "",

    releaseYear:
      track.release_year ??
      track.releaseYear ??
      null,

    onDemand:
      overrides.onDemand ??
      Boolean(
        track.onDemand ??
        track.on_demand ??
        track.source_type ===
          "on_demand",
      ),

    provisionKey:
      overrides.provisionKey ??
      track.provision_key ??
      track.provisionKey ??
      null,

    provisionId:
      overrides.provisionId ??
      track.provision_id ??
      track.provisionId ??
      null,

    catalogTrackId:
      overrides.catalogTrackId ??
      track.catalog_track_id ??
      track.catalogTrackId ??
      null,
  };
}


export default function TrackActionMenu({
  menu,
  onClose,
  currentUser,
  onRequireAuth,
}) {
  const [
    playlistMode,
    setPlaylistMode,
  ] = useState(
    false,
  );

  const [
    infoMode,
    setInfoMode,
  ] = useState(
    false,
  );

  const [
    infoTrack,
    setInfoTrack,
  ] = useState(null);

  const [
    loadingInfo,
    setLoadingInfo,
  ] = useState(false);

  const [
    playlists,
    setPlaylists,
  ] = useState([]);

  const [
    loadingPlaylists,
    setLoadingPlaylists,
  ] = useState(
    false,
  );

  const [
    busy,
    setBusy,
  ] = useState(
    "",
  );

  const [
    notice,
    setNotice,
  ] = useState(
    "",
  );

  const [
    liked,
    setLiked,
  ] = useState(
    false,
  );

  const [
    downloaded,
    setDownloaded,
  ] = useState(
    false,
  );

  const track =
    menu?.track ??
    null;

  const isRegistered =
    currentUser?.account_type ===
    "registered";

  const onDemandTrack =
    Boolean(
      track &&
      (
        track.source_type ===
          "on_demand" ||
        track.onDemand ||
        track.on_demand ||
        isOnDemandTrackId(
          track.id,
        )
      )
    );

  const offlineOwnerKey =
    getOfflineOwnerKey(
      currentUser,
    );

  const manualDownloadPinRef =
    getManualDownloadPinRef(
      offlineOwnerKey,
    );

  const likedSongsDownloadPinRef =
    getLikedSongsDownloadPinRef(
      offlineOwnerKey,
    );


  useEffect(() => {
    setPlaylistMode(false);
    setInfoMode(false);
    setInfoTrack(
      track ?? null,
    );
    setLoadingInfo(false);

    setPlaylists([]);

    setNotice("");

    setBusy("");

    setLiked(false);

    setDownloaded(
      Boolean(
        track?.downloaded,
      ),
    );
  }, [
    track?.id,
  ]);


  useEffect(() => {
    if (
      !menu ||
      !track ||
      !isRegistered ||
      onDemandTrack
    ) {
      return;
    }

    let cancelled =
      false;

    void getLikedTrackState(
      track.id,
    )
      .then(
        (result) => {
          if (!cancelled) {
            setLiked(
              Boolean(
                result?.liked,
              ),
            );
          }
        },
      )
      .catch(
        () => {},
      );

    if (offlineOwnerKey) {
      void isTrackDownloaded(
        track,
        {
          ownerKey:
            offlineOwnerKey,
        },
      )
        .then(
          (value) => {
            if (!cancelled) {
              setDownloaded(
                Boolean(
                  value,
                ),
              );
            }
          },
        )
        .catch(
          () => {},
        );
    }

    return () => {
      cancelled =
        true;
    };
  }, [
    menu,
    track?.id,
    isRegistered,
    onDemandTrack,
    likedSongsDownloadPinRef,
    manualDownloadPinRef,
    offlineOwnerKey,
  ]);


  useEffect(() => {
    if (!menu) {
      return undefined;
    }

    function handleKeyDown(
      event,
    ) {
      if (
        event.key ===
        "Escape"
      ) {
        onClose();
      }
    }

    window.addEventListener(
      "keydown",
      handleKeyDown,
    );

    return () => {
      window.removeEventListener(
        "keydown",
        handleKeyDown,
      );
    };
  }, [
    menu,
    onClose,
  ]);


  if (
    !menu ||
    !track
  ) {
    return null;
  }


  function requireAccount() {
    onClose();

    onRequireAuth?.();
  }


  async function openSongInfo() {
    setInfoMode(
      true,
    );

    setPlaylistMode(
      false,
    );

    setInfoTrack(
      track,
    );

    if (
      !track?.id ||
      onDemandTrack
    ) {
      return;
    }

    setLoadingInfo(
      true,
    );

    try {
      const canonical =
        await apiRequest(
          "/catalog/tracks/"
          + encodeURIComponent(
              track.id,
            ),
          {
            cache:
              "no-store",
          },
        );

      setInfoTrack({
        ...track,
        ...canonical,
      });
    } catch {
      // Local track metadata is still useful
      // when the catalog request is offline.
    } finally {
      setLoadingInfo(
        false,
      );
    }
  }


  async function openPlaylists() {
    if (!isRegistered) {
      requireAccount();

      return;
    }

    setPlaylistMode(true);

    if (
      playlists.length > 0
    ) {
      return;
    }

    setLoadingPlaylists(
      true,
    );

    setNotice("");

    try {
      const result =
        await getMyPlaylists();

      setPlaylists(
        (
          Array.isArray(result)
            ? result
            : []
        ).filter(
          (playlist) =>
            playlist.visibility !==
            "generated",
        ),
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Unable to load playlists.",
      );
    } finally {
      setLoadingPlaylists(
        false,
      );
    }
  }


  async function addToPlaylist(
    playlist,
  ) {
    setBusy(
      playlist.id,
    );

    setNotice("");

    try {
      await addTrackToPlaylist(
        playlist.id,
        track.id,
      );

      setNotice(
        `Added to ${playlist.title}`,
      );

      window.dispatchEvent(
        new CustomEvent(
          "hypersync:library-changed",
        ),
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Unable to add song.",
      );
    } finally {
      setBusy("");
    }
  }


  async function toggleLike() {
    if (!isRegistered) {
      requireAccount();

      return;
    }

    setBusy(
      "like",
    );

    setNotice("");

    try {
      if (liked) {
        await unlikeTrack(
          track.id,
        );

        setLiked(false);

        if (offlineOwnerKey) {
          await removeLikedTrackFromOffline(
            track,
            offlineOwnerKey,
          ).catch(
            () => false,
          );

          const stillDownloaded =
            await isTrackDownloaded(
              track,
              {
                ownerKey:
                  offlineOwnerKey,
              },
            ).catch(
              () => downloaded,
            );

          setDownloaded(
            Boolean(
              stillDownloaded,
            ),
          );

          window.dispatchEvent(
            new CustomEvent(
              "hypersync:offline-downloads-changed",
            ),
          );
        }

        window.dispatchEvent(
          new CustomEvent(
            "hypersync:library-changed",
          ),
        );

        setNotice(
          "Removed from Liked Songs",
        );
      } else {
        await likeTrack(
          track.id,
        );

        setLiked(true);

        try {
          const canonicalTrack =
            await getLibraryTrack(
              track.id,
            );

          await downloadTrackForOffline(
            canonicalTrack ??
              track,
            {
              pinRef:
                likedSongsDownloadPinRef,
            },
          );

          setDownloaded(
            true,
          );

          window.dispatchEvent(
            new CustomEvent(
              "hypersync:offline-downloads-changed",
            ),
          );

          setNotice(
            "Added to Liked Songs • available offline",
          );
        } catch (downloadError) {
          setNotice(
            downloadError instanceof Error
              ? (
                  "Added to Liked Songs, but offline download failed: " +
                  downloadError.message
                )
              : "Added to Liked Songs, but offline download failed.",
          );
        }

        window.dispatchEvent(
          new CustomEvent(
            "hypersync:library-changed",
          ),
        );
      }
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Unable to update Liked Songs.",
      );
    } finally {
      setBusy("");
    }
  }


  async function prepareTrackForQueue() {
    if (!onDemandTrack) {
      return playerTrack(
        track,
      );
    }

    if (!isRegistered) {
      requireAccount();

      return null;
    }

    const candidateKey =
      String(
        track.provision_key ??
        track.provisionKey ??
        "",
      ).trim();

    if (!candidateKey) {
      throw new Error(
        "This on-demand song is missing its provisioning key.",
      );
    }

    const prepared =
      await queueOnDemandTrack(
        candidateKey,
      );

    const permanentTrackId =
      prepared?.track_id ??
      null;

    const provisionId =
      prepared?.provision_id ??
      null;

    const playbackId =
      permanentTrackId ??
      (
        "ondemand:" +
        String(
          provisionId ??
          candidateKey,
        )
      );

    const audioUrl =
      permanentTrackId
        ? (
            "/api/audio/" +
            encodeURIComponent(
              permanentTrackId,
            )
          )
        : prepared?.stream_url;

    if (!audioUrl) {
      throw new Error(
        "The queued song could not be prewarmed.",
      );
    }

    return playerTrack(
      track,
      {
        id:
          playbackId,
        audioUrl,
        onDemand:
          !permanentTrackId,
        provisionKey:
          candidateKey,
        provisionId,
        catalogTrackId:
          permanentTrackId,
      },
    );
  }


  async function queueTrack(
    mode,
  ) {
    if (busy) {
      return;
    }

    const busyKey =
      mode === "next"
        ? "play-next"
        : "add-queue";

    setBusy(
      busyKey,
    );

    setNotice(
      onDemandTrack
        ? "Preparing and publishing queued song..."
        : "",
    );

    try {
      const queuedTrack =
        await prepareTrackForQueue();

      if (!queuedTrack) {
        return;
      }

      const added =
        mode === "next"
          ? player.playTrackNext(
              queuedTrack,
            )
          : player.addTrackToQueue(
              queuedTrack,
            );

      if (!added) {
        throw new Error(
          "Unable to update the playback queue.",
        );
      }

      setNotice(
        mode === "next"
          ? (
              onDemandTrack
                ? "Prewarmed and publishing • will play next"
                : "Will play next"
            )
          : (
              onDemandTrack
                ? "Prewarmed and publishing • added to queue"
                : "Added to queue"
            ),
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Unable to prepare this queued song.",
      );
    } finally {
      setBusy(
        "",
      );
    }
  }


  async function downloadTrack() {
    if (downloaded) {
      return;
    }

    setBusy(
      "download",
    );

    setNotice("");

    let addedToLikedSongs =
      false;

    try {
      /*
       * Individual downloads are Library music.
       * Add the track to Liked Songs first so
       * Artists/Albums update immediately and
       * the download never becomes orphaned
       * from the user's Library index.
       */
      if (!liked) {
        await likeTrack(
          track.id,
        );

        setLiked(
          true,
        );

        addedToLikedSongs =
          true;
      }

      const canonicalTrack =
        await getLibraryTrack(
          track.id,
        );

      const offlineTrack =
        canonicalTrack ??
        track;

      await downloadTrackForOffline(
        offlineTrack,
        {
          pinRef:
            manualDownloadPinRef,
        },
      );

      /*
       * A manual download also lives in
       * Liked Songs, so give the same cached
       * media an independent Liked Songs pin.
       * This adds no second network download.
       */
      await addLikedTrackOfflinePin(
        offlineTrack,
        offlineOwnerKey,
      );

      setDownloaded(
        true,
      );

      setNotice(
        "Available offline",
      );

      window.dispatchEvent(
        new CustomEvent(
          "hypersync:offline-downloads-changed",
        ),
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Unable to download song.",
      );
    } finally {
      if (
        addedToLikedSongs
      ) {
        window.dispatchEvent(
          new CustomEvent(
            "hypersync:library-changed",
          ),
        );
      }

      setBusy("");
    }
  }


  return (
    <div
      className={[
        "track-action-layer",

        menu.mode ===
        "mobile"
          ? "is-mobile"
          : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onPointerDown={(
        event,
      ) => {
        if (
          event.target ===
          event.currentTarget
        ) {
          onClose();
        }
      }}
    >

      <div
  role="menu"
  className="track-action-menu"
  onPointerDown={(
    event,
  ) => {
    event.stopPropagation();
  }}
>

        <div className="track-action-menu__track">

          <div>

            <strong>
              {track.title}
            </strong>

            <small>
              {track.artist}
            </small>

          </div>

          <button
            type="button"
            aria-label="Close"
            onClick={
              onClose
            }
          >
            <Icon
              name="close"
              size={14}
            />
          </button>

        </div>


        {infoMode ? (
          <>
            <button
              type="button"
              className="track-action-menu__back"
              onClick={() => {
                setInfoMode(
                  false,
                );
              }}
            >
              ← Back
            </button>

            <div className="track-action-menu__label">
              SONG INFO
            </div>

            <div className="track-action-info">
              <div>
                <span>
                  Title
                </span>
                <strong>
                  {infoTrack?.title ||
                    track.title ||
                    "Unknown"}
                </strong>
              </div>

              <div>
                <span>
                  Artist
                </span>
                <strong>
                  {infoTrack?.artist ||
                    track.artist ||
                    "Unknown Artist"}
                </strong>
              </div>

              <div>
                <span>
                  Genre
                </span>
                <strong>
                  {infoTrack?.genre ||
                    "Unknown"}
                </strong>
              </div>

              <div>
                <span>
                  Year released
                </span>
                <strong>
                  {infoTrack?.release_year ||
                    infoTrack?.releaseYear ||
                    "Unknown"}
                </strong>
              </div>

              {infoTrack?.album ? (
                <div>
                  <span>
                    Album
                  </span>
                  <strong>
                    {infoTrack.album}
                  </strong>
                </div>
              ) : null}

              {loadingInfo ? (
                <small>
                  Refreshing catalog metadata...
                </small>
              ) : null}
            </div>
          </>
        ) : playlistMode ? (
          <>

            <button
              type="button"
              className="track-action-menu__back"
              onClick={() => {
                setPlaylistMode(
                  false,
                );
              }}
            >
              ← Back
            </button>


            <div className="track-action-menu__label">
              ADD TO PLAYLIST
            </div>


            <div className="track-action-playlists">

              {loadingPlaylists ? (
                <div className="track-action-menu__status">
                  Loading playlists...
                </div>
              ) : playlists.length ===
                0 ? (
                <div className="track-action-menu__status">
                  No playlists yet.
                </div>
              ) : (
                playlists.map(
                  (
                    playlist,
                  ) => (
                    <button
                      type="button"
                      key={
                        playlist.id
                      }
                      disabled={
                        Boolean(
                          busy,
                        )
                      }
                      onClick={() => {
                        void addToPlaylist(
                          playlist,
                        );
                      }}
                    >
                      <span className="track-action-icon">
                        <Icon
                          name="playlist"
                          size={15}
                        />
                      </span>

                      <span>
                        <strong>
                          {playlist.title}
                        </strong>

                        <small>
                          {playlist.track_count}
                          {" "}
                          {playlist.track_count ===
                          1
                            ? "track"
                            : "tracks"}
                        </small>
                      </span>

                      {busy ===
                      playlist.id ? (
                        <i className="track-action-spinner" />
                      ) : (
                        <Icon
                          name="plus"
                          size={13}
                        />
                      )}
                    </button>
                  ),
                )
              )}

            </div>

          </>
        ) : (
          <>

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                void player.playTrack(
                  track.id,
                  playerTrack(
                    track,
                  ),
                );

                onClose();
              }}
            >
              <span className="track-action-icon">
                <Icon
                  name="play"
                  size={15}
                />
              </span>

              <span>
                Play
              </span>
            </button>


            <button
              type="button"
              role="menuitem"
              disabled={
                Boolean(
                  busy,
                )
              }
              onClick={() => {
                void queueTrack(
                  "next",
                );
              }}
            >
              <span className="track-action-icon">
                <Icon
                  name="playlist"
                  size={15}
                />
              </span>

              <span>
                {busy ===
                "play-next"
                  ? "Preparing..."
                  : "Play next"}
              </span>
            </button>


            <button
              type="button"
              role="menuitem"
              disabled={
                Boolean(
                  busy,
                )
              }
              onClick={() => {
                void queueTrack(
                  "append",
                );
              }}
            >
              <span className="track-action-icon">
                <Icon
                  name="plus"
                  size={15}
                />
              </span>

              <span>
                {busy ===
                "add-queue"
                  ? "Preparing..."
                  : "Add to queue"}
              </span>
            </button>


            {!onDemandTrack ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  void openPlaylists();
                }}
              >
              <span className="track-action-icon">
                <Icon
                  name="plus"
                  size={15}
                />
              </span>

              <span>
                Add to playlist
              </span>

              <Icon
                name="chevron"
                size={13}
              />
              </button>
            ) : null}


            <button
              type="button"
              role="menuitem"
              onClick={() => {
                void openSongInfo();
              }}
            >
              <span className="track-action-icon">
                <Icon
                  name="disc"
                  size={15}
                />
              </span>

              <span>
                Song info
              </span>

              <Icon
                name="chevron"
                size={13}
              />
            </button>


            <button
              type="button"
              role="menuitem"
              onClick={() => {
                if (!isRegistered) {
                  requireAccount();
                  return;
                }

                requestMusicShare(
                  trackShareItem(
                    track,
                  ),
                );

                onClose();
              }}
            >
              <span className="track-action-icon">
                <Icon
                  name="mail"
                  size={15}
                />
              </span>

              <span>
                Share in chat
              </span>
            </button>


            {menu.contextActions?.length > 0 ? (
              <>
                <div className="track-action-menu__divider" />

                {menu.contextActions.map(
                  (action) => (
                    <button
                      type="button"
                      role="menuitem"
                      key={action.id}
                      disabled={
                        Boolean(
                          action.disabled,
                        )
                      }
                      className={
                        action.danger
                          ? "track-action-menu__danger"
                          : ""
                      }
                      onClick={() => {
                        onClose();

                        void Promise
                          .resolve(
                            action.onSelect?.(
                              track,
                            ),
                          )
                          .catch(
                            () => {},
                          );
                      }}
                    >
                      <span className="track-action-icon">
                        <Icon
                          name={
                            action.icon ||
                            "close"
                          }
                          size={15}
                        />
                      </span>

                      <span>
                        {action.label}
                      </span>
                    </button>
                  ),
                )}
              </>
            ) : null}


            <div className="track-action-menu__divider" />


            {!menu.hideLikeAction &&
            !onDemandTrack ? (
              <button
                type="button"
                role="menuitem"
                disabled={
                  busy === "like"
                }
                onClick={() => {
                  void toggleLike();
                }}
              >
                <span className="track-action-icon">
                  <Icon
                    name={
                      liked
                        ? "check"
                        : "heart"
                    }
                    size={15}
                  />
                </span>

                <span>
                  {liked
                    ? "Remove from Liked Songs"
                    : "Add to Liked Songs"}
                </span>
              </button>
            ) : null}


            {!onDemandTrack ? (
              <button
                type="button"
                role="menuitem"
                disabled={
                  downloaded ||
                  busy ===
                    "download"
                }
                onClick={() => {
                  void downloadTrack();
                }}
              >
              <span className="track-action-icon">
                <Icon
                  name={
                    downloaded
                      ? "check"
                      : "download"
                  }
                  size={15}
                />
              </span>

              <span>
                {downloaded
                  ? "Downloaded for offline"
                  : "Download for offline"}
              </span>
              </button>
            ) : null}

          </>
        )}


        {notice ? (
          <div className="track-action-menu__notice">
            {notice}
          </div>
        ) : null}

      </div>

    </div>
  );
}
