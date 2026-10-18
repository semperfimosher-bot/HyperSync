import {
  Activity,
  lazy,
  Suspense,
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
  readPersistedAppView,
  writePersistedAppView,
  clearPersistedAppView,
} from "./persistedAppView.js";

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

const HomePage = lazy(() => import("./components/pages/HomePage.jsx"));

const LibraryPage = lazy(() => import("./components/pages/LibraryPage.jsx"));

const SearchPage = lazy(() => import("./components/pages/SearchPage.jsx"));

const MessagesPage = lazy(() => import("./components/pages/MessagesPage.jsx"));

const ProfilePage = lazy(() => import("./components/pages/ProfilePage.jsx"));

const PublicProfilePage = lazy(() => import("./components/pages/PublicProfilePage.jsx"));

import SectionHeading from "./components/ui/SectionHeading.jsx";

const AdminUploadsPage = lazy(() => import("./components/pages/AdminUploadsPage.jsx"));
const AdminCatalogPage = lazy(() => import("./components/pages/AdminCatalogPage.jsx"));
const AdminDashboardPage = lazy(() => import("./components/pages/AdminDashboardPage.jsx"));

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
   * Keep app tabs alive for twelve hours; public profile instances also have
   * a recent-page count limit so profile browsing cannot retain unlimited UI.
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
                <Suspense fallback={<div role="status" className="page-stack">Loading page...</div>}>
                  {renderPage(entry.page, entry.profileUsername)}
                </Suspense>
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

  // Invalidates asynchronous saved-view/session restores after user navigation.
  const navigationGenerationRef = useRef(0);

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

        const currentTime = Number.isFinite(playerState.currentTime)
          ? playerState.currentTime : 0;
        const duration = Number.isFinite(playerState.duration) && playerState.duration > 0
          ? playerState.duration : Infinity;

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
    async (
      user,
      restoreGeneration =
        navigationGenerationRef.current,
    ) => {
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

      // Restore the last local view immediately. The server remains
      // authoritative and will replace this state when its request succeeds.
      const localView = readPersistedAppView(user?.id);
      if (localView) {
        const restoredLocal = normalizeAppViewState(
          localView,
          user?.role,
        );
        if (
          navigationGenerationRef.current ===
          restoreGeneration
        ) {
          setActivePage(restoredLocal.activePage);
          setSearchQuery(restoredLocal.searchQuery);
          setActiveProfileUsername(restoredLocal.profileUsername);
        }
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

        if (
          navigationGenerationRef.current !==
          restoreGeneration
        ) {
          return;
        }

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
        if (
          navigationGenerationRef.current !==
          restoreGeneration
        ) {
          return;
        }

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

      writePersistedAppView(currentUser.id, state);

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
  navigationGenerationRef.current += 1;
  cancelPendingSearchSave();
  clearPersistedAppView(currentUser?.id);

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
    // Capture before scheduling idle work so user navigation that happens
    // first invalidates this restore instead of being overwritten by it.
    const restoreGeneration =
      navigationGenerationRef.current;

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
      restoreGeneration,
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
      navigationGenerationRef.current += 1;
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

      const restoreGeneration =
        navigationGenerationRef.current;

      setCurrentUser(
        user,
      );

      setAuthOpen(
        false,
      );

      void restoreSavedAppView(
        user,
        restoreGeneration,
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
