import {
  Activity,
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { isAdminUser } from "./utils/user.js";
import Icon from "./components/ui/Icon.jsx";
import { ADMIN_NAV_ITEMS } from "./constants.js";
import {
  PAGE_WARM_SWEEP_MS,
  pruneWarmPages,
  touchWarmPage,
  warmPageKey,
} from "./pageWarmCache.js";

const loadHomePage = () => import("./components/pages/HomePage.jsx");
const HomePage = lazy(loadHomePage);
// Start fetching the default page during app bootstrap while keeping its code
// out of the main bundle's parse/evaluation path.
void loadHomePage().catch(() => {});
const LibraryPage = lazy(() => import("./components/pages/LibraryPage.jsx"));
const SearchPage = lazy(() => import("./components/pages/SearchPage.jsx"));
const MessagesPage = lazy(() => import("./components/pages/MessagesPage.jsx"));
const ProfilePage = lazy(() => import("./components/pages/ProfilePage.jsx"));
const PublicProfilePage = lazy(() => import("./components/pages/PublicProfilePage.jsx"));
const AdminUploadsPage = lazy(() => import("./components/pages/AdminUploadsPage.jsx"));
const AdminCatalogPage = lazy(() => import("./components/pages/AdminCatalogPage.jsx"));
const AdminDashboardPage = lazy(() => import("./components/pages/AdminDashboardPage.jsx"));

export default function MainPage({
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
                <Suspense
                  fallback={
                    <div
                      className="page-stack"
                      role="status"
                      aria-live="polite"
                      aria-busy="true"
                    >
                      Loading page…
                    </div>
                  }
                >
                  {renderPage(
                    entry.page,
                    entry.profileUsername,
                  )}
                </Suspense>
              </PageErrorBoundary>
            </Activity>
          ),
        )}
    </>
  );
}
