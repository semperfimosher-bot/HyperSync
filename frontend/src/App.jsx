import {
  Activity,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import * as player from "./audioPlayer.js";

import {
  getGreetingName,
  isAdminUser
} from "./utils/user.js";

import {
  cacheUserProfile,
  hasStoredSession,
  logoutSession,
  readCachedUserProfile,
  restoreSession,
  saveAuthSession,
  shouldRestoreSession,
} from "./api/auth.js";

import { apiRequest } from "./api/client.js";

import { normalizeAppViewState } from "./appViewState.js";

import {
  PAGE_WARM_SWEEP_MS,
  pruneWarmPages,
  touchWarmPage,
  warmPageKey,
} from "./pageWarmCache.js";

import HexBackdrop from "./components/HexBackdrop.jsx";

import Icon from "./components/ui/Icon.jsx";

import {
  ADMIN_NAV_ITEMS,
  LIBRARY_TABS,
  NAV_ITEMS,
  PAGE_TITLES,
  SEARCH_CATEGORIES,
  SEARCH_SUGGESTIONS,
} from "./constants.js";

import TrackArtwork from "./components/ui/TrackArtwork.jsx";

import TrackActionMenu from
  "./components/music/TrackActionMenu.jsx";

import useTrackActionMenu from
  "./hooks/useTrackActionMenu.js";

import PlaylistUpdateNotice from "./components/ui/PlaylistUpdateNotice.jsx";
import MessageNotificationPanel from "./components/ui/MessageNotificationPanel.jsx";

import NotificationDetailOverlay from
  "./components/ui/NotificationDetailOverlay.jsx";

import PlaybackDevicesPanel from
  "./components/player/PlaybackDevicesPanel.jsx";

import MobilePlayerDetails from
  "./components/player/MobilePlayerDetails.jsx";

import BrandLogo from "./components/ui/BrandLogo.jsx";

import PasswordRecoveryOverlay, {
  readPasswordRecoveryLinkFromLocation,
  readPasswordResetTokenFromLocation,
} from "./components/auth/PasswordRecoveryOverlay.jsx";

import MobileHeader from "./components/layout/MobileHeader.jsx";

import DesktopSidebar from "./components/layout/DesktopSidebar.jsx";

import DesktopTopbar from "./components/layout/DesktopTopbar.jsx";

import DesktopRightRail from "./components/layout/DesktopRightRail.jsx";

import HomePage from "./components/pages/HomePage.jsx";

import LibraryPage from "./components/pages/LibraryPage.jsx";

import SearchPage from "./components/pages/SearchPage.jsx";

import MessagesPage from "./components/pages/MessagesPage.jsx";

import ProfilePage from "./components/pages/ProfilePage.jsx";

import PublicProfilePage from "./components/pages/PublicProfilePage.jsx";

import SectionHeading from "./components/ui/SectionHeading.jsx";

import AdminUploadsPage from "./components/pages/AdminUploadsPage.jsx";
import AdminBotPage from "./components/pages/AdminBotPage.jsx";
import AdminCatalogPage from "./components/pages/AdminCatalogPage.jsx";
import AdminDashboardPage from "./components/pages/AdminDashboardPage.jsx";

import {
  isOnDemandTrackId,
} from "./onDemandMusic.js";

import {
  cleanupLegacyUnscopedDownloads,
  getActivePlaylistDownloads,
  getDownloadedPlaylists,
  getOfflineOwnerKey,
  getPlaylistDownloadJobId,
  reconcileDownloadedPlaylistMembership,
  recoverInterruptedDownloadJobs,
  removeAllOfflineDownloadsForOwner,
  removePlaylistFromOffline,
  startPlaylistDownloadForOffline,
} from "./offlineDownloads.js";

import {
  getPlaylist,
} from "./playlistApi.js";

import {
  clearCachedLibraryScope,
} from "./libraryCache.js";

import {
  findMissingPlaylistTracks,
  playlistUpdateKey,
} from "./playlistDownloadUpdates.js";

import {
  getMessageNotifications,
  markAdminAccountNotificationRead,
  markAdminNotificationRead,
  markMessageNotificationRead,
} from "./messageApi.js";

import {
  enablePushNotifications,
  syncExistingPushSubscription,
} from "./pushNotifications.js";

import {
  getPwaInstallState,
  requestPwaInstall,
  subscribePwaInstall,
} from "./pwaInstall.js";

import {
  buildAccountPlaybackSyncState,
  connectPlaybackDeviceLive,
  getPlaybackDeviceDescriptor,
  pollPlaybackDevice,
  resolvePlaybackControlTarget,
  sendPlaybackDeviceCommand,
} from "./playbackDevices.js";

import {
  advanceOutgoingHandoffObservation,
  applyPlaybackRemoteCommand,
  shouldApplyPlaybackRemoteCommand,
} from "./playbackRemoteCommands.js";

import {
  MUSIC_SHARE_REQUEST_EVENT,
  normalizeSharedMusicItem,
} from "./musicShare.js";

import {
  sharedMusicSearchQuery,
} from "./sharedMusicNavigation.js";

import {
  notifyListeningHistoryChanged,
} from "./homeRecentlyPlayed.js";

import AppInstallModal from
  "./components/ui/AppInstallModal.jsx";
const ACCOUNT_PLAYBACK_SYNC_INTERVAL_MS =
  750;

const ACCOUNT_PLAYBACK_DEVICE_POLL_MS =
  1000;

const ACCOUNT_PLAYBACK_LIVE_RECONNECT_MS =
  750;

const PLAYBACK_HANDOFF_OVERLAP_MS =
  1000;

const PLAYBACK_HANDOFF_CONFIRMATION_TIMEOUT_MS =
  6000;

const ACCOUNT_PLAYBACK_DEVICE_KEY =
  "hypersync:playback-device-id";


function getAccountPlaybackDeviceId() {
  try {
    const existing =
      globalThis.sessionStorage
        ?.getItem(
          ACCOUNT_PLAYBACK_DEVICE_KEY,
        );

    if (existing) {
      return existing;
    }
  } catch {
    // Storage can be unavailable in strict
    // privacy modes. A transient id is fine.
  }

  const id =
    globalThis.crypto
      ?.randomUUID?.() ??
    (
      "device-" +
      Date.now().toString(36) +
      "-" +
      Math.random()
        .toString(36)
        .slice(
          2,
          12,
        )
    );

  try {
    globalThis.sessionStorage
      ?.setItem(
        ACCOUNT_PLAYBACK_DEVICE_KEY,
        id,
      );
  } catch {
    // Keep the in-memory id.
  }

  return id;
}


function playbackUpdatedAtMs(
  value,
) {
  if (!value) {
    return 0;
  }

  const parsed =
    Date.parse(
      value,
    );

  return Number.isFinite(
    parsed,
  )
    ? parsed
    : 0;
}


function accountPlaybackPosition(
  snapshot,
) {
  const base =
    Math.max(
      Number(
        snapshot
          ?.position_seconds ??
        0,
      ) || 0,
      0,
    );

  if (
    snapshot?.paused
  ) {
    return base;
  }

  const updatedAt =
    playbackUpdatedAtMs(
      snapshot?.updated_at,
    );

  const ageMs =
    updatedAt > 0
      ? Math.max(
          Date.now() -
            updatedAt,
          0,
        )
      : 0;

  /*
   * Device presence is authoritative on the server.
   * Do not freeze the displayed remote clock merely
   * because a mobile browser throttled JavaScript
   * while locked or backgrounded. The server clears
   * playback ownership when that device is truly gone.
   */

  const duration =
    Number(
      snapshot?.track
        ?.duration_seconds,
    );

  const advanced =
    base +
    ageMs / 1000;

  return (
    Number.isFinite(
      duration,
    ) &&
    duration > 0
      ? Math.min(
          advanced,
          duration,
        )
      : advanced
  );
}


// -----------------------------------------------------------------------------
// Pages
// -----------------------------------------------------------------------------
// -----------------------------------------------------------------------------
// Routing
// -----------------------------------------------------------------------------

function MainPage({
  activePage,
  currentUser,
  profileUsername,
  playlistToOpen,
  onOpenPlaylist,
  onPlaylistOpened,
  artistToOpen,
  onArtistOpened,
  onOpenArtist,
  onOpenProfile,
  onMessageUser,
  messageUsername,
  onMessageUsernameHandled,
  sharedMusicToSend,
  onSharedMusicHandled,
  onOpenSharedMusic,
  onMessageNotificationsChanged,
  onProfileUpdated,
  onNavigate,
  onOpenAuth,
  onLogout,
  query,
  onQueryChange,
  compactMode,
  onToggleCompact,
  statusMessage,
  onStatusMessage,
  searchResetToken,
  libraryResetToken,
  messagesResetToken,
  activePlaylistDownloads,
  installState,
  onInstallApp,
  playbackDevices = [],
  currentPlaybackDeviceId,
  controlledPlaybackDeviceId,
  onSelectPlaybackDevice,
  onPlaybackDeviceCommand,
}) {
  const warmOwnerKey =
    [
      String(
        currentUser?.id ??
        "guest",
      ),
      String(
        currentUser?.account_type ??
        "guest",
      ),
      String(
        currentUser?.role ??
        "user",
      ),
    ].join(
      ":",
    );

  const activeWarmKey =
    warmPageKey(
      activePage,
      profileUsername,
    );

  const previousActiveRef =
    useRef({
      key:
        activeWarmKey,
      ownerKey:
        warmOwnerKey,
    });

  const [
    warmPages,
    setWarmPages,
  ] = useState(
    () =>
      touchWarmPage(
        [],
        {
          page:
            activePage,
          profileUsername,
          ownerKey:
            warmOwnerKey,
        },
      ),
  );


  /*
   * Keep visited pages alive for twelve hours.
   *
   * React Activity preserves their UI and
   * component state while hidden, but cleans
   * up Effects so inactive pages do not keep
   * polling or holding subscriptions.
   */
  useLayoutEffect(() => {
    const now =
      Date.now();

    setWarmPages(
      (current) => {
        const previous =
          previousActiveRef.current;

        const stamped =
          current.map(
            (entry) =>
              (
                previous &&
                entry.ownerKey ===
                  previous.ownerKey &&
                entry.key ===
                  previous.key &&
                (
                  previous.key !==
                    activeWarmKey ||
                  previous.ownerKey !==
                    warmOwnerKey
                )
              )
                ? {
                    ...entry,
                    lastVisitedAt:
                      now,
                  }
                : entry,
          );

        return touchWarmPage(
          stamped,
          {
            page:
              activePage,
            profileUsername,
            ownerKey:
              warmOwnerKey,
            now,
          },
        );
      },
    );

    previousActiveRef.current =
      {
        key:
          activeWarmKey,
        ownerKey:
          warmOwnerKey,
      };
  }, [
    activePage,
    activeWarmKey,
    profileUsername,
    warmOwnerKey,
  ]);


  useEffect(() => {
    const intervalId =
      window.setInterval(
        () => {
          setWarmPages(
            (current) =>
              pruneWarmPages(
                current,
                {
                  activeKey:
                    activeWarmKey,
                  ownerKey:
                    warmOwnerKey,
                  now:
                    Date.now(),
                },
              ),
          );
        },
        PAGE_WARM_SWEEP_MS,
      );

    return () => {
      window.clearInterval(
        intervalId,
      );
    };
  }, [
    activeWarmKey,
    warmOwnerKey,
  ]);


  function renderPage(
    page,
    cachedProfileUsername,
  ) {
    const adminPage =
      ADMIN_NAV_ITEMS.some(
        (item) =>
          item.id === page,
      );

    if (adminPage) {
      if (
        !isAdminUser(
          currentUser,
        )
      ) {
        return (
          <div className="page-stack">
            <section className="admin-page__denied">
              <Icon
                name="lock"
                size={28}
              />

              <h2>
                Admin access required
              </h2>

              <p>
                This area is available
                only to HyperSynced
                administrators.
              </p>
            </section>
          </div>
        );
      }

      if (
        page === "admin"
      ) {
        return (
          <AdminDashboardPage
            onNavigate={
              onNavigate
            }
          />
        );
      }

      if (
        page ===
        "admin-bot"
      ) {
        return (
          <AdminBotPage />
        );
      }

      if (
        page ===
        "admin-uploads"
      ) {
        return (
          <AdminUploadsPage />
        );
      }

      if (
        page ===
        "admin-catalog"
      ) {
        return (
          <AdminCatalogPage />
        );
      }
    }


    if (
      page === "search"
    ) {
      return (
        <SearchPage
          currentUser={
            currentUser
          }
          query={
            query
          }
          resetToken={
            searchResetToken
          }
          initialArtistName={
            artistToOpen
          }
          onInitialArtistHandled={
            onArtistOpened
          }
          onQueryChange={
            onQueryChange
          }
          onOpenProfile={
            onOpenProfile
          }
          onMessageUser={
            onMessageUser
          }
          onOpenPlaylist={
            onOpenPlaylist
          }
          onOpenAuth={
            onOpenAuth
          }
          activePlaylistDownloads={
            activePlaylistDownloads
          }
        />
      );
    }


    if (
      page === "messages"
    ) {
      if (
        currentUser?.account_type !==
          "registered"
      ) {
        return (
          <div className="page-stack">
            <section className="admin-page__denied">
              <Icon
                name="mail"
                size={28}
              />

              <h2>
                Sign in to message
              </h2>

              <p>
                Private messages are available
                to registered HyperSynced accounts.
              </p>

              <button
                type="button"
                className="hs-search-primary-action"
                onClick={
                  onOpenAuth
                }
              >
                Sign in
              </button>
            </section>
          </div>
        );
      }

      return (
        <MessagesPage
          currentUser={
            currentUser
          }
          initialUsername={
            messageUsername
          }
          onInitialUsernameHandled={
            onMessageUsernameHandled
          }
          sharedMusicToSend={
            sharedMusicToSend
          }
          onSharedMusicHandled={
            onSharedMusicHandled
          }
          onOpenSharedMusic={
            onOpenSharedMusic
          }
          onUnreadChange={
            onMessageNotificationsChanged
          }
          onOpenProfile={
            onOpenProfile
          }
          onBackToSearch={() => {
            onNavigate(
              "search",
            );
          }}
          resetToken={
            messagesResetToken
          }
        />
      );
    }


    if (
      page === "library"
    ) {
      return (
        <LibraryPage
          currentUser={
            currentUser
          }
          resetToken={
            libraryResetToken
          }
          onOpenAuth={
            onOpenAuth
          }
          initialPlaylistId={
            playlistToOpen
          }
          onInitialPlaylistHandled={
            onPlaylistOpened
          }
          activePlaylistDownloads={
            activePlaylistDownloads
          }
        />
      );
    }


    if (
      page === "profile"
    ) {
      return (
        <ProfilePage
          currentUser={
            currentUser
          }
          onOpenAuth={
            onOpenAuth
          }
          onLogout={
            onLogout
          }
          compactMode={
            compactMode
          }
          onToggleCompact={
            onToggleCompact
          }
          statusMessage={
            statusMessage
          }
          onStatusMessage={
            onStatusMessage
          }
          onOpenProfile={
            onOpenProfile
          }
          onSearchArtist={
            onOpenArtist
          }
          onProfileUpdated={
            onProfileUpdated
          }
          installState={
            installState
          }
          onInstallApp={
            onInstallApp
          }
          playbackDevices={
            playbackDevices
          }
          currentPlaybackDeviceId={
            currentPlaybackDeviceId
          }
          controlledPlaybackDeviceId={
            controlledPlaybackDeviceId
          }
          onSelectPlaybackDevice={
            onSelectPlaybackDevice
          }
          onPlaybackDeviceCommand={
            onPlaybackDeviceCommand
          }
        />
      );
    }


    if (
      page ===
        "public-profile" &&
      cachedProfileUsername
    ) {
      return (
        <PublicProfilePage
          username={
            cachedProfileUsername
          }
          currentUser={
            currentUser
          }
          onOpenAuth={
            onOpenAuth
          }
          onOpenProfile={
            onOpenProfile
          }
          onSearchArtist={
            onOpenArtist
          }
        />
      );
    }


    return (
      <HomePage
        currentUser={
          currentUser
        }
        onNavigate={
          onNavigate
        }
        onOpenAuth={
          onOpenAuth
        }
      />
    );
  }


  return (
    <>
      {warmPages
        .filter(
          (entry) =>
            entry.ownerKey ===
            warmOwnerKey,
        )
        .map(
          (entry) => (
            <Activity
              key={
                entry.instanceKey
              }
              mode={
                entry.key ===
                activeWarmKey
                  ? "visible"
                  : "hidden"
              }
            >
              {renderPage(
                entry.page,
                entry.profileUsername,
              )}
            </Activity>
          ),
        )}
    </>
  );
}

function MobileBottomNav({
  activePage,
  onNavigate,
  currentUser,
}) {
  const mobileActivePage =
    activePage === "messages"
      ? "search"
      : activePage;

  return (
    <nav
      className="mobile-bottom-nav"
      aria-label="Mobile navigation"
    >
      {NAV_ITEMS
        .filter(
          (item) =>
            item.id !== "messages" &&
            (
              !item.requiresAuth ||
              currentUser?.account_type ===
                "registered"
            ),
        )
        .map((item) => (
        <button
          className={
            mobileActivePage === item.id
              ? "is-active"
              : ""
          }
          type="button"
          key={item.id}
          onClick={() => {
            onNavigate(item.id);
          }}
          aria-current={
            mobileActivePage === item.id
              ? "page"
              : undefined
          }
        >
          <Icon
            name={item.icon}
            size={20}
          />

          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

function PlayerBar({
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
  playbackDevices = [],
  currentPlaybackDeviceId,
  controlledPlaybackDeviceId,
  accountPlaybackSnapshot,
  onSelectPlaybackDevice,
  onPlaybackDeviceCommand,
  onOpenPlayerDetails,
}) {
  const trackActionMenu =
    useTrackActionMenu();

  const [
    notificationsOpen,
    setNotificationsOpen,
  ] = useState(false);

  const [
    devicesOpen,
    setDevicesOpen,
  ] = useState(false);

  const [
    remoteClock,
    setRemoteClock,
  ] = useState(
    Date.now(),
  );

  const [
    remoteSeekPreview,
    setRemoteSeekPreview,
  ] = useState(null);

  const remoteSeekTimerRef =
    useRef(null);

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


  const controlledDevice =
    playbackDevices.find(
      (device) =>
        device.device_id ===
        controlledPlaybackDeviceId,
    ) ??
    null;

  const controllingRemote =
    Boolean(
      currentUser?.account_type ===
        "registered" &&
      controlledPlaybackDeviceId &&
      controlledPlaybackDeviceId !==
        currentPlaybackDeviceId &&
      controlledDevice?.is_online,
    );

  useEffect(() => {
    if (
      !controllingRemote ||
      accountPlaybackSnapshot
        ?.paused ||
      !accountPlaybackSnapshot
        ?.track?.id
    ) {
      return undefined;
    }

    const intervalId =
      window.setInterval(
        () => {
          setRemoteClock(
            Date.now(),
          );
        },
        100,
      );

    return () => {
      window.clearInterval(
        intervalId,
      );
    };
  }, [
    controllingRemote,
    accountPlaybackSnapshot
      ?.paused,
    accountPlaybackSnapshot
      ?.track?.id,
    accountPlaybackSnapshot
      ?.updated_at,
  ]);


  useEffect(() => {
    return () => {
      if (
        remoteSeekTimerRef
          .current
      ) {
        window.clearTimeout(
          remoteSeekTimerRef
            .current,
        );
      }
    };
  }, []);


  useEffect(() => {
    setRemoteSeekPreview(
      null,
    );
  }, [
    controlledPlaybackDeviceId,
    accountPlaybackSnapshot
      ?.updated_at,
  ]);


  const remotePosition =
    useMemo(
      () => {
        if (
          !controllingRemote
        ) {
          return 0;
        }

        /*
         * remoteClock intentionally causes
         * this memo to advance while the
         * selected remote device is playing.
         */
        void remoteClock;

        return accountPlaybackPosition(
          accountPlaybackSnapshot,
        );
      },
      [
        accountPlaybackSnapshot,
        controllingRemote,
        remoteClock,
      ],
    );


  const toggle =
    useCallback(
      async () => {
        try {
          if (
            controllingRemote
          ) {
            await onPlaybackDeviceCommand?.(
              controlledPlaybackDeviceId,
              accountPlaybackSnapshot
                ?.paused
                ? "play"
                : "pause",
            );

            return;
          }

          await player.togglePlay();
        } catch {
          // Browser autoplay restrictions
          // can prevent playback.
        }
      },
      [
        accountPlaybackSnapshot
          ?.paused,
        controlledPlaybackDeviceId,
        controllingRemote,
        onPlaybackDeviceCommand,
      ],
    );


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

  const remoteTrack =
    controllingRemote
      ? accountPlaybackSnapshot
          ?.track ??
        null
      : null;

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
    remoteTrack?.id ??
    state.trackId ??
    null;

  const displayTitle =
    remoteTrack?.title ??
    state.title ??
    currentQueueTrack?.meta
      ?.title ??
    "";

  const displayArtist =
    remoteTrack?.artist ??
    state.artist ??
    currentQueueTrack?.meta
      ?.artist ??
    "";

  const displayAlbum =
    remoteTrack?.album ??
    state.album ??
    currentQueueTrack?.meta
      ?.album ??
    "";

  const displayArtworkUrl =
    remoteTrack?.artwork_url ??
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

  const subtitleText =
    displayArtist
      ? [
          displayArtist,
          displayAlbum,
        ]
          .filter(Boolean)
          .join(" • ")
      : displayTrackId
        ? (
            controllingRemote &&
            controlledDevice?.name
              ? (
                  "Playing on " +
                  controlledDevice.name
                )
              : "Now playing"
          )
        : "Select a track to start listening";

  const effectivePaused =
    controllingRemote
      ? Boolean(
          accountPlaybackSnapshot
            ?.paused ??
          true,
        )
      : Boolean(
          state.paused,
        );

  const canControl =
    controllingRemote
      ? Boolean(
          controlledDevice
            ?.is_online &&
          accountPlaybackSnapshot
            ?.track?.id,
        )
      : Boolean(
          state.src,
        );

  const effectiveDuration =
    controllingRemote
      ? Math.max(
          Number(
            remoteTrack
              ?.duration_seconds ??
            0,
          ) || 0,
          0,
        )
      : (
          state.duration >
            0
            ? state.duration
            : 0
        );

  const progressMax =
    effectiveDuration > 0
      ? effectiveDuration
      : 1;

  const effectiveCurrentTime =
    controllingRemote
      ? (
          remoteSeekPreview ??
          remotePosition
        )
      : (
          state.currentTime ||
          0
        );

  const progressValue =
    Math.min(
      Math.max(
        effectiveCurrentTime,
        0,
      ),
      progressMax,
    );

  const handlePrevious =
    () => {
      if (
        controllingRemote
      ) {
        void onPlaybackDeviceCommand?.(
          controlledPlaybackDeviceId,
          "previous",
        );

        return;
      }

      player.seekTo(
        0,
      );
    };

  const handleNext =
    () => {
      if (
        controllingRemote
      ) {
        void onPlaybackDeviceCommand?.(
          controlledPlaybackDeviceId,
          "next",
        );

        return;
      }

      void player.skipToNext();
    };

  const handleSeek =
    (value) => {
      if (
        !controllingRemote
      ) {
        player.seekTo(
          value,
        );

        return;
      }

      setRemoteSeekPreview(
        value,
      );

      if (
        remoteSeekTimerRef
          .current
      ) {
        window.clearTimeout(
          remoteSeekTimerRef
            .current,
        );
      }

      remoteSeekTimerRef.current =
        window.setTimeout(
          () => {
            remoteSeekTimerRef.current =
              null;

            void onPlaybackDeviceCommand?.(
              controlledPlaybackDeviceId,
              "seek",
              value,
            );
          },
          40,
        );
    };

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
            remoteTrack?.audio_url ??
            currentQueueTrack?.meta
              ?.audioUrl ??
            null,
          artwork_url:
            displayArtworkUrl,
          mime_type:
            remoteTrack?.mime_type ??
            state.mimeType ??
            currentQueueTrack?.meta
              ?.mimeType ??
            null,
          file_size:
            remoteTrack?.file_size ??
            state.fileSize ??
            currentQueueTrack?.meta
              ?.fileSize ??
            null,
          media_version:
            remoteTrack?.media_version ??
            state.mediaVersion ??
            currentQueueTrack?.meta
              ?.mediaVersion ??
            null,
          artwork_version:
            remoteTrack?.artwork_version ??
            state.artworkVersion ??
            currentQueueTrack?.meta
              ?.artworkVersion ??
            null,
          duration_seconds:
            remoteTrack?.duration_seconds ??
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
        {currentUser?.account_type ===
        "registered" ? (
          <div className="desktop-player-device-center">
            <button
              type="button"
              className={[
                "icon-button",
                "desktop-player-device-button",
                controllingRemote
                  ? "is-remote"
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-label="Choose playback device"
              aria-expanded={
                devicesOpen
              }
              title={
                controlledDevice?.name
                  ? (
                      "Controlling " +
                      controlledDevice.name
                    )
                  : "Choose playback device"
              }
              onClick={() => {
                setDevicesOpen(
                  (open) =>
                    !open,
                );

                setNotificationsOpen(
                  false,
                );
              }}
            >
              <Icon
                name="devices"
                size={18}
              />

              {playbackDevices.filter(
                (device) =>
                  device.is_online,
              ).length > 1 ? (
                <span
                  className="icon-button__dot"
                  aria-hidden="true"
                />
              ) : null}
            </button>
          </div>
        ) : null}

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

              setDevicesOpen(
                false,
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

      {devicesOpen &&
      currentUser?.account_type ===
        "registered" ? (
        <div className="playback-devices-popover">
          <PlaybackDevicesPanel
            devices={
              playbackDevices
            }
            currentDeviceId={
              currentPlaybackDeviceId
            }
            controlledDeviceId={
              controlledPlaybackDeviceId
            }
            onSelectDevice={(
              deviceId,
            ) => {
              onSelectPlaybackDevice?.(
                deviceId,
              );
            }}
            onTransferToDevice={(
              deviceId,
            ) => {
              void onPlaybackDeviceCommand?.(
                deviceId,
                "transfer",
              );
            }}
          />
        </div>
      ) : null}


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

function AuthOverlay({
  open,
  mode,
  onModeChange,
  onClose,
  onGuest,
  onAuthenticated,
  onForgotPassword,
}) {
  const [showPassword, setShowPassword] =
    useState(false);

  const [
    createAdmin,
    setCreateAdmin,
  ] = useState(false);

  const [
    showAdminPassword,
    setShowAdminPassword,
  ] = useState(false);

  const [rememberMe, setRememberMe] =
    useState(true);

  const [message, setMessage] =
    useState("");


  useEffect(() => {
    if (
      !open ||
      mode !== "create"
    ) {
      setCreateAdmin(false);
      setShowAdminPassword(false);
    }
  }, [
    open,
    mode,
  ]);


  if (!open) {
    return null;
  }

  const isCreate = mode === "create";

  async function submit(event) {
  event.preventDefault();

  setMessage("");

  const form =
    new FormData(event.currentTarget);

  const username =
    String(
      form.get("username") ?? "",
    ).trim();

  const password =
    String(
      form.get("password") ?? "",
    );

  const adminVerificationPassword =
    String(
      form.get(
        "admin_verification_password",
      ) ?? "",
    );

  if (
    isCreate &&
    createAdmin &&
    !adminVerificationPassword
  ) {
    setMessage(
      "Enter the administrator verification password.",
    );

    return;
  }

  try {
    const data = await apiRequest(
      isCreate
        ? "/auth/register"
        : "/auth/login",
      {
        method: "POST",
        body: JSON.stringify(
          isCreate
            ? {
                username,
                email: String(
                  form.get("email") ?? "",
                ).trim(),
                password,
                create_admin:
                  createAdmin,
                admin_verification_password:
                  createAdmin
                    ? adminVerificationPassword
                    : null,
              }
            : {
                username,
                password,
              },
        ),
      },
    );

    saveAuthSession(
      data.access_token,
      { remember: rememberMe },
    );

    cacheUserProfile(
      data.user,
      { remember: rememberMe },
    );

    onAuthenticated(data.user);

    onClose();

    setCreateAdmin(false);
    setShowAdminPassword(false);
    setMessage("");
  } catch (error) {
    setMessage(
      error instanceof Error
        ? error.message
        : "Authentication failed.",
    );
  }
}

  return (
    <div
      className="auth-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-title"
    >
      <HexBackdrop idPrefix="main-app-background" />

      <div className="auth-panel bevel-panel">
        <button
          className="auth-close"
          type="button"
          onClick={onClose}
          aria-label="Close account screen"
        >
          <Icon
            name="close"
            size={20}
          />
        </button>

        <BrandLogo idPrefix="auth-logo" />

        <div className="auth-heading">
          <h2 id="auth-title">
            {isCreate
              ? "Create your HyperSynced account"
              : "Welcome to HyperSynced"}
          </h2>

          <p>
            {isCreate
              ? (
                "Create a HyperSynced account to save " +
                "your library and sync across devices."
              )
              : (
                "Sync your world. Stream your sound. " +
                "Feel the music."
              )}
          </p>
        </div>

        <form
          className="auth-form"
          onSubmit={submit}
        >
          <label>
            <Icon
              name="mail"
              size={22}
            />

            <input
              type="text"
              name="username"
              autoComplete="username"
              placeholder="Username or email"
              required
            />
          </label>

          {isCreate ? (
            <label>
              <Icon
                name="mail"
                size={22}
              />

              <input
                type="email"
                name="email"
                autoComplete="email"
                placeholder="Email address"
                required
              />
            </label>
          ) : null}

          <label>
            <Icon
              name="lock"
              size={22}
            />

            <input
              type={
                showPassword
                  ? "text"
                  : "password"
              }
              name="password"
              autoComplete={
                isCreate
                  ? "new-password"
                  : "current-password"
              }
              placeholder="Password"
              required
            />

            <button
              type="button"
              onClick={() => {
                setShowPassword(
                  (value) => !value,
                );
              }}
              aria-label={
                showPassword
                  ? "Hide password"
                  : "Show password"
              }
            >
              <Icon
                name={
                  showPassword
                    ? "eyeOff"
                    : "eye"
                }
                size={22}
              />
            </button>
          </label>

          {isCreate ? (
            <div className="auth-admin-create">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={createAdmin}
                  onChange={(event) => {
                    const checked =
                      event.target.checked;

                    setCreateAdmin(
                      checked,
                    );

                    if (!checked) {
                      setShowAdminPassword(
                        false,
                      );
                    }

                    setMessage("");
                  }}
                />

                <span>
                  <Icon
                    name="check"
                    size={15}
                  />
                </span>

                Create administrator account
              </label>

              {createAdmin ? (
                <label className="auth-admin-password">
                  <Icon
                    name="shield"
                    size={22}
                  />

                  <input
                    type={
                      showAdminPassword
                        ? "text"
                        : "password"
                    }
                    name="admin_verification_password"
                    autoComplete="off"
                    placeholder="Administrator verification password"
                    required
                  />

                  <button
                    type="button"
                    onClick={() => {
                      setShowAdminPassword(
                        (value) =>
                          !value,
                      );
                    }}
                    aria-label={
                      showAdminPassword
                        ? "Hide administrator password"
                        : "Show administrator password"
                    }
                  >
                    <Icon
                      name={
                        showAdminPassword
                          ? "eyeOff"
                          : "eye"
                      }
                      size={22}
                    />
                  </button>
                </label>
              ) : null}

              <small>
                Administrator accounts require a server-side verification password.
              </small>
            </div>
          ) : null}

          {!isCreate ? (
            <div className="auth-options">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(event) => {
                    setRememberMe(
                      event.target.checked,
                    );
                  }}
                />

                <span>
                  <Icon
                    name="check"
                    size={15}
                  />
                </span>

                Remember me
              </label>

              <button
                type="button"
                onClick={() => {
                  setMessage("");
                  onForgotPassword?.();
                }}
              >
                Forgot password?
              </button>
            </div>
          ) : null}

          <button
            className="auth-submit"
            type="submit"
          >
            {isCreate
              ? "CREATE ACCOUNT"
              : "SIGN IN"}
          </button>
        </form>

        <div className="auth-divider">
          <span>OR</span>
        </div>

        <button
          className="auth-secondary"
          type="button"
          onClick={() => {
            onModeChange(
              isCreate
                ? "signin"
                : "create",
            );
          }}
        >
          {isCreate
            ? "BACK TO SIGN IN"
            : "CREATE ACCOUNT"}
        </button>

        <button
          className="auth-guest"
          type="button"
          onClick={onGuest}
        >
          or use without account
        </button>

        {message ? (
          <p
            className="auth-message"
            role="status"
          >
            {message}
          </p>
        ) : null}

        <p className="auth-legal">
          Terms of Service and Privacy Policy
          pages will be linked before launch.
        </p>
      </div>
    </div>
  );
}

// ======================================================================================
// App shell
// ======================================================================================

function shouldKeepTextFocus(
  target,
) {
  if (
    !(target instanceof Element)
  ) {
    return false;
  }

  return Boolean(
    target.closest(
      [
        "textarea",
        "select",
        "[contenteditable='true']",
        "[role='textbox']",
        "input:not([type='button']):not([type='submit']):not([type='reset']):not([type='checkbox']):not([type='radio']):not([type='range']):not([type='file'])",
      ].join(", "),
    ),
  );
}


function shouldIgnorePlaybackShortcut(
  target,
) {
  if (
    !(target instanceof Element)
  ) {
    return false;
  }

  return Boolean(
    target.closest(
      [
        "input",
        "textarea",
        "select",
        "button",
        "a[href]",
        "[contenteditable='true']",
        "[role='button']",
        "[role='textbox']",
        "[role='slider']",
        "[role='menuitem']",
      ].join(", "),
    ),
  );
}


export default function App() {
  const [currentUser, setCurrentUser] =
    useState(null);

  const [activePage, setActivePage] =
    useState("home");

    const [
    activeProfileUsername,
    setActiveProfileUsername,
  ] = useState("");

  const [searchQuery, setSearchQuery] =
    useState("");

  const [
  searchResetToken,
  setSearchResetToken,
] = useState(0);

  const [
  libraryResetToken,
  setLibraryResetToken,
] = useState(0);

  const [
  messagesResetToken,
  setMessagesResetToken,
] = useState(0);

  const [
  playlistToOpen,
  setPlaylistToOpen,
  ] = useState(null);

  const [
    artistToOpen,
    setArtistToOpen,
  ] = useState("");

  const [
    messageToOpen,
    setMessageToOpen,
  ] = useState("");

  const [
    sharedMusicToSend,
    setSharedMusicToSend,
  ] = useState(null);

  const [
    messageNotifications,
    setMessageNotifications,
  ] = useState({
    unread_count:
      0,
    notifications:
      [],
  });

  const [
    notificationDetail,
    setNotificationDetail,
  ] = useState(null);

  const [
    pushBusy,
    setPushBusy,
  ] = useState(false);

  const [
    pushEnabled,
    setPushEnabled,
  ] = useState(false);

  const [
    installState,
    setInstallState,
  ] = useState(
    () => getPwaInstallState(),
  );

  const [
    installHelpMode,
    setInstallHelpMode,
  ] = useState("");

  const [
    recoveryOpen,
    setRecoveryOpen,
  ] = useState(
    () => {
      const recoveryLink =
        readPasswordRecoveryLinkFromLocation();

      return Boolean(
        readPasswordResetTokenFromLocation() ||
        (
          recoveryLink.identifier &&
          recoveryLink.code
        ),
      );
    },
  );

  const [
    mobilePlayerDetailsOpen,
    setMobilePlayerDetailsOpen,
  ] = useState(false);

  const [authOpen, setAuthOpen] =
    useState(
      () => {
        const recoveryLink =
          readPasswordRecoveryLinkFromLocation();

        return (
          !readPasswordResetTokenFromLocation() &&
          !(
            recoveryLink.identifier &&
            recoveryLink.code
          ) &&
          !shouldRestoreSession() &&
          !readCachedUserProfile()
        );
      },
    );

  const [authMode, setAuthMode] =
    useState("signin");

  const [compactMode, setCompactMode] =
    useState(false);

  const [statusMessage, setStatusMessage] =
    useState("");

  const [
    mobileSeekFeedback,
    setMobileSeekFeedback,
  ] = useState(null);

  const mobileSeekFeedbackTimerRef =
    useRef(null);

  const mobileTapRef =
    useRef({
      time:
        0,
      side:
        "",
      x:
        0,
      y:
        0,
    });

  const mobilePointerStartRef =
    useRef(null);

  const [
    playlistUpdates,
    setPlaylistUpdates,
  ] = useState([]);

  const [
    activePlaylistDownloads,
    setActivePlaylistDownloads,
  ] = useState([]);

  const [
    playbackDevices,
    setPlaybackDevices,
  ] = useState([]);

  const [
    accountPlaybackSnapshot,
    setAccountPlaybackSnapshot,
  ] = useState(null);

  const [
    controlledPlaybackDeviceId,
    setControlledPlaybackDeviceId,
  ] = useState(null);

  const playbackDevicesRef =
    useRef([]);

  const accountPlaybackSnapshotRef =
    useRef(null);

  const controlledPlaybackDeviceIdRef =
    useRef(null);

  const playbackLiveConnectionRef =
    useRef(null);

  const playbackSeenCommandIdsRef =
    useRef(
      new Set(),
    );

  const selectControlledPlaybackDevice =
    useCallback(
      (
        deviceId,
      ) => {
        const normalized =
          String(
            deviceId ??
              "",
          ).trim() ||
          null;

        controlledPlaybackDeviceIdRef.current =
          normalized;

        setControlledPlaybackDeviceId(
          normalized,
        );
      },
      [],
    );


  const playbackDeviceIdRef =
    useRef(
      getAccountPlaybackDeviceId(),
    );

  const playbackDeviceDescriptorRef =
    useRef(
      getPlaybackDeviceDescriptor(),
    );

  const playbackApplyingRemoteRef =
    useRef(false);

  const playbackLastServerUpdateRef =
    useRef(0);

  const playbackLastPublishedRef =
    useRef({
      trackId:
        null,
      paused:
        true,
      position:
        0,
      at:
        0,
      queueSignature:
        "",
    });

  const playbackWriteInFlightRef =
    useRef(false);

  const playbackPendingWriteRef =
    useRef(null);

  const playbackHandoffSilenceTimerRef =
    useRef(null);

  const playbackOutgoingHandoffObservationRef =
    useRef(null);


  const cancelPlaybackHandoffSilence =
    useCallback(
      () => {
        if (
          playbackHandoffSilenceTimerRef
            .current !== null
        ) {
          globalThis.clearTimeout(
            playbackHandoffSilenceTimerRef
              .current,
          );

          playbackHandoffSilenceTimerRef
            .current =
              null;
        }
      },
      [],
    );


  const schedulePlaybackHandoffSilence =
    useCallback(
      (
        delayMs =
          PLAYBACK_HANDOFF_OVERLAP_MS,
      ) => {
        if (
          playbackHandoffSilenceTimerRef
            .current !== null
        ) {
          return;
        }

        const safeDelayMs =
          Math.max(
            Number(
              delayMs,
            ) || 0,
            0,
          );

        playbackHandoffSilenceTimerRef.current =
          globalThis.setTimeout(
            () => {
              playbackHandoffSilenceTimerRef
                .current =
                  null;

              playbackOutgoingHandoffObservationRef
                .current =
                  null;

              const activeDeviceId =
                String(
                  accountPlaybackSnapshotRef
                    .current
                    ?.device_id ??
                    "",
                ).trim();

              const currentDeviceId =
                String(
                  playbackDeviceIdRef
                    .current ??
                    "",
                ).trim();

              if (
                activeDeviceId &&
                currentDeviceId &&
                activeDeviceId !==
                  currentDeviceId
              ) {
                player.silenceLocalPlayback();
              }
            },
            safeDelayMs,
          );
      },
      [],
    );


  useEffect(() => {
    return () => {
      playbackOutgoingHandoffObservationRef
        .current =
          null;

      cancelPlaybackHandoffSilence();
    };
  }, [
    cancelPlaybackHandoffSilence,
  ]);


  const resolveCurrentPlaybackControlTarget =
    useCallback(
      () =>
        resolvePlaybackControlTarget({
          devices:
            playbackDevicesRef.current,
          currentDeviceId:
            playbackDeviceIdRef.current,
          activeDeviceId:
            accountPlaybackSnapshotRef
              .current
              ?.device_id ??
            null,
          controlledDeviceId:
            controlledPlaybackDeviceIdRef
              .current,
        }),
      [],
    );


  const sendAccountPlaybackCommand =
    useCallback(
      async (
        targetDeviceId,
        action,
        value = null,
        options = {},
      ) => {
        if (
          currentUser?.account_type !==
            "registered"
        ) {
          return false;
        }

        const targetId =
          String(
            targetDeviceId ??
            "",
          ).trim();

        if (!targetId) {
          return false;
        }

        const currentDeviceId =
          playbackDeviceIdRef.current;

        const snapshot =
          accountPlaybackSnapshotRef
            .current;

        const localState =
          player.getState();

        const transferFromLocalOwner =
          action ===
            "transfer" &&
          snapshot?.device_id ===
            currentDeviceId;

        const transferPosition =
          action ===
            "transfer"
            ? (
                transferFromLocalOwner
                  ? Math.max(
                      Number(
                        localState?.currentTime ??
                          0,
                      ) || 0,
                      0,
                    )
                  : accountPlaybackPosition(
                      snapshot,
                    )
              )
            : null;

        const transferPaused =
          action ===
            "transfer"
            ? (
                transferFromLocalOwner
                  ? Boolean(
                      localState?.paused,
                    )
                  : Boolean(
                      snapshot?.paused ??
                        true,
                    )
              )
            : null;

        const transferQueue =
          action ===
            "transfer"
            ? (
                transferFromLocalOwner
                  ? (
                      Array.isArray(
                        localState?.queue,
                      )
                        ? localState.queue
                        : []
                    )
                  : (
                      Array.isArray(
                        snapshot?.queue,
                      )
                        ? snapshot.queue
                        : []
                    )
              )
            : [];

        const transferQueueIndex =
          action ===
            "transfer"
            ? (
                transferFromLocalOwner
                  ? localState?.queueIndex
                  : snapshot?.queue_index
              )
            : null;

        const transferTrackId =
          action ===
            "transfer"
            ? (
                String(
                  (
                    transferFromLocalOwner
                      ? localState?.trackId
                      : snapshot?.track?.id
                  ) ??
                    "",
                ).trim()
                || null
              )
            : null;

        const transferQueueEntry =
          transferFromLocalOwner &&
          transferTrackId &&
          Array.isArray(
            transferQueue,
          )
            ? (
                transferQueue.find(
                  (entry) =>
                    String(
                      entry?.id ??
                        "",
                    ) ===
                    transferTrackId,
                ) ??
                null
              )
            : null;

        const transferTrackMeta =
          transferQueueEntry?.meta ??
          {};

        const transferTrackSnapshot =
          transferTrackId
            ? (
                transferFromLocalOwner
                  ? {
                      id:
                        transferTrackId,
                      title:
                        transferTrackMeta.title ??
                        localState?.title ??
                        "",
                      artist:
                        transferTrackMeta.artist ??
                        localState?.artist ??
                        "",
                      album:
                        transferTrackMeta.album ??
                        localState?.album ??
                        null,
                      duration_seconds:
                        transferTrackMeta.durationSeconds ??
                        localState?.durationSeconds ??
                        null,
                      audio_url:
                        transferTrackMeta.audioUrl ??
                        null,
                      artwork_url:
                        transferTrackMeta.artworkUrl ??
                        localState?.artworkUrl ??
                        null,
                      mime_type:
                        transferTrackMeta.mimeType ??
                        localState?.mimeType ??
                        null,
                      file_size:
                        transferTrackMeta.fileSize ??
                        localState?.fileSize ??
                        null,
                      media_version:
                        transferTrackMeta.mediaVersion ??
                        localState?.mediaVersion ??
                        null,
                      artwork_version:
                        transferTrackMeta.artworkVersion ??
                        localState?.artworkVersion ??
                        null,
                    }
                  : snapshot?.track
              )
            : null;

        const transferSnapshotQueue =
          transferFromLocalOwner &&
          Array.isArray(
            transferQueue,
          )
            ? transferQueue.map(
                (entry) => ({
                  id:
                    String(
                      entry?.id ??
                        "",
                    ),
                  ...(
                    entry?.meta ??
                    {}
                  ),
                }),
              )
            : (
                Array.isArray(
                  snapshot?.queue,
                )
                  ? snapshot.queue
                  : []
              );

        /*
         * Keep the outgoing player audible until
         * the transfer is accepted. The account
         * ownership update schedules a short
         * overlap instead of creating a gap.
         */
        try {
          if (
            targetId ===
              currentDeviceId &&
            action !==
              "transfer" &&
            action !==
              "play_track"
          ) {
            const result =
              await applyPlaybackRemoteCommand(
                {
                  action,
                  value,
                },
                {
                  player,
                  snapshot,
                  snapshotPosition:
                    accountPlaybackPosition,
                },
              );

            if (result) {
              controlledPlaybackDeviceIdRef
                .current =
                  currentDeviceId;

              setControlledPlaybackDeviceId(
                currentDeviceId,
              );
            }

            return Boolean(
              result,
            );
          }

          /*
           * Update the controller immediately.
           * The realtime command follows in the
           * same tick, while the authoritative
           * server/target state catches up.
           */
          controlledPlaybackDeviceIdRef
            .current =
              targetId;

          setControlledPlaybackDeviceId(
            targetId,
          );

          let optimisticSnapshot =
            snapshot;

          if (snapshot) {
            const nowIso =
              new Date()
                .toISOString();

            const position =
              accountPlaybackPosition(
                snapshot,
              );

            if (
              action ===
                "play"
            ) {
              optimisticSnapshot = {
                ...snapshot,
                paused:
                  false,
                position_seconds:
                  position,
                device_id:
                  targetId,
                updated_at:
                  nowIso,
              };
            } else if (
              action ===
                "pause"
            ) {
              optimisticSnapshot = {
                ...snapshot,
                paused:
                  true,
                position_seconds:
                  position,
                device_id:
                  targetId,
                updated_at:
                  nowIso,
              };
            } else if (
              action ===
                "seek" &&
              Number.isFinite(
                Number(
                  value,
                ),
              )
            ) {
              optimisticSnapshot = {
                ...snapshot,
                position_seconds:
                  Math.max(
                    Number(
                      value,
                    ),
                    0,
                  ),
                device_id:
                  targetId,
                updated_at:
                  nowIso,
              };
            } else if (
              action ===
                "transfer"
            ) {
              optimisticSnapshot = {
                ...snapshot,
                track:
                  transferTrackSnapshot ??
                  snapshot.track,
                queue:
                  transferSnapshotQueue,
                queue_index:
                  Number.isInteger(
                    transferQueueIndex,
                  )
                    ? transferQueueIndex
                    : snapshot.queue_index,
                position_seconds:
                  transferPosition ??
                  position,
                paused:
                  transferPaused ??
                  snapshot.paused,
                device_id:
                  targetId,
                updated_at:
                  nowIso,
              };
            } else if (
              action ===
                "play_track" &&
              options?.trackId
            ) {
              const meta =
                options?.trackMeta ??
                {};

              optimisticSnapshot = {
                ...snapshot,
                track: {
                  id:
                    String(
                      options.trackId,
                    ),
                  title:
                    meta.title ??
                    "",
                  artist:
                    meta.artist ??
                    "",
                  album:
                    meta.album ??
                    null,
                  duration_seconds:
                    meta.durationSeconds ??
                    meta.duration_seconds ??
                    null,
                  audio_url:
                    meta.audioUrl ??
                    meta.audio_url ??
                    null,
                  artwork_url:
                    meta.artworkUrl ??
                    meta.artwork_url ??
                    null,
                  mime_type:
                    meta.mimeType ??
                    meta.mime_type ??
                    null,
                  file_size:
                    meta.fileSize ??
                    meta.file_size ??
                    null,
                  media_version:
                    meta.mediaVersion ??
                    meta.media_version ??
                    null,
                  artwork_version:
                    meta.artworkVersion ??
                    meta.artwork_version ??
                    null,
                },
                paused:
                  false,
                position_seconds:
                  0,
                device_id:
                  targetId,
                updated_at:
                  nowIso,
              };
            }
          }

          if (
            optimisticSnapshot !==
              snapshot
          ) {
            accountPlaybackSnapshotRef
              .current =
                optimisticSnapshot;

            setAccountPlaybackSnapshot(
              optimisticSnapshot,
            );
          }

          const queueEntries =
            action ===
              "transfer"
              ? transferQueue.slice(
                  0,
                  500,
                )
              : (
                  Array.isArray(
                    options?.queue,
                  )
                    ? options.queue.slice(
                        0,
                        500,
                      )
                    : []
                );

          const queueTrackIds =
            queueEntries
              .map(
                (entry) =>
                  String(
                    entry?.id ??
                      "",
                  ).trim(),
              )
              .filter(
                Boolean,
              );

          const requestedQueueIndex =
            action ===
              "transfer"
              ? transferQueueIndex
              : options?.queueIndex;

          const queueIndex =
            Number.isInteger(
              requestedQueueIndex,
            )
              ? Math.min(
                  Math.max(
                    requestedQueueIndex,
                    0,
                  ),
                  Math.max(
                    queueTrackIds.length -
                      1,
                    0,
                  ),
                )
              : null;

          const liveConnection =
            playbackLiveConnectionRef
              .current;

          const realtimeRequest =
            liveConnection?.sendCommand?.({
              targetDeviceId:
                targetId,
              action,
              value,
              trackId:
                action ===
                  "transfer"
                  ? transferTrackId
                  : (
                      options?.trackId ??
                      null
                    ),
              queueTrackIds,
              queueIndex,
              positionSeconds:
                transferPosition,
              paused:
                transferPaused,
            }) ??
            null;

          let usedRealtime =
            Boolean(
              realtimeRequest,
            );

          let response =
            null;

          if (realtimeRequest) {
            const ack =
              await realtimeRequest;

            response =
              ack?.command ??
              null;
          } else {
            response =
              await sendPlaybackDeviceCommand({
                targetDeviceId:
                  targetId,
                sourceDeviceId:
                  currentDeviceId,
                action,
                value,
                trackId:
                  action ===
                    "transfer"
                    ? transferTrackId
                    : (
                        options?.trackId ??
                        null
                      ),
                queueTrackIds,
                queueIndex,
                positionSeconds:
                  transferPosition,
                paused:
                  transferPaused,
              });

            usedRealtime =
              false;
          }

          /*
           * If the realtime channel is down
           * and control is transferred back
           * to this browser, apply the handoff
           * locally after the HTTP fallback.
           *
           * Outgoing audio is not silenced from
           * this request ACK. The old device waits
           * for the target to publish playback after
           * its audio.play() has actually succeeded.
           */
          if (
            !usedRealtime &&
            targetId ===
              currentDeviceId &&
            action ===
              "transfer"
          ) {
            await applyPlaybackRemoteCommand(
              {
                ...response,
                action:
                  "transfer",
              },
              {
                player,
                snapshot:
                  accountPlaybackSnapshotRef
                    .current ??
                  snapshot,
                snapshotPosition:
                  accountPlaybackPosition,
              },
            );
          }

          return true;
        } catch {
          if (
            snapshot
          ) {
            accountPlaybackSnapshotRef
              .current =
                snapshot;

            setAccountPlaybackSnapshot(
              snapshot,
            );
          }

          if (
            targetId ===
              currentDeviceId &&
            action ===
              "transfer"
          ) {
            player.silenceLocalPlayback();
          }

          return false;
        }
      },
      [
        currentUser?.account_type,
      ],
    );


  useEffect(() => {
    playbackDevicesRef.current =
      playbackDevices;
  }, [
    playbackDevices,
  ]);


  useEffect(() => {
    accountPlaybackSnapshotRef.current =
      accountPlaybackSnapshot;
  }, [
    accountPlaybackSnapshot,
  ]);


  useEffect(() => {
    controlledPlaybackDeviceIdRef.current =
      controlledPlaybackDeviceId;
  }, [
    controlledPlaybackDeviceId,
  ]);


  useEffect(() => {
    if (
      currentUser?.account_type !==
        "registered"
    ) {
      player.setRemotePlaybackController(
        null,
      );

      return undefined;
    }

    player.setRemotePlaybackController({
      shouldHandle:
        () => {
          const targetId =
            resolveCurrentPlaybackControlTarget();

          if (
            !targetId ||
            targetId ===
              playbackDeviceIdRef.current
          ) {
            return false;
          }

          return playbackDevicesRef
            .current
            .some(
              (device) =>
                device.device_id ===
                  targetId &&
                device.is_online,
            );
        },

      dispatch:
        async (
          action,
          payload,
        ) => {
          const targetId =
            resolveCurrentPlaybackControlTarget();

          if (!targetId) {
            return false;
          }

          if (
            action ===
              "play_track"
          ) {
            const trackId =
              String(
                payload?.trackId ??
                "",
              ).trim();

            if (!trackId) {
              return false;
            }

            return sendAccountPlaybackCommand(
              targetId,
              "play_track",
              null,
              {
                trackId,
                trackMeta:
                  payload?.meta ??
                  null,
                queue:
                  payload?.queue ??
                  null,
                queueIndex:
                  payload?.queueIndex ??
                  null,
              },
            );
          }

          if (
            action ===
              "play_url"
          ) {
            /*
             * Arbitrary URL playback has no
             * cross-device catalog identity.
             * Suppress local audio instead of
             * leaking sound from the controller.
             */
            return false;
          }

          if (
            action ===
              "toggle"
          ) {
            return sendAccountPlaybackCommand(
              targetId,
              accountPlaybackSnapshotRef
                .current
                ?.paused
                ? "play"
                : "pause",
            );
          }

          if (
            action ===
              "seek" ||
            action ===
              "volume"
          ) {
            return sendAccountPlaybackCommand(
              targetId,
              action,
              Number(
                payload?.value,
              ),
            );
          }

          if (
            action ===
              "pause" ||
            action ===
              "next" ||
            action ===
              "previous" ||
            action ===
              "stop"
          ) {
            return sendAccountPlaybackCommand(
              targetId,
              action,
            );
          }

          return false;
        },
    });

    return () => {
      player.setRemotePlaybackController(
        null,
      );
    };
  }, [
    currentUser?.account_type,
    resolveCurrentPlaybackControlTarget,
    sendAccountPlaybackCommand,
  ]);


  useEffect(() => {
    return subscribePwaInstall(
      (nextState) => {
        setInstallState(
          nextState,
        );
      },
    );
  }, []);


  useEffect(() => {
    let releaseTimer =
      null;

    const releaseNonTextFocus =
      (event) => {
        if (
          shouldKeepTextFocus(
            event.target,
          )
        ) {
          return;
        }

        if (releaseTimer) {
          window.clearTimeout(
            releaseTimer,
          );
        }

        /*
         * Wait until the click has fully
         * dispatched, then release button/
         * link/card focus back to dead
         * document space. Text entry keeps
         * focus so typing still works.
         */
        releaseTimer =
          window.setTimeout(
            () => {
              releaseTimer =
                null;

              const active =
                document.activeElement;

              if (
                active instanceof
                  HTMLElement
                && active !==
                  document.body
                && active !==
                  document.documentElement
                && !shouldKeepTextFocus(
                  active,
                )
              ) {
                active.blur();
              }
            },
            0,
          );
      };

    window.addEventListener(
      "click",
      releaseNonTextFocus,
    );

    window.addEventListener(
      "contextmenu",
      releaseNonTextFocus,
    );

    return () => {
      if (releaseTimer) {
        window.clearTimeout(
          releaseTimer,
        );
      }

      window.removeEventListener(
        "click",
        releaseNonTextFocus,
      );

      window.removeEventListener(
        "contextmenu",
        releaseNonTextFocus,
      );
    };
  }, []);


  useEffect(() => {
    const handlePlaybackShortcut =
      (event) => {
        const isSpace =
          event.code ===
            "Space" ||
          event.key ===
            " ";

        if (
          !isSpace ||
          event.repeat ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          event.defaultPrevented
        ) {
          return;
        }

        /*
         * Space is a HyperSync playback
         * shortcut only while this browser
         * tab is actually open and focused.
         * It must never behave like a
         * system-wide media hotkey.
         */
        if (
          document.visibilityState !==
            "visible" ||
          typeof document.hasFocus ===
            "function" &&
          !document.hasFocus()
        ) {
          return;
        }

        if (
          typeof window.matchMedia ===
            "function" &&
          !window.matchMedia(
            "(pointer: fine)",
          ).matches
        ) {
          return;
        }

        if (
          shouldIgnorePlaybackShortcut(
            event.target,
          )
        ) {
          return;
        }

        const playerState =
          player.getState();

        if (
          !playerState?.trackId
        ) {
          return;
        }

        event.preventDefault();

        void player
          .togglePlay()
          .catch(
            () => {},
          );
      };

    window.addEventListener(
      "keydown",
      handlePlaybackShortcut,
    );

    return () => {
      window.removeEventListener(
        "keydown",
        handlePlaybackShortcut,
      );
    };
  }, []);


  useEffect(() => {
    const isMobileGesture =
      () => (
        typeof window.matchMedia ===
          "function" &&
        window.matchMedia(
          "(max-width: 979px) and (pointer: coarse)",
        ).matches
      );

    const handlePointerDown =
      (event) => {
        if (
          event.pointerType !==
            "touch" ||
          !isMobileGesture()
        ) {
          return;
        }

        mobilePointerStartRef.current = {
          x:
            event.clientX,
          y:
            event.clientY,
        };
      };

    const handlePointerUp =
      (event) => {
        if (
          event.pointerType !==
            "touch" ||
          !isMobileGesture() ||
          shouldIgnorePlaybackShortcut(
            event.target,
          )
        ) {
          mobilePointerStartRef.current =
            null;

          return;
        }

        const start =
          mobilePointerStartRef.current;

        mobilePointerStartRef.current =
          null;

        if (
          start &&
          (
            Math.abs(
              event.clientX -
                start.x,
            ) >
              24 ||
            Math.abs(
              event.clientY -
                start.y,
            ) >
              24
          )
        ) {
          return;
        }

        const playerState =
          player.getState();

        if (
          !playerState?.trackId &&
          !playerState?.src
        ) {
          return;
        }

        const side =
          event.clientX <
          window.innerWidth / 2
            ? "back"
            : "forward";

        const now =
          Date.now();

        const previous =
          mobileTapRef.current;

        const isDoubleTap =
          previous.side ===
            side &&
          now -
            previous.time <=
            325 &&
          Math.abs(
            event.clientX -
              previous.x,
          ) <=
            90 &&
          Math.abs(
            event.clientY -
              previous.y,
          ) <=
            90;

        mobileTapRef.current = {
          time:
            now,
          side,
          x:
            event.clientX,
          y:
            event.clientY,
        };

        if (!isDoubleTap) {
          return;
        }

        event.preventDefault();

        mobileTapRef.current = {
          time:
            0,
          side:
            "",
          x:
            0,
          y:
            0,
        };

        const controlTarget =
          resolveCurrentPlaybackControlTarget();

        const currentDeviceId =
          playbackDeviceIdRef.current;

        const snapshot =
          accountPlaybackSnapshotRef.current;

        const controllingRemote =
          Boolean(
            controlTarget &&
            currentDeviceId &&
            controlTarget !==
              currentDeviceId &&
            snapshot?.device_id ===
              controlTarget,
          );

        const remoteTime =
          controllingRemote
            ? accountPlaybackPosition(
                snapshot,
              )
            : null;

        const currentTime =
          controllingRemote
            ? remoteTime
            : (
                Number.isFinite(
                  playerState.currentTime,
                )
                  ? playerState.currentTime
                  : 0
              );

        const remoteDuration =
          Number(
            snapshot?.track
              ?.duration_seconds,
          );

        const duration =
          controllingRemote &&
          Number.isFinite(
            remoteDuration,
          ) &&
          remoteDuration > 0
            ? remoteDuration
            : (
                Number.isFinite(
                  playerState.duration,
                ) &&
                playerState.duration >
                  0
                  ? playerState.duration
                  : Infinity
              );

        const delta =
          side ===
            "back"
            ? -10
            : 10;

        const nextTime =
          Math.max(
            0,
            Math.min(
              currentTime +
                delta,
              duration,
            ),
          );

        player.seekTo(
          nextTime,
        );

        setMobileSeekFeedback({
          side,
          label:
            side === "back"
              ? "-10"
              : "+10",
        });

        if (
          mobileSeekFeedbackTimerRef
            .current
        ) {
          window.clearTimeout(
            mobileSeekFeedbackTimerRef
              .current,
          );
        }

        mobileSeekFeedbackTimerRef.current =
          window.setTimeout(
            () => {
              setMobileSeekFeedback(
                null,
              );

              mobileSeekFeedbackTimerRef.current =
                null;
            },
            650,
          );
      };

    window.addEventListener(
      "pointerdown",
      handlePointerDown,
      {
        passive:
          true,
      },
    );

    window.addEventListener(
      "pointerup",
      handlePointerUp,
      {
        passive:
          false,
      },
    );

    return () => {
      window.removeEventListener(
        "pointerdown",
        handlePointerDown,
      );

      window.removeEventListener(
        "pointerup",
        handlePointerUp,
      );

      if (
        mobileSeekFeedbackTimerRef
          .current
      ) {
        window.clearTimeout(
          mobileSeekFeedbackTimerRef
            .current,
        );

        mobileSeekFeedbackTimerRef.current =
          null;
      }
    };
  }, []);


  useEffect(() => {
    if (
      currentUser?.account_type !==
        "registered"
    ) {
      playbackLastServerUpdateRef.current =
        0;

      playbackPendingWriteRef.current =
        null;

      playbackDevicesRef.current =
        [];

      accountPlaybackSnapshotRef.current =
        null;

      controlledPlaybackDeviceIdRef.current =
        null;

      playbackLiveConnectionRef.current
        ?.close?.();

      playbackLiveConnectionRef.current =
        null;

      playbackSeenCommandIdsRef.current
        .clear();

      setPlaybackDevices(
        [],
      );

      setAccountPlaybackSnapshot(
        null,
      );

      setControlledPlaybackDeviceId(
        null,
      );

      return undefined;
    }

    let cancelled =
      false;

    let unsubscribe =
      null;

    let pollInterval =
      null;

    let pollInFlight =
      false;

    let liveConnection =
      null;

    let liveReconnectTimer =
      null;

    const deviceId =
      playbackDeviceIdRef.current;

    const deviceDescriptor =
      playbackDeviceDescriptorRef.current;

    const syncControlledPlaybackDevice =
      (
        devices,
        snapshot,
      ) => {
        setControlledPlaybackDeviceId(
          (current) => {
            const next =
              resolvePlaybackControlTarget({
                devices,
                currentDeviceId:
                  deviceId,
                activeDeviceId:
                  snapshot?.device_id ??
                  null,
                controlledDeviceId:
                  current,
              });

            controlledPlaybackDeviceIdRef
              .current =
                next;

            return next;
          },
        );
      };

    const markPublished =
      (state) => {
        playbackLastPublishedRef.current = {
          trackId:
            state?.trackId
              ? String(
                  state.trackId,
                )
              : null,
          paused:
            Boolean(
              state?.paused ??
              true,
            ),
          position:
            Math.max(
              Number(
                state?.currentTime ??
                0,
              ) || 0,
              0,
            ),
          at:
            Date.now(),
          queueSignature:
            (
              Array.isArray(
                state?.queue,
              )
                ? state.queue
                    .slice(
                      0,
                      500,
                    )
                    .map(
                      (entry) =>
                        String(
                          entry?.id ??
                            "",
                        ),
                    )
                    .join(
                      "\u001f",
                    )
                : ""
            ) +
            "|" +
            String(
              Number.isInteger(
                state?.queueIndex,
              )
                ? state.queueIndex
                : -1,
            ),
        };
      };

    const publishPlayback =
      async (
        state,
      ) => {
        if (
          cancelled ||
          playbackApplyingRemoteRef
            .current ||
          globalThis.navigator
            ?.onLine ===
            false
        ) {
          return null;
        }

        const activeDeviceId =
          accountPlaybackSnapshotRef
            .current
            ?.device_id;

        if (
          activeDeviceId &&
          activeDeviceId !==
            deviceId
        ) {
          /*
           * A controller is never allowed to
           * steal playback merely because its
           * local Audio element changed state.
           */
          return null;
        }

        const liveConnection =
          playbackLiveConnectionRef
            .current;

        const syncState =
          buildAccountPlaybackSyncState(
            state,
          );

        const sentRealtime =
          liveConnection
            ?.sendPlaybackState?.({
              trackId:
                syncState.trackId,
              positionSeconds:
                Math.max(
                  Number(
                    state?.currentTime ??
                    0,
                  ) || 0,
                  0,
                ),
              paused:
                syncState.trackId
                  ? Boolean(
                      state.paused,
                    )
                  : true,
              queueTrackIds:
                syncState
                  .queueTrackIds,
              queueIndex:
                syncState
                  .queueIndex,
            }) ??
          false;

        if (sentRealtime) {
          markPublished(
            state,
          );

          return state;
        }

        if (
          playbackWriteInFlightRef
            .current
        ) {
          playbackPendingWriteRef.current =
            state;

          return null;
        }

        playbackWriteInFlightRef.current =
          true;

        try {
          const response =
            await apiRequest(
              "/users/me/playback-state",
              {
                method:
                  "PATCH",

                body:
                  JSON.stringify({
                    track_id:
                      syncState.trackId,

                    position_seconds:
                      Math.max(
                        Number(
                          state?.currentTime ??
                          0,
                        ) || 0,
                        0,
                      ),

                    paused:
                      syncState.trackId
                        ? Boolean(
                            state.paused,
                          )
                        : true,

                    queue_track_ids:
                      syncState
                        .queueTrackIds,

                    queue_index:
                      syncState
                        .queueIndex,

                    device_id:
                      deviceId,
                  }),
              },
            );

          if (cancelled) {
            return null;
          }

          playbackLastServerUpdateRef
            .current =
              Math.max(
                playbackLastServerUpdateRef
                  .current,
                playbackUpdatedAtMs(
                  response
                    ?.updated_at,
                ),
              );

          accountPlaybackSnapshotRef.current =
            response;

          setAccountPlaybackSnapshot(
            response,
          );

          markPublished(
            state,
          );

          return response;
        } catch {
          // Playback remains fully usable
          // if account sync is temporarily
          // unavailable.
          return null;
        } finally {
          playbackWriteInFlightRef.current =
            false;

          const pending =
            playbackPendingWriteRef
              .current;

          playbackPendingWriteRef.current =
            null;

          if (
            pending &&
            !cancelled
          ) {
            void publishPlayback(
              pending,
            );
          }
        }
      };

    const shouldPublish =
      (state) => {
        if (
          state?.phase ===
            "loading" ||
          isOnDemandTrackId(
            state?.trackId,
          )
        ) {
          return false;
        }

        const previous =
          playbackLastPublishedRef
            .current;

        const trackId =
          state?.trackId
            ? String(
                state.trackId,
              )
            : null;

        const position =
          Math.max(
            Number(
              state?.currentTime ??
                0,
            ) || 0,
            0,
          );

        const paused =
          Boolean(
            state?.paused ??
              true,
          );

        const queueSignature =
          (
            Array.isArray(
              state?.queue,
            )
              ? state.queue
                  .slice(
                    0,
                    500,
                  )
                  .map(
                    (entry) =>
                      String(
                        entry?.id ??
                          "",
                      ),
                  )
                  .join(
                    "\u001f",
                  )
              : ""
          ) +
          "|" +
          String(
            Number.isInteger(
              state?.queueIndex,
            )
              ? state.queueIndex
              : -1,
          );

        const now =
          Date.now();

        return (
          trackId !==
            previous.trackId ||
          paused !==
            previous.paused ||
          queueSignature !==
            previous.queueSignature ||
          Math.abs(
            position -
              previous.position,
          ) >=
            4 ||
          (
            !paused &&
            now -
              previous.at >=
              ACCOUNT_PLAYBACK_SYNC_INTERVAL_MS
          )
        );
      };

    const applyRemotePlayback =
      async (
        snapshot,
      ) => {
        const updatedAt =
          playbackUpdatedAtMs(
            snapshot?.updated_at,
          );

        if (
          updatedAt <=
          playbackLastServerUpdateRef
            .current
        ) {
          return;
        }

        playbackLastServerUpdateRef.current =
          updatedAt;

        accountPlaybackSnapshotRef.current =
          snapshot;

        playbackApplyingRemoteRef.current =
          true;

        try {
          const ownsPlayback =
            snapshot?.device_id ===
              deviceId;

          if (!ownsPlayback) {
            const localState =
              player.getState();

            const handoff =
              advanceOutgoingHandoffObservation({
                snapshot,
                deviceId,
                localState,
                previousObservation:
                  playbackOutgoingHandoffObservationRef
                    .current,
                updatedAtMs:
                  updatedAt,
              });

            playbackOutgoingHandoffObservationRef
              .current =
                handoff.observation;

            if (
              handoff.phase ===
                "confirmed"
            ) {
              /*
               * The target publishes playback only
               * after its transfer command finishes.
               * For a playing transfer that means
               * audio.play() resolved on the target.
               * Keep this outgoing speaker alive for
               * one additional second from that point.
               */
              if (
                handoff.justConfirmed
              ) {
                cancelPlaybackHandoffSilence();
              }

              schedulePlaybackHandoffSilence(
                PLAYBACK_HANDOFF_OVERLAP_MS,
              );
            } else if (
              handoff.phase ===
                "waiting"
            ) {
              /*
               * A bounded fallback prevents a failed
               * target from leaving two devices audible
               * forever, while still giving slow/offline
               * polling handoffs time to confirm.
               */
              schedulePlaybackHandoffSilence(
                PLAYBACK_HANDOFF_CONFIRMATION_TIMEOUT_MS,
              );
            } else {
              playbackOutgoingHandoffObservationRef
                .current =
                  null;

              cancelPlaybackHandoffSilence();

              player.silenceLocalPlayback();
            }

            player.syncAccountPlaybackShadow?.(
              snapshot,
            );

            return;
          }

          playbackOutgoingHandoffObservationRef
            .current =
              null;

          cancelPlaybackHandoffSilence();

          /*
           * Never restore an account-state
           * broadcast back into the browser
           * that already owns playback.
           *
           * The active player is the source
           * of that state. Re-loading it here
           * can interrupt its in-flight
           * play() while advancing tracks.
           * Remote transfer/play-track
           * commands still restore through
           * applyPendingCommands below.
           */
          markPublished(
            player.getState(),
          );

          return;
        } finally {
          playbackApplyingRemoteRef.current =
            false;
        }
      };

    const applyPendingCommands =
      async (
        commands,
        snapshot,
      ) => {
        const queue =
          Array.isArray(
            commands,
          )
            ? commands
            : [];

        for (
          const command
          of queue
        ) {
          if (cancelled) {
            return;
          }

          const commandId =
            String(
              command?.id ??
              "",
            );

          if (
            commandId &&
            playbackSeenCommandIdsRef
              .current
              .has(
                commandId,
              )
          ) {
            continue;
          }

          if (
            !shouldApplyPlaybackRemoteCommand(
              command,
              {
                snapshot,
                deviceId,
              },
            )
          ) {
            if (commandId) {
              playbackSeenCommandIdsRef
                .current
                .add(
                  commandId,
                );
            }

            continue;
          }

          let applied =
            false;

          playbackApplyingRemoteRef.current =
            true;

          try {
            const result =
              await applyPlaybackRemoteCommand(
                command,
                {
                  player,
                  snapshot,
                  snapshotPosition:
                    accountPlaybackPosition,
                },
              );

            applied =
              Boolean(
                result,
              );
          } catch {
            // Browser autoplay policies can
            // reject a remote Play on a device
            // that has never been interacted
            // with. Other commands continue.
          } finally {
            playbackApplyingRemoteRef.current =
              false;
          }

          if (
            applied &&
            commandId
          ) {
            playbackSeenCommandIdsRef
              .current
              .add(
                commandId,
              );

            if (
              playbackSeenCommandIdsRef
                .current.size >
                256
            ) {
              const oldest =
                playbackSeenCommandIdsRef
                  .current
                  .values()
                  .next()
                  .value;

              playbackSeenCommandIdsRef
                .current
                .delete(
                  oldest,
                );
            }
          }

          if (
            applied &&
            !cancelled
          ) {
            await publishPlayback(
              player.getState(),
            );
          }
        }
      };

    const pollDevice =
      async () => {
        if (
          cancelled ||
          pollInFlight ||
          globalThis.navigator
            ?.onLine ===
            false
        ) {
          return null;
        }

        pollInFlight =
          true;

        try {
          const response =
            await pollPlaybackDevice({
              deviceId,
              name:
                deviceDescriptor.name,
              deviceType:
                deviceDescriptor.deviceType,
            });

          if (cancelled) {
            return null;
          }

          const devices =
            Array.isArray(
              response?.devices,
            )
              ? response.devices
              : [];

          const snapshot =
            response
              ?.playback_state ??
            null;

          playbackDevicesRef.current =
            devices;

          accountPlaybackSnapshotRef.current =
            snapshot;

          setPlaybackDevices(
            devices,
          );

          setAccountPlaybackSnapshot(
            snapshot,
          );

          syncControlledPlaybackDevice(
            devices,
            snapshot,
          );

          await applyRemotePlayback(
            snapshot,
          );

          await applyPendingCommands(
            response?.commands,
            snapshot,
          );

          return snapshot;
        } catch {
          return null;
        } finally {
          pollInFlight =
            false;
        }
      };

    const handleLiveEvent =
      async (
        event,
      ) => {
        if (
          cancelled ||
          !event ||
          typeof event !==
            "object"
        ) {
          return;
        }

        const devices =
          Array.isArray(
            event.devices,
          )
            ? event.devices
            : null;

        if (devices) {
          playbackDevicesRef.current =
            devices;

          setPlaybackDevices(
            devices,
          );
        }

        const snapshot =
          event.playback_state ??
          null;

        if (snapshot) {
          accountPlaybackSnapshotRef.current =
            snapshot;

          setAccountPlaybackSnapshot(
            snapshot,
          );

          syncControlledPlaybackDevice(
            devices ??
              playbackDevicesRef.current,
            snapshot,
          );

          await applyRemotePlayback(
            snapshot,
          );
        } else if (devices) {
          syncControlledPlaybackDevice(
            devices,
            accountPlaybackSnapshotRef
              .current,
          );
        }

        if (
          event.type ===
            "command" &&
          event.command
        ) {
          await applyPendingCommands(
            [
              event.command,
            ],
            snapshot ??
              accountPlaybackSnapshotRef
                .current,
          );
        }

        if (
          event.type ===
            "listening_history_changed"
        ) {
          notifyListeningHistoryChanged();
        }

        if (
          event.type ===
            "presence_changed"
        ) {
          void pollDevice();
        }
      };


    const scheduleLiveReconnect =
      () => {
        if (
          cancelled ||
          liveReconnectTimer
        ) {
          return;
        }

        liveReconnectTimer =
          window.setTimeout(
            () => {
              liveReconnectTimer =
                null;

              void connectLive();
            },
            ACCOUNT_PLAYBACK_LIVE_RECONNECT_MS,
          );
      };


    const connectLive =
      async () => {
        if (
          cancelled ||
          liveConnection ||
          globalThis.navigator
            ?.onLine ===
            false
        ) {
          return;
        }

        try {
          const connection =
            await connectPlaybackDeviceLive({
              deviceId,
              name:
                deviceDescriptor.name,
              deviceType:
                deviceDescriptor.deviceType,

              onEvent:
                (event) => {
                  void handleLiveEvent(
                    event,
                  ).catch(
                    () => {},
                  );
                },

              onClose:
                () => {
                  liveConnection =
                    null;

                  playbackLiveConnectionRef.current =
                    null;

                  if (!cancelled) {
                    void pollDevice();
                    scheduleLiveReconnect();
                  }
                },
            });

          if (
            cancelled
          ) {
            connection?.close?.();
            return;
          }

          liveConnection =
            connection;

          playbackLiveConnectionRef.current =
            connection;

          if (!connection) {
            scheduleLiveReconnect();
          }
        } catch {
          scheduleLiveReconnect();
        }
      };


    const bootstrap =
      async () => {
        const remote =
          await pollDevice();

        if (cancelled) {
          return;
        }

        void connectLive();

        const local =
          player.getState();

        /*
         * If this account has never synced
         * playback before, seed it from the
         * local restored player state.
         */
        if (
          !remote?.updated_at &&
          local?.trackId
        ) {
          await publishPlayback(
            local,
          );
        } else {
          markPublished(
            player.getState(),
          );
        }

        if (cancelled) {
          return;
        }

        unsubscribe =
          player.subscribe(
            (state) => {
              if (
                cancelled ||
                playbackApplyingRemoteRef
                  .current ||
                globalThis.navigator
                  ?.onLine ===
                  false ||
                !shouldPublish(
                  state,
                )
              ) {
                return;
              }

              void publishPlayback(
                state,
              );
            },
          );

        pollInterval =
          window.setInterval(
            () => {
              void pollDevice();
            },
            ACCOUNT_PLAYBACK_DEVICE_POLL_MS,
          );
      };

    void bootstrap();

    const handleFocus =
      () => {
        void pollDevice();
        void connectLive();
      };

    const handleVisibility =
      () => {
        if (
          document.visibilityState ===
            "visible"
        ) {
          void pollDevice();
          void connectLive();
        }
      };

    window.addEventListener(
      "focus",
      handleFocus,
    );

    window.addEventListener(
      "pageshow",
      handleFocus,
    );

    window.addEventListener(
      "online",
      handleFocus,
    );

    document.addEventListener(
      "visibilitychange",
      handleVisibility,
    );

    return () => {
      cancelled =
        true;

      unsubscribe?.();

      if (pollInterval) {
        window.clearInterval(
          pollInterval,
        );
      }

      if (liveReconnectTimer) {
        window.clearTimeout(
          liveReconnectTimer,
        );

        liveReconnectTimer =
          null;
      }

      liveConnection?.close?.();

      liveConnection =
        null;

      playbackLiveConnectionRef.current =
        null;

      playbackPendingWriteRef.current =
        null;

      window.removeEventListener(
        "focus",
        handleFocus,
      );

      window.removeEventListener(
        "pageshow",
        handleFocus,
      );

      window.removeEventListener(
        "online",
        handleFocus,
      );

      document.removeEventListener(
        "visibilitychange",
        handleVisibility,
      );
    };
  }, [
    cancelPlaybackHandoffSilence,
    currentUser?.account_type,
    currentUser?.id,
    schedulePlaybackHandoffSilence,
  ]);


  useEffect(() => {
    const syncActivePlaylistDownloads =
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
      };

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
    currentUser,
  ]);

  const playlistUpdateCheckRef =
    useRef(false);

  const dismissedPlaylistUpdatesRef =
    useRef(
      new Set(),
    );

  const searchStateTimerRef =
    useRef(null);

  const cancelPendingSearchSave =
  useCallback(() => {
    if (
      searchStateTimerRef.current
    ) {
      window.clearTimeout(
        searchStateTimerRef.current,
      );

      searchStateTimerRef.current =
        null;
    }
  }, []);


const restoreSavedAppView =
  useCallback(
    async (user) => {
      const params =
        new URLSearchParams(
          window.location.search,
        );

      const linkedUsername =
        params.get(
          "view",
        ) ===
          "messages"
          ? String(
              params.get(
                "user",
              ) ??
              "",
            ).trim()
          : "";

      if (
        linkedUsername &&
        user?.account_type ===
          "registered"
      ) {
        setMessageToOpen(
          linkedUsername,
        );

        setActivePage(
          "messages",
        );

        setSearchQuery(
          "",
        );

        setActiveProfileUsername(
          "",
        );

        window.history
          .replaceState(
            null,
            "",
            (
              window.location
                .pathname +
              window.location
                .hash
            ),
          );

        return;
      }

      try {
        const state =
          await apiRequest(
            "/users/me/app-state",
          );

        const restored =
          normalizeAppViewState(
            state,
            user?.role,
          );

        setActivePage(
          restored.activePage,
        );

        setSearchQuery(
          restored.searchQuery,
        );

        setActiveProfileUsername(
          restored.profileUsername,
        );
      } catch {
        setActivePage(
          "home",
        );

        setSearchQuery(
          "",
        );

        setActiveProfileUsername(
          "",
        );
      }
    },
    [],
  );


const checkDownloadedGeneratedPlaylistUpdates =
  useCallback(
    async () => {
      if (
        currentUser?.account_type !==
          "registered" ||
        globalThis.navigator
          ?.onLine ===
          false ||
        playlistUpdateCheckRef
          .current
      ) {
        return;
      }

      playlistUpdateCheckRef.current =
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

                    if (
                      livePlaylist.is_liked_songs
                    ) {
                      await reconcileDownloadedPlaylistMembership(
                        livePlaylist,
                        offlineOwnerKey,
                      );

                      const missingLikedTracks =
                        findMissingPlaylistTracks(
                          livePlaylist,
                          downloadedPlaylist,
                        );

                      if (
                        missingLikedTracks.length >
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

                            jobMetadata: {
                              kind:
                                "playlist",
                              playlistId:
                                livePlaylist.id,
                              playlistTitle:
                                livePlaylist.title,
                              playlistDescription:
                                livePlaylist.description ??
                                null,
                              playlistArtworkUrl:
                                livePlaylist.artwork_url ??
                                null,
                              playlistOwnerUsername:
                                livePlaylist.owner_username ??
                                null,
                              playlistVisibility:
                                livePlaylist.visibility ??
                                null,
                            },
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
                      "generated"
                    ) {
                      return null;
                    }

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
                      dismissedPlaylistUpdatesRef
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
          ).filter(Boolean);

        setPlaylistUpdates(
          (current) =>
            detected.map(
              (update) => {
                const existing =
                  current.find(
                    (item) =>
                      item.key ===
                      update.key,
                  );

                return (
                  existing?.status ===
                    "downloading"
                    ? existing
                    : update
                );
              },
            ),
        );
      } finally {
        playlistUpdateCheckRef.current =
          false;
      }
    },
    [currentUser],
  );


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

    void (
      async () => {
        await cleanupLegacyUnscopedDownloads();

        await recoverInterruptedDownloadJobs(
          getOfflineOwnerKey(
            currentUser,
          ),
        );

        await checkDownloadedGeneratedPlaylistUpdates();
      }
    )().catch(
      () => {},
    );

    const intervalId =
      window.setInterval(
        () => {
          void checkDownloadedGeneratedPlaylistUpdates();
        },
        15000,
      );

    const handleFocus =
      () => {
        void checkDownloadedGeneratedPlaylistUpdates();
      };

    const handleVisibility =
      () => {
        if (
          document.visibilityState ===
          "visible"
        ) {
          void checkDownloadedGeneratedPlaylistUpdates();
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
    currentUser,
    checkDownloadedGeneratedPlaylistUpdates,
  ]);


  const dismissPlaylistUpdate =
    useCallback(
      () => {
        setPlaylistUpdates(
          (current) => {
            const [
              active,
              ...rest
            ] =
              current;

            if (active?.key) {
              dismissedPlaylistUpdatesRef
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
        } =
          update;

        setPlaylistUpdates(
          (current) =>
            current.map(
              (item) =>
                item.key === key
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
                  getOfflineOwnerKey(
                    currentUser,
                  ),
                  playlist.id,
                ),
              ownerKey:
                getOfflineOwnerKey(
                  currentUser,
                ),

              jobMetadata: {
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
              },

              onProgress: ({
                trackProgress,
              }) => {
                const missingProgress =
                  missingTracks.length > 0
                    ? (
                        missingTracks.reduce(
                          (
                            total,
                            track,
                          ) =>
                            total +
                            (
                              trackProgress?.[
                                String(
                                  track.id,
                                )
                              ]?.progress ??
                              0
                            ),
                          0,
                        ) /
                        missingTracks.length
                      )
                    : 1;

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
                                Number.isFinite(
                                  missingProgress,
                                )
                                  ? missingProgress
                                  : 0,
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

          setStatusMessage(
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

          setStatusMessage(
            error instanceof Error
              ? error.message
              : "Unable to download new playlist songs.",
          );
        }
      },
      [playlistUpdates],
    );


  const activePlaylistUpdate =
    playlistUpdates[0] ??
    null;


  const refreshMessageNotifications =
  useCallback(
    async () => {
      if (
        currentUser?.account_type !==
          "registered" ||
        globalThis.navigator
          ?.onLine ===
          false
      ) {
        setMessageNotifications({
          unread_count:
            0,
          notifications:
            [],
        });

        return;
      }

      try {
        const result =
          await getMessageNotifications();

        setMessageNotifications({
          unread_count:
            Number(
              result?.unread_count ??
              0,
            ) || 0,
          notifications:
            Array.isArray(
              result?.notifications,
            )
              ? result.notifications
              : [],
        });
      } catch {
        // Keep the current notification snapshot
        // during a temporary network failure.
      }
    },
    [
      currentUser?.account_type,
      currentUser?.id,
    ],
  );


  const consumeNotification =
    useCallback(
      async (
        notification,
      ) => {
        if (!notification) {
          return;
        }

        const adminNotification =
          notification.type ===
            "admin_activity" ||
          notification.type ===
            "admin_account_notification";

        const notificationKey =
          adminNotification
            ? String(
                notification
                  .notification_id ??
                  "",
              )
            : String(
                notification
                  .message_id ??
                  "",
              );

        setMessageNotifications(
          (current) => {
            const currentItems =
              Array.isArray(
                current?.notifications,
              )
                ? current.notifications
                : [];

            const nextItems =
              currentItems.filter(
                (item) => {
                  const itemAdminNotification =
                    item.type ===
                      "admin_activity" ||
                    item.type ===
                      "admin_account_notification";

                  const itemKey =
                    itemAdminNotification
                      ? String(
                          item
                            .notification_id ??
                            "",
                        )
                      : String(
                          item
                            .message_id ??
                            "",
                        );

                  return (
                    item.type !==
                      notification.type ||
                    itemKey !==
                      notificationKey
                  );
                },
              );

            return {
              unread_count:
                Math.max(
                  (
                    Number(
                      current
                        ?.unread_count ??
                        currentItems.length,
                    ) || 0
                  ) - 1,
                  0,
                ),
              notifications:
                nextItems,
            };
          },
        );

        try {
          if (
            notification.type ===
              "admin_activity"
          ) {
            await markAdminNotificationRead(
              notification
                .notification_id,
            );
          } else if (
            notification.type ===
              "admin_account_notification"
          ) {
            await markAdminAccountNotificationRead(
              notification
                .notification_id,
            );
          } else {
            await markMessageNotificationRead(
              notification
                .message_id,
            );
          }
        } catch {
          // Refresh restores the item if deletion failed.
        } finally {
          await refreshMessageNotifications();
        }
      },
      [
        refreshMessageNotifications,
      ],
    );


  const openNotificationDetail =
    useCallback(
      (
        notification,
      ) => {
        if (!notification) {
          return;
        }

        setNotificationDetail(
          notification,
        );

        void consumeNotification(
          notification,
        );
      },
      [
        consumeNotification,
      ],
    );


  const deleteNotification =
    useCallback(
      (
        notification,
      ) => {
        if (!notification) {
          return;
        }

        void consumeNotification(
          notification,
        );
      },
      [
        consumeNotification,
      ],
    );


const persistAppView =
  useCallback(
    (state) => {
      if (!currentUser) {
        return;
      }

      void apiRequest(
        "/users/me/app-state",
        {
          method:
            "PATCH",

          body:
            JSON.stringify(
              state,
            ),
        },
      ).catch(() => {});
    },
    [currentUser],
  );

  useEffect(() => {
  return () => {
    cancelPendingSearchSave();
  };
}, [
  cancelPendingSearchSave,
]);

  function handleLogout() {
  cancelPendingSearchSave();

  /*
   * Keep the song/source/player bar,
   * but always leave it paused when the
   * account logs out.
   */
  player.pausePlayback();

  const offlineOwnerKey =
    getOfflineOwnerKey(
      currentUser,
    );

  if (offlineOwnerKey) {
    clearCachedLibraryScope(
      offlineOwnerKey,
    );

    void removeAllOfflineDownloadsForOwner(
      offlineOwnerKey,
    ).catch(
      () => {},
    );
  }

  logoutSession();

  setCurrentUser(null);
  setPlaylistUpdates([]);
  setMessageToOpen("");
  setArtistToOpen("");
  setNotificationDetail(null);
  setMessageNotifications({
    unread_count:
      0,
    notifications:
      [],
  });
  setPushEnabled(
    false,
  );
  dismissedPlaylistUpdatesRef.current.clear();
  setActivePage("home");
  setSearchQuery("");
  setActiveProfileUsername("");
  setAuthMode("signin");
  setAuthOpen(false);
}

  const handleProfileUpdated =
  useCallback((profile) => {
    setCurrentUser((current) => {
      if (!current) {
        return current;
      }

      const updatedUser = {
        ...current,

        display_name:
          profile.display_name ??
          current.display_name,

        avatar_url:
          profile.avatar_url ?? null,
      };

      cacheUserProfile(
        updatedUser,
      );

      return updatedUser;
    });
  }, []);

    const pageTitle =
    activePage ===
    "public-profile"
      ? "Profile"
      : PAGE_TITLES[
          activePage
        ] ?? "HyperSynced";

  const appClassName = useMemo(
    () => (
      `app-shell ${
        compactMode
          ? "is-compact"
          : ""
      }`
    ),
    [compactMode],
  );

  useEffect(() => {
    if (!shouldRestoreSession()) {
      if (!readCachedUserProfile()) {
        setAuthOpen(true);
      }

      return undefined;
    }

    let cancelled = false;

    const syncSession = () => {
      restoreSession().then(async (user) => {
        if (cancelled) {
          return;
        }

    if (user) {
      setCurrentUser(user);
      setAuthOpen(false);

      await restoreSavedAppView(
      user,
      );

      return;
      }

        if (!readCachedUserProfile()) {
          setCurrentUser(null);
          setAuthOpen(true);
          return;
        }

        setCurrentUser(null);
        setAuthOpen(true);
      });
    };

    if (
      typeof requestIdleCallback ===
      "function"
    ) {
      const idleId =
        requestIdleCallback(syncSession, {
          timeout: 250,
        });

      return () => {
        cancelled = true;
        cancelIdleCallback(idleId);
      };
    }

    const timeoutId =
      window.setTimeout(syncSession, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
}, [
  restoreSavedAppView,
]);

  const navigate =
  useCallback(
    (page) => {
      cancelPendingSearchSave();


      /*
       * Clicking Search while already
       * on Search acts like returning
       * to the main Search results.
       *
       * SearchPage uses this token to
       * close any playlist sub-view.
       */
      if (
        page === "search" &&
        activePage === "search"
      ) {
        setSearchResetToken(
          (current) =>
            current + 1,
        );
      }

      /*
 * Clicking Library while already
 * on Library returns to the main
 * Library playlist list.
 */
if (
  page === "library" &&
  activePage === "library"
) {
  setLibraryResetToken(
    (current) =>
      current + 1,
  );
}

/*
 * Clicking Messages while already
 * on Messages returns to the main
 * conversation list, matching Search.
 */
if (
  page === "messages" &&
  activePage === "messages"
) {
  setMessagesResetToken(
    (current) =>
      current + 1,
  );

  setMessageToOpen(
    "",
  );
}


      if (
        page !==
        "public-profile"
      ) {
        setActiveProfileUsername(
          "",
        );
      }


      setActivePage(
        page,
      );


      setStatusMessage(
        "",
      );


      persistAppView({
        active_page:
          page,

        search_query:
          searchQuery,

        profile_username:
          null,
      });
    },
    [
      activePage,
      cancelPendingSearchSave,
      persistAppView,
      searchQuery,
    ],
  );

  const openPlaylistFromSearch =
  useCallback(
    (playlistId) => {
      if (!playlistId) {
        return;
      }

      setPlaylistToOpen(
        String(
          playlistId,
        ),
      );

      navigate(
        "library",
      );
    },
    [
      navigate,
    ],
  );


const clearPlaylistToOpen =
  useCallback(
    () => {
      setPlaylistToOpen(
        null,
      );
    },
    [],
  );

  const clearArtistToOpen =
    useCallback(
      () => {
        setArtistToOpen(
          "",
        );
      },
      [],
    );


  const openArtistProfile =
    useCallback(
      (artistName) => {
        const cleanName =
          String(
            artistName ?? "",
          ).trim();

        if (!cleanName) {
          return;
        }

        setArtistToOpen(
          cleanName,
        );

        setSearchQuery(
          cleanName,
        );

        setActiveProfileUsername(
          "",
        );

        setActivePage(
          "search",
        );

        setStatusMessage(
          "",
        );
      },
      [],
    );

    const openUserProfile =
  useCallback(
    (username) => {
      cancelPendingSearchSave();

      setActiveProfileUsername(
        username,
      );

      setActivePage(
        "public-profile",
      );

      setStatusMessage(
        "",
      );

      persistAppView({
        active_page:
          "public-profile",

        search_query:
          searchQuery,

        profile_username:
          username,
      });
    },
    [
      cancelPendingSearchSave,
      persistAppView,
      searchQuery,
    ],
  );

  const updateSearch =
  useCallback(
    (value) => {
      setSearchQuery(
        value,
      );

      setActiveProfileUsername(
        "",
      );

      setActivePage(
        "search",
      );

      cancelPendingSearchSave();

      if (!currentUser) {
        return;
      }

      searchStateTimerRef.current =
        window.setTimeout(
          () => {
            searchStateTimerRef.current =
              null;

            persistAppView({
              active_page:
                "search",

              search_query:
                value,

              profile_username:
                null,
            });
          },
          400,
        );
    },
    [
      cancelPendingSearchSave,
      currentUser,
      persistAppView,
    ],
  );

  const updateTopbarSearch =
  useCallback(
    (value) => {
      if (
        activePage !==
        "search"
      ) {
        return;
      }

      updateSearch(
        value,
      );
    },
    [
      activePage,
      updateSearch,
    ],
  );


  const openSearchFromTopbar =
  useCallback(
    () => {
      if (
        activePage ===
        "search"
      ) {
        return;
      }

      navigate(
        "search",
      );
    },
    [
      activePage,
      navigate,
    ],
  );


  const openAuth = useCallback((mode = "signin") => {
    setAuthMode(mode);
    setAuthOpen(true);
  }, []);


  const openMessageUser =
  useCallback(
    (username) => {
      if (
        currentUser?.account_type !==
          "registered"
      ) {
        openAuth(
          "signin",
        );

        return;
      }

      const normalized =
        String(
          username ??
          "",
        ).trim();

      setMessageToOpen(
        normalized,
      );

      navigate(
        "messages",
      );
    },
    [
      currentUser?.account_type,
      navigate,
      openAuth,
    ],
  );


  const clearMessageToOpen =
  useCallback(
    () => {
      setMessageToOpen(
        "",
      );
    },
    [],
  );


  useEffect(() => {
    const handleMusicShare =
      (event) => {
        const item =
          normalizeSharedMusicItem(
            event?.detail,
          );

        if (!item) {
          return;
        }

        if (
          currentUser?.account_type !==
            "registered"
        ) {
          openAuth(
            "signin",
          );

          return;
        }

        setSharedMusicToSend(
          item,
        );

        setMessageToOpen(
          "",
        );

        setMessagesResetToken(
          (current) =>
            current + 1,
        );

        navigate(
          "messages",
        );
      };

    window.addEventListener(
      MUSIC_SHARE_REQUEST_EVENT,
      handleMusicShare,
    );

    return () => {
      window.removeEventListener(
        MUSIC_SHARE_REQUEST_EVENT,
        handleMusicShare,
      );
    };
  }, [
    currentUser?.account_type,
    navigate,
    openAuth,
  ]);


  const clearSharedMusicToSend =
    useCallback(
      () => {
        setSharedMusicToSend(
          null,
        );
      },
      [],
    );


  const openSharedMusicFromMessage =
    useCallback(
      (
        rawItem,
      ) => {
        const item =
          normalizeSharedMusicItem(
            rawItem,
          );

        if (!item) {
          return;
        }

        setPlaylistToOpen(
          null,
        );

        updateSearch(
          sharedMusicSearchQuery(
            item,
          ),
        );
      },
      [
        updateSearch,
      ],
    );


  const handleInstallApp =
  useCallback(
    async () => {
      const result =
        await requestPwaInstall();

      setInstallState(
        result?.state ??
        getPwaInstallState(),
      );

      if (
        result?.status ===
          "accepted" ||
        result?.status ===
          "installed"
      ) {
        setStatusMessage(
          result?.systemReady
            ? "HyperSynced installed. Offline app system is ready."
            : "HyperSynced installed.",
        );

        setInstallHelpMode(
          "",
        );

        return;
      }

      if (
        result?.status ===
          "dismissed"
      ) {
        setStatusMessage(
          "App installation was canceled.",
        );

        return;
      }

      if (
        result?.status ===
          "insecure"
      ) {
        setStatusMessage(
          "App installation requires HTTPS or localhost.",
        );

        return;
      }

      if (
        result?.systemReady
      ) {
        setStatusMessage(
          result?.status ===
            "manual-ios"
            ? "Offline app system downloaded. Finish Add to Home Screen."
            : "Offline app system downloaded. Finish installing from your browser.",
        );
      }

      setInstallHelpMode(
        result?.status ===
          "manual-ios"
          ? "manual-ios"
          : "manual",
      );
    },
    [],
  );


  const handleEnablePush =
  useCallback(
    async () => {
      if (
        currentUser?.account_type !==
          "registered"
      ) {
        openAuth(
          "signin",
        );

        return;
      }

      setPushBusy(
        true,
      );

      try {
        const result =
          await enablePushNotifications();

        if (
          !result?.supported
        ) {
          setPushEnabled(
            false,
          );

          setStatusMessage(
            "Push notifications are not supported by this browser.",
          );

          return;
        }

        if (
          result?.configured ===
          false
        ) {
          setPushEnabled(
            false,
          );

          setStatusMessage(
            "Push notifications need VAPID keys configured on the server.",
          );

          return;
        }

        if (
          !result?.enabled
        ) {
          setPushEnabled(
            false,
          );

          setStatusMessage(
            result?.permission ===
              "denied"
              ? "Push notifications are blocked in this browser's site settings."
              : "Push notification permission was not granted.",
          );

          return;
        }

        setPushEnabled(
          true,
        );

        setStatusMessage(
          "Push notifications enabled.",
        );
      } catch (error) {
        setPushEnabled(
          false,
        );

        setStatusMessage(
          error instanceof Error
            ? error.message
            : "Unable to enable push notifications.",
        );
      } finally {
        setPushBusy(
          false,
        );
      }
    },
    [
      currentUser?.account_type,
      openAuth,
    ],
  );


  useEffect(() => {
    if (
      currentUser?.account_type !==
        "registered"
    ) {
      setMessageNotifications({
        unread_count:
          0,
        notifications:
          [],
      });

      setPushEnabled(
        false,
      );

      return undefined;
    }

    void refreshMessageNotifications();

    void syncExistingPushSubscription()
      .then(
        (result) => {
          setPushEnabled(
            Boolean(
              result?.enabled,
            ),
          );
        },
      )
      .catch(
        () => {
          setPushEnabled(
            false,
          );
        },
      );

    const interval =
      window.setInterval(
        () => {
          void refreshMessageNotifications();
        },
        12_000,
      );

    const handleFocus =
      () => {
        void refreshMessageNotifications();
      };

    const handleVisibility =
      () => {
        if (
          document.visibilityState ===
            "visible"
        ) {
          void refreshMessageNotifications();
        }
      };

    window.addEventListener(
      "focus",
      handleFocus,
    );

    document.addEventListener(
      "visibilitychange",
      handleVisibility,
    );

    return () => {
      window.clearInterval(
        interval,
      );

      window.removeEventListener(
        "focus",
        handleFocus,
      );

      document.removeEventListener(
        "visibilitychange",
        handleVisibility,
      );
    };
  }, [
    currentUser?.account_type,
    currentUser?.id,
    refreshMessageNotifications,
  ]);


  useEffect(() => {
    const serviceWorker =
      globalThis.navigator
        ?.serviceWorker;

    if (
      !serviceWorker
    ) {
      return undefined;
    }

    const handleWorkerMessage =
      (event) => {
        if (
          event.data?.type !==
            "HYPERSYNC_OPEN_MESSAGE"
        ) {
          return;
        }

        openMessageUser(
          event.data?.username,
        );
      };

    serviceWorker.addEventListener(
      "message",
      handleWorkerMessage,
    );

    return () => {
      serviceWorker.removeEventListener(
        "message",
        handleWorkerMessage,
      );
    };
  }, [
    openMessageUser,
  ]);


  const openSignIn = useCallback(() => {
    openAuth("signin");
  }, [openAuth]);

  const toggleCompact = useCallback(() => {
    setCompactMode((value) => !value);
  }, []);

  const handleAuthenticated =
  useCallback(
    (user) => {
      cancelPendingSearchSave();

      setCurrentUser(
        user,
      );

      setAuthOpen(
        false,
      );

      void restoreSavedAppView(
        user,
      );
    },
    [
      cancelPendingSearchSave,
      restoreSavedAppView,
    ],
  );

  const closeAuth = useCallback(() => {
    setAuthOpen(false);
  }, []);

  const continueAsGuest = useCallback(() => {
    setAuthOpen(false);
  }, []);

  return (
    <div className={appClassName}>
      <HexBackdrop idPrefix="auth-overlay-background" />

<DesktopSidebar
  activePage={activePage}
  currentUser={currentUser}
  onNavigate={navigate}
  onOpenAuth={() => {
    openAuth("signin");
  }}
/>

      <section className="main-workspace">
      <MobileHeader
    title={PAGE_TITLES[activePage]}
    currentUser={currentUser}
    onNavigate={navigate}
    onOpenAuth={openAuth}
    playlistUpdate={
      activePlaylistUpdate
    }
    onDownloadPlaylistUpdate={() => {
      void downloadActivePlaylistUpdate();
    }}
    onDismissPlaylistUpdate={
      dismissPlaylistUpdate
    }
    messageNotifications={
      messageNotifications
    }
    onOpenMessage={
      openMessageUser
    }
    onOpenNotification={
      openNotificationDetail
    }
    onDeleteNotification={
      deleteNotification
    }
    onEnablePush={() => {
      void handleEnablePush();
    }}
    pushBusy={
      pushBusy
    }
    pushEnabled={
      pushEnabled
    }
    />

        <DesktopTopbar
          activePage={activePage}
          searchQuery={searchQuery}
          onSearchChange={
            updateTopbarSearch
          }
          onSearchFocus={
            openSearchFromTopbar
          }
          currentUser={currentUser}
          onNavigate={navigate}
          onOpenAuth={() => {
            openAuth("signin");
          }}
        />

        <main className="main-content">
          <MainPage
            activePage={activePage}
            currentUser={currentUser}
            searchResetToken={searchResetToken}
            libraryResetToken={libraryResetToken}
            messagesResetToken={messagesResetToken}
            playlistToOpen={
            playlistToOpen
            }

            onOpenPlaylist={
            openPlaylistFromSearch
            }

            onPlaylistOpened={
            clearPlaylistToOpen
            }
            artistToOpen={
              artistToOpen
            }
            onArtistOpened={
              clearArtistToOpen
            }
            onOpenArtist={
              openArtistProfile
            }
            profileUsername={
              activeProfileUsername
            }
            onProfileUpdated={
              handleProfileUpdated
            }
            onOpenProfile={
              openUserProfile
            }
            onMessageUser={
              openMessageUser
            }
            messageUsername={
              messageToOpen
            }
            onMessageUsernameHandled={
              clearMessageToOpen
            }
            sharedMusicToSend={
              sharedMusicToSend
            }
            onSharedMusicHandled={
              clearSharedMusicToSend
            }
            onOpenSharedMusic={
              openSharedMusicFromMessage
            }
            onMessageNotificationsChanged={
              refreshMessageNotifications
            }
            onNavigate={navigate}
            onOpenAuth={() => {
              openAuth("signin");
            }}
            onLogout={handleLogout}
            query={searchQuery}
            onQueryChange={updateSearch}
            compactMode={compactMode}
            onToggleCompact={() => {
              setCompactMode(
                (value) => !value,
              );
            }}
            statusMessage={statusMessage}
            onStatusMessage={setStatusMessage}
            activePlaylistDownloads={
              activePlaylistDownloads
            }
            installState={
              installState
            }
            onInstallApp={
              handleInstallApp
            }
            playbackDevices={
              playbackDevices
            }
            currentPlaybackDeviceId={
              playbackDeviceIdRef.current
            }
            controlledPlaybackDeviceId={
              controlledPlaybackDeviceId
            }
            onSelectPlaybackDevice={
              selectControlledPlaybackDevice
            }
            onPlaybackDeviceCommand={
              sendAccountPlaybackCommand
            }
          />
        </main>
      </section>

      <DesktopRightRail
        currentUser={
          currentUser
        }
        onOpenAuth={
          openSignIn
        }
        accountPlaybackSnapshot={
          accountPlaybackSnapshot
        }
        currentPlaybackDeviceId={
          playbackDeviceIdRef.current
        }
      />

      <PlayerBar
        playlistUpdate={
          activePlaylistUpdate
        }
        onDownloadPlaylistUpdate={() => {
          void downloadActivePlaylistUpdate();
        }}
        onDismissPlaylistUpdate={
          dismissPlaylistUpdate
        }
        currentUser={
          currentUser
        }
        onOpenAuth={() => {
          openAuth("signin");
        }}
        messageNotifications={
          messageNotifications
        }
        onOpenMessage={
          openMessageUser
        }
        onOpenNotification={
          openNotificationDetail
        }
        onDeleteNotification={
          deleteNotification
        }
        onEnablePush={() => {
          void handleEnablePush();
        }}
        pushBusy={
          pushBusy
        }
        pushEnabled={
          pushEnabled
        }
        installState={
          installState
        }
        onInstallApp={
          handleInstallApp
        }
        playbackDevices={
          playbackDevices
        }
        currentPlaybackDeviceId={
          playbackDeviceIdRef.current
        }
        controlledPlaybackDeviceId={
          controlledPlaybackDeviceId
        }
        accountPlaybackSnapshot={
          accountPlaybackSnapshot
        }
        onSelectPlaybackDevice={
          selectControlledPlaybackDevice
        }
        onPlaybackDeviceCommand={
          sendAccountPlaybackCommand
        }
        onOpenPlayerDetails={() => {
          setMobilePlayerDetailsOpen(
            true,
          );
        }}
      />

      <MobilePlayerDetails
        open={
          mobilePlayerDetailsOpen
        }
        onClose={() => {
          setMobilePlayerDetailsOpen(
            false,
          );
        }}
        accountPlaybackSnapshot={
          accountPlaybackSnapshot
        }
        currentPlaybackDeviceId={
          playbackDeviceIdRef.current
        }
      />

      <MobileBottomNav
        activePage={activePage}
        onNavigate={navigate}
        currentUser={
          currentUser
        }
      />

      {mobileSeekFeedback ? (
        <div
          className={
            mobileSeekFeedback.side ===
              "back"
              ? "mobile-seek-feedback mobile-seek-feedback--back"
              : "mobile-seek-feedback mobile-seek-feedback--forward"
          }
          aria-hidden="true"
        >
          <strong>
            {mobileSeekFeedback.label}
          </strong>

          <span>
            seconds
          </span>
        </div>
      ) : null}

<AppInstallModal
  open={
    Boolean(
      installHelpMode,
    )
  }
  mode={
    installHelpMode
  }
  onClose={() => {
    setInstallHelpMode(
      "",
    );
  }}
/>

<NotificationDetailOverlay
  notification={
    notificationDetail
  }
  onClose={() => {
    setNotificationDetail(
      null,
    );
  }}
  onOpenMessage={
    openMessageUser
  }
  onOpenSharedMusic={
    openSharedMusicFromMessage
  }
/>

<AuthOverlay
  open={authOpen}
  mode={authMode}
  onModeChange={setAuthMode}
  onClose={() => {
    setAuthOpen(false);
  }}
  onAuthenticated={
    handleAuthenticated
  }
  onForgotPassword={() => {
    setAuthOpen(false);
    setRecoveryOpen(true);
  }}
  onGuest={() => {
    setAuthOpen(false);
  }}
/>

<PasswordRecoveryOverlay
  open={
    recoveryOpen
  }
  onClose={() => {
    setRecoveryOpen(false);
  }}
  onBackToSignIn={() => {
    setRecoveryOpen(false);
    openAuth("signin");
  }}
  onAuthenticated={
    handleAuthenticated
  }
  onPasswordReset={() => {
    setCurrentUser(null);
    setPushEnabled(false);
    setMessageNotifications({
      unread_count: 0,
      notifications: [],
    });
  }}
/>
    </div>
  );
}
