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

import NotificationDetailOverlay from
  "./components/ui/NotificationDetailOverlay.jsx";

import PageErrorBoundary from
  "./components/ui/PageErrorBoundary.jsx";

import PlayerBar from
  "./components/player/PlayerBar.jsx";

import MobilePlayerDetails from
  "./components/player/MobilePlayerDetails.jsx";

import BrandLogo from "./components/ui/BrandLogo.jsx";

import PasswordRecoveryOverlay, {
  readPasswordRecoveryLinkFromLocation,
  readPasswordResetTokenFromLocation,
} from "./components/auth/PasswordRecoveryOverlay.jsx";

import MobileHeader from "./components/layout/MobileHeader.jsx";

import MobileBottomNav from
  "./components/layout/MobileBottomNav.jsx";

import AuthOverlay from
  "./components/auth/AuthOverlay.jsx";

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
  getOfflineOwnerKey,
  removeAllOfflineDownloadsForOwner,
} from "./offlineDownloads.js";

import {
  clearCachedLibraryScope,
} from "./libraryCache.js";

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
  accountPlaybackPosition,
  playbackUpdatedAtMs,
} from "./playbackClock.js";

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

import useMessageNotifications from
  "./hooks/useMessageNotifications.js";

import useDownloadedPlaylistUpdates from
  "./hooks/useDownloadedPlaylistUpdates.js";

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
              <PageErrorBoundary>
                {renderPage(
                  entry.page,
                  entry.profileUsername,
                )}
              </PageErrorBoundary>
            </Activity>
          ),
        )}
    </>
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

  const {
    activePlaylistDownloads,
    activePlaylistUpdate,
    dismissPlaylistUpdate,
    downloadActivePlaylistUpdate,
    resetDownloadedPlaylistUpdates,
  } = useDownloadedPlaylistUpdates({
    currentUser,
    onStatusMessage:
      setStatusMessage,
  });

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
  resetDownloadedPlaylistUpdates();
  setMessageToOpen("");
  setArtistToOpen("");
  resetMessageNotifications();
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


  const {
    messageNotifications,
    notificationDetail,
    pushBusy,
    pushEnabled,
    refreshMessageNotifications,
    openNotificationDetail,
    closeNotificationDetail,
    deleteNotification,
    handleEnablePush,
    resetMessageNotifications,
  } = useMessageNotifications({
    currentUser,
    onRequireSignIn:
      () => {
        openAuth(
          "signin",
        );
      },
    onStatusMessage:
      setStatusMessage,
  });


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
  onClose={
    closeNotificationDetail
  }
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
    resetMessageNotifications();
  }}
/>
    </div>
  );
}
