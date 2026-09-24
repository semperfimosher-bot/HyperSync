import {
  useEffect,
  useState,
} from "react";

import * as player from
  "../../audioPlayer.js";

import {
  downloadTrackForOffline,
  getManualDownloadPinRef,
  getOfflineOwnerKey,
  isTrackDownloaded,
} from "../../offlineDownloads.js";

import {
  addTrackToPlaylist,
  getLikedTrackState,
  getMyPlaylists,
  likeTrack,
  unlikeTrack,
} from "../../playlistApi.js";

import Icon from
  "../ui/Icon.jsx";


function playerTrack(
  track,
) {
  return {
    id:
      track.id,

    audioUrl:
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

    title:
      track.title ?? "",

    artist:
      track.artist ?? "",
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

  const offlineOwnerKey =
    getOfflineOwnerKey(
      currentUser,
    );

  const manualDownloadPinRef =
    getManualDownloadPinRef(
      offlineOwnerKey,
    );


  useEffect(() => {
    setPlaylistMode(false);

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
      !isRegistered
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

        setNotice(
          "Removed from Liked Songs",
        );
      } else {
        await likeTrack(
          track.id,
        );

        setLiked(true);

        setNotice(
          "Added to Liked Songs",
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


  async function downloadTrack() {
    setBusy(
      "download",
    );

    setNotice("");

    if (downloaded) {
      return;
    }

    try {
      await downloadTrackForOffline(
        track,
        {
          pinRef:
            manualDownloadPinRef,
        },
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


        {playlistMode ? (
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
              onClick={() => {
                player.addTrackToQueue(
                  playerTrack(
                    track,
                  ),
                );

                setNotice(
                  "Added to queue",
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
                Add to queue
              </span>
            </button>


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


            <div className="track-action-menu__divider" />


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
