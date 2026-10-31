import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import * as player from
  "../../audioPlayer.js";


import useTrackActionMenu from
  "../../hooks/useTrackActionMenu.js";

import TrackActionMenu from
  "../music/TrackActionMenu.jsx";

import Icon from
  "../ui/Icon.jsx";

import MessageNotificationPanel from
  "../ui/MessageNotificationPanel.jsx";

import PlaylistUpdateNotice from
  "../ui/PlaylistUpdateNotice.jsx";

import TrackArtwork from
  "../ui/TrackArtwork.jsx";


export default function PlayerBar({
  playlistUpdate,
  onDownloadPlaylistUpdate,
  onDismissPlaylistUpdate,
  currentUser,
  onOpenAuth,
  messageNotifications,
  onOpenMessage,
  onOpenNotification,
  onDeleteNotification,
  onEnablePush,
  pushBusy,
  pushEnabled,
  installState,
  onInstallApp,
  onOpenPlayerDetails,
}) {
  const trackActionMenu =
    useTrackActionMenu();

  const [
    notificationsOpen,
    setNotificationsOpen,
  ] = useState(false);


  const playerDetailsPressTimerRef =
    useRef(null);

  const playerDetailsPointerRef =
    useRef(null);

  const [
    state,
    setState,
  ] = useState(() => ({
    src: null,
    paused: true,
    currentTime: 0,
    duration: 0,
  }));


  useEffect(() => {
    const unsub =
      player.subscribe(
        (nextState) => {
          setState(
            nextState,
          );
        },
      );

    return unsub;
  }, []);


  const toggle = useCallback(async () => {
    try { await player.togglePlay(); } catch {
      // Browser autoplay restrictions can prevent playback.
    }
  }, []);

  const formatTime = (t) => {
    if (
      !isFinite(t) ||
      t <= 0
    ) {
      return "0:00";
    }

    const mins =
      Math.floor(
        t / 60,
      );

    const secs =
      Math.floor(
        t % 60,
      )
        .toString()
        .padStart(
          2,
          "0",
        );

    return `${mins}:${secs}`;
  };

  const currentQueueTrack =
    Array.isArray(
      state.queue,
    ) &&
    Number.isInteger(
      state.queueIndex,
    )
      ? state.queue[
          state.queueIndex
        ] ??
        null
      : null;

  const displayTrackId =

    state.trackId ??
    null;

  const displayTitle =

    state.title ??
    currentQueueTrack?.meta
      ?.title ??
    "";

  const displayArtist =

    state.artist ??
    currentQueueTrack?.meta
      ?.artist ??
    "";

  const displayAlbum =

    state.album ??
    currentQueueTrack?.meta
      ?.album ??
    "";

  const displayArtworkUrl =

    state.artworkUrl ??
    currentQueueTrack?.meta
      ?.artworkUrl ??
    null;

  const titleText =
    displayTitle ||
    (
      state.src
        ? decodeURIComponent(
            state.src.replace(
              /.*\//,
              "",
            ),
          )
        : "Nothing playing"
    );

  const subtitleText = displayArtist
    ? [displayArtist, displayAlbum].filter(Boolean).join(" • ")
    : displayTrackId ? "Now playing" : "Select a track to start listening";
  const effectivePaused = Boolean(state.paused);
  const canControl = Boolean(state.src);
  const effectiveDuration = state.duration > 0 ? state.duration : 0;

  const progressMax =
    effectiveDuration > 0
      ? effectiveDuration
      : 1;

  const effectiveCurrentTime = state.currentTime || 0;

  const progressValue =
    Math.min(
      Math.max(
        effectiveCurrentTime,
        0,
      ),
      progressMax,
    );

  const handlePrevious = () => { void player.skipToPrevious(); };
  const handleNext = () => { void player.skipToNext(); };
  const handleSeek = (value) => { player.seekTo(value); };

  const clearPlayerDetailsPress =
    useCallback(
      () => {
        if (
          playerDetailsPressTimerRef
            .current
        ) {
          window.clearTimeout(
            playerDetailsPressTimerRef
              .current,
          );

          playerDetailsPressTimerRef.current =
            null;
        }

        playerDetailsPointerRef.current =
          null;
      },
      [],
    );


  useEffect(() => {
    return () => {
      clearPlayerDetailsPress();
    };
  }, [
    clearPlayerDetailsPress,
  ]);


  const handlePlayerDetailsPointerDown =
    useCallback(
      (event) => {
        if (
          event.pointerType !==
            "touch" ||
          !onOpenPlayerDetails ||
          (
            !displayTrackId &&
            !state.queue?.length
          )
        ) {
          return;
        }

        if (
          event.target instanceof
            Element &&
          event.target.closest(
            [
              "button",
              "input",
              "a[href]",
              "[role='button']",
              "[role='slider']",
            ].join(", "),
          )
        ) {
          return;
        }

        clearPlayerDetailsPress();

        const pointer = {
          pointerId:
            event.pointerId,
          x:
            event.clientX,
          y:
            event.clientY,
        };

        playerDetailsPointerRef.current =
          pointer;

        playerDetailsPressTimerRef.current =
          window.setTimeout(
            () => {
              playerDetailsPressTimerRef.current =
                null;

              playerDetailsPointerRef.current =
                null;

              try {
                navigator.vibrate?.(
                  10,
                );
              } catch {
                // Haptics are optional.
              }

              onOpenPlayerDetails();
            },
            520,
          );
      },
      [
        clearPlayerDetailsPress,
        displayTrackId,
        onOpenPlayerDetails,
        state.queue?.length,
      ],
    );


  const handlePlayerDetailsPointerMove =
    useCallback(
      (event) => {
        const pointer =
          playerDetailsPointerRef
            .current;

        if (
          !pointer ||
          pointer.pointerId !==
            event.pointerId
        ) {
          return;
        }

        const movedX =
          Math.abs(
            event.clientX -
              pointer.x,
          );

        const movedY =
          Math.abs(
            event.clientY -
              pointer.y,
          );

        if (
          movedX > 12 ||
          movedY > 12
        ) {
          clearPlayerDetailsPress();
        }
      },
      [
        clearPlayerDetailsPress,
      ],
    );


  const currentTrackAction =
    displayTrackId
      ? {
          id:
            displayTrackId,
          title:
            displayTitle,
          artist:
            displayArtist,
          album:
            displayAlbum,
          audio_url:

            currentQueueTrack?.meta
              ?.audioUrl ??
            null,
          artwork_url:
            displayArtworkUrl,
          mime_type:

            state.mimeType ??
            currentQueueTrack?.meta
              ?.mimeType ??
            null,
          file_size:

            state.fileSize ??
            currentQueueTrack?.meta
              ?.fileSize ??
            null,
          media_version:

            state.mediaVersion ??
            currentQueueTrack?.meta
              ?.mediaVersion ??
            null,
          artwork_version:

            state.artworkVersion ??
            currentQueueTrack?.meta
              ?.artworkVersion ??
            null,
          duration_seconds:

            state.durationSeconds ??
            currentQueueTrack?.meta
              ?.durationSeconds ??
            null,
        }
      : null;

  const currentTrackMenuTriggerProps =
    currentTrackAction
      ? trackActionMenu.getTriggerProps(
          currentTrackAction,
        )
      : {};

  return (
    <section
      className="player-bar"
      aria-label="Player"
      onPointerDown={
        handlePlayerDetailsPointerDown
      }
      onPointerMove={
        handlePlayerDetailsPointerMove
      }
      onPointerUp={
        clearPlayerDetailsPress
      }
      onPointerCancel={
        clearPlayerDetailsPress
      }
    >

      {/* =================================================
          LEFT - CURRENT TRACK
          ================================================= */}

      <div
        className="player-bar__track"
        onContextMenu={(event) => {
          const nativeEvent =
            event.nativeEvent;

          if (
            nativeEvent
              ?.pointerType ===
                "touch" ||
            nativeEvent
              ?.sourceCapabilities
              ?.firesTouchEvents
          ) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }

          currentTrackMenuTriggerProps
            .onContextMenu
            ?.(
              event,
            );
        }}
      >

        <TrackArtwork
          src={displayArtworkUrl}
          alt={titleText}
          variant={1}
        />

        <span>

          <strong>
            {titleText}
          </strong>

          <small>
            {subtitleText}
          </small>

        </span>

      </div>


      {/* =================================================
          CENTER - CONTROLS + PROGRESS
          ================================================= */}

      <div className="player-bar__center">

        <div className="desktop-player-controls">

          <button
            type="button"
            onClick={
              handlePrevious
            }
            disabled={!canControl}
            aria-label="Previous"
          >
            <Icon
              name="previous"
              size={17}
            />
          </button>


          <button
            className="desktop-player-controls__main"
            type="button"
            onClick={toggle}
            disabled={!canControl}
            aria-label={
              effectivePaused
                ? "Play"
                : "Pause"
            }
          >
            <Icon
              name={
                effectivePaused
                  ? "play"
                  : "pause"
              }
              size={20}
            />
          </button>


          <button
            type="button"
            onClick={
              handleNext
            }
            disabled={!canControl}
            aria-label="Next"
          >
            <Icon
              name="next"
              size={17}
            />
          </button>

        </div>


        <div className="desktop-progress">

          <span>
            {formatTime(
              effectiveCurrentTime,
            )}
          </span>


          <input
  type="range"
  min="0"
  max={progressMax}
  step="0.1"
  value={progressValue}
  disabled={!canControl}
  aria-label="Playback progress"
  style={{
    "--player-progress":
      `${
        progressMax > 0
          ? (
              progressValue /
              progressMax
            ) * 100
          : 0
      }%`,
  }}
  onChange={(event) => {
    const value =
      Number(
        event.target.value,
      );

    handleSeek(
      value,
    );
  }}
/>


          <span>
            {formatTime(
              effectiveDuration,
            )}
          </span>

        </div>

      </div>


      <div className="player-bar__right">
        <PlaylistUpdateNotice
          update={playlistUpdate}
          variant="desktop"
          onDownload={
            onDownloadPlaylistUpdate
          }
          onDismiss={
            onDismissPlaylistUpdate
          }
        />

        <div className="desktop-player-notification-center">
          <button
            type="button"
            className="icon-button desktop-player-notification-button"
            aria-label="Open notifications"
            aria-expanded={
              notificationsOpen
            }
            onClick={() => {
              if (
                currentUser?.account_type !==
                  "registered"
              ) {
                onOpenAuth?.();
                return;
              }

              setNotificationsOpen(
                (open) => !open,
              );
            }}
          >
            <Icon
              name="bell"
              size={18}
            />

            {messageNotifications?.unread_count ? (
              <span
                className="icon-button__dot"
                aria-hidden="true"
              />
            ) : null}
          </button>

          {notificationsOpen ? (
            <div
              className="desktop-player-notification-panel"
              role="region"
              aria-label="Notifications"
            >
              <MessageNotificationPanel
                data={
                  messageNotifications
                }
                onOpenNotification={(
                  notification,
                ) => {
                  setNotificationsOpen(
                    false,
                  );

                  onOpenNotification?.(
                    notification,
                  );
                }}
                onDeleteNotification={
                  onDeleteNotification
                }
                onEnablePush={
                  onEnablePush
                }
                pushBusy={
                  pushBusy
                }
                pushEnabled={
                  pushEnabled
                }
              />
            </div>
          ) : null}
        </div>

        {!installState?.installed ? (
          <button
            type="button"
            className="icon-button desktop-player-install-button"
            onClick={
              onInstallApp
            }
            disabled={
              installState?.preparing
            }
            aria-label={
              installState?.preparing
                ? "Preparing HyperSynced offline app"
                : "Download and install HyperSynced app"
            }
            title={
              installState?.preparing
                ? "Preparing offline app..."
                : "Download and install HyperSynced"
            }
          >
            <Icon
              name="download"
              size={18}
            />
          </button>
        ) : null}
      </div>


      {/* =================================================
          MOBILE CONTROL
          ================================================= */}

      <div className="mobile-player-actions">
        <button
          className="mobile-player-control"
          type="button"
          onClick={toggle}
          disabled={!canControl}
          aria-label="Playback"
        >
          <Icon
            name={
              effectivePaused
                ? "play"
                : "pause"
            }
            size={19}
          />
        </button>

      </div>


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


    </section>
  );
}

// -----------------------------------------------------------------------------
// Authentication
// -----------------------------------------------------------------------------
