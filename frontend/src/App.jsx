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

import {
  clearAllHyperSyncClientData,
} from "./clientDataReset.js";

import {
  rememberResetGeneration,
} from "./globalResetSync.js";

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

import BrandLogo from "./components/ui/BrandLogo.jsx";

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

import {
  deleteCatalogTrack,
  deleteCatalogTracks,
  useCatalogTracks,
} from "./catalogStore.js";

import {
  addTrackGroupSelection,
  getTrackGroupSelectionState,
  pruneTrackSelection,
  toggleTrackGroupSelection,
  toggleTrackSelection,
} from "./catalogSelection.js";

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
} from "./offlineDownloads.js";

import {
  getPlaylist,
} from "./playlistApi.js";

import {
  findMissingPlaylistTracks,
  playlistUpdateKey,
} from "./playlistDownloadUpdates.js";

import {
  getMessageNotifications,
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

import AppInstallModal from
  "./components/ui/AppInstallModal.jsx";
const ACCOUNT_PLAYBACK_SYNC_INTERVAL_MS =
  3000;

const ACCOUNT_PLAYBACK_STALE_PLAYING_MS =
  15000;

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
   * A browser that disappears cannot keep
   * claiming to play forever. Only advance
   * a recent active-device heartbeat.
   */
  if (
    ageMs >
    ACCOUNT_PLAYBACK_STALE_PLAYING_MS
  ) {
    return base;
  }

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
function AdminBotPage() {
  const [status, setStatus] = useState("offline");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const refreshStatus = useCallback(async () => {
    setLoading(true);
    setMessage("");

    try {
      const data = await apiRequest("/admin/bot/status");

      setStatus(
        data?.status ||
          data?.state ||
          "offline",
      );
    } catch (error) {
      setStatus("offline");

      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to load bot status.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const sendBotAction = async (action) => {
    setLoading(true);
    setMessage("");

    try {
      if (action === "restart") {
        await apiRequest(
          "/admin/bot/stop",
          {
            method: "POST",
          },
        );

        await apiRequest(
          "/admin/bot/start",
          {
            method: "POST",
          },
        );
      } else {
        await apiRequest(
          `/admin/bot/${action}`,
          {
            method: "POST",
          },
        );
      }

      setMessage(
        `Bot ${action} command completed.`,
      );

      await refreshStatus();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Bot command failed.",
      );
    } finally {
      setLoading(false);
    }
  };

  const isOnline =
    status === "online" ||
    status === "running" ||
    status === "healthy";

  return (
    <div className="page-stack admin-page">
      <section className="admin-page__header">
        <span>ADMINISTRATION</span>

        <h2>Bot Control</h2>

      </section>

      <section className="admin-panel">
        <div className="admin-panel__heading">
          <div>
            <span>AUTOMATION</span>
            <h3>Bot Status</h3>
          </div>

          <span
            className={
              isOnline
                ? "admin-status admin-status--online"
                : "admin-status admin-status--offline"
            }
          >
            {isOnline ? "ONLINE" : "OFFLINE"}
          </span>
        </div>

        <div className="bot-status-card">
          <div className="bot-status-icon">
            <Icon
              name="chart"
              size={25}
            />
          </div>

          <div>
            <strong>
              HyperSynced Bot
            </strong>

            <p>
              Current status:{" "}
              {status}
            </p>
          </div>
        </div>
      </section>

      {message ? (
  <div className="admin-alert">
    <Icon
      name="shield"
      size={18}
    />

    <span>
      {message}
    </span>
  </div>
) : null}

      <section className="admin-panel">
        <div className="admin-panel__heading">
          <div>
            <span>CONTROLS</span>
            <h3>Bot Controls</h3>
          </div>
        </div>

        <div className="admin-quick-actions">
          <button
            type="button"
            className="admin-quick-action"
            disabled={loading}
            onClick={() =>
              sendBotAction("start")
            }
          >
            <span className="admin-quick-action__icon">
              <Icon
                name="play"
                size={20}
              />
            </span>

            <span>
              <strong>Start Bot</strong>
              <small>
                Start the automation service.
              </small>
            </span>
          </button>

          <button
            type="button"
            className="admin-quick-action"
            disabled={loading}
            onClick={() =>
              sendBotAction("stop")
            }
          >
            <span className="admin-quick-action__icon">
              <Icon
                name="close"
                size={20}
              />
            </span>

            <span>
              <strong>Stop Bot</strong>
              <small>
                Stop the automation service.
              </small>
            </span>
          </button>

          <button
            type="button"
            className="admin-quick-action"
            disabled={loading}
            onClick={() =>
              sendBotAction("restart")
            }
          >
            <span className="admin-quick-action__icon">
              <Icon
                name="chart"
                size={20}
              />
            </span>

            <span>
              <strong>Restart Bot</strong>
              <small>
                Restart the automation service.
              </small>
            </span>
          </button>

          <button
            type="button"
            className="admin-quick-action"
            disabled={loading}
            onClick={() =>
              sendBotAction("scan")
            }
          >
            <span className="admin-quick-action__icon">
              <Icon
                name="search"
                size={20}
              />
            </span>

            <span>
              <strong>Scan Catalog</strong>
              <small>
                Queue the real catalog scan job.
              </small>
            </span>
          </button>

          <button
            type="button"
            className="admin-quick-action"
            disabled={loading}
            onClick={() =>
              sendBotAction("process")
            }
          >
            <span className="admin-quick-action__icon">
              <Icon
                name="music"
                size={20}
              />
            </span>

            <span>
              <strong>Process Queue</strong>
              <small>
                Queue the real processing job.
              </small>
            </span>
          </button>
        </div>

        <button
          type="button"
          className="secondary-admin-button"
          disabled={loading}
          onClick={refreshStatus}
        >
          {loading
            ? "Refreshing..."
            : "Refresh Status"}

          <Icon
            name="chevron"
            size={14}
          />
        </button>
      </section>
    </div>
  );
}

  function AdminCatalogPage() {
  const {
    tracks,
    loading,
    error,
    refreshCatalog,
  } = useCatalogTracks();

  const [
    message,
    setMessage,
  ] = useState("");

  const [
    searchQuery,
    setSearchQuery,
  ] = useState("");

  const [
    category,
    setCategory,
  ] = useState(null);

  const [
    folderValue,
    setFolderValue,
  ] = useState(null);

  const [
    selectedTrackIds,
    setSelectedTrackIds,
  ] = useState(
    () =>
      new Set(),
  );

  const [
    bulkDeleteBusy,
    setBulkDeleteBusy,
  ] = useState(false);


  useEffect(() => {
    setSelectedTrackIds(
      (current) =>
        pruneTrackSelection(
          current,
          tracks,
        ),
    );
  }, [
    tracks,
  ]);


  const normalizedSearch =
    searchQuery
      .trim()
      .toLocaleLowerCase();


  const folderConfig = {
    artists: {
      label: "Artists",
      icon: "people",
      value:
        (track) =>
          track.artist ||
          "Unknown Artist",
    },

    albums: {
      label: "Albums",
      icon: "disc",
      value:
        (track) =>
          track.album ||
          "No Album",
    },

    genres: {
      label: "Genres",
      icon: "music",
      value:
        (track) =>
          track.genre ||
          "No Genre",
    },
  };


  const searchResults =
    useMemo(
      () => {
        if (!normalizedSearch) {
          return [];
        }

        return tracks.filter(
          (track) =>
            [
              track.title,
              track.artist,
              track.album,
              track.genre,
            ]
              .filter(Boolean)
              .some(
                (value) =>
                  String(value)
                    .toLocaleLowerCase()
                    .includes(
                      normalizedSearch,
                    ),
              ),
        );
      },
      [
        normalizedSearch,
        tracks,
      ],
    );


  const folders =
    useMemo(
      () => {
        if (!category) {
          return [];
        }

        const config =
          folderConfig[
            category
          ];

        if (!config) {
          return [];
        }

        const grouped =
          new Map();

        tracks.forEach(
          (track) => {
            const value =
              config.value(
                track,
              );

            const key =
              String(
                value,
              )
                .trim()
                .toLocaleLowerCase();

            if (
              !grouped.has(
                key,
              )
            ) {
              grouped.set(
                key,
                {
                  key,
                  value,
                  tracks: [],
                },
              );
            }

            grouped
              .get(
                key,
              )
              .tracks
              .push(
                track,
              );
          },
        );

        return Array.from(
          grouped.values(),
        ).sort(
          (
            left,
            right,
          ) =>
            String(
              left.value,
            ).localeCompare(
              String(
                right.value,
              ),
              undefined,
              {
                sensitivity:
                  "base",
              },
            ),
        );
      },
      [
        category,
        tracks,
      ],
    );


  const folderTracks =
    useMemo(
      () => {
        if (
          !category ||
          !folderValue
        ) {
          return [];
        }

        const config =
          folderConfig[
            category
          ];

        return tracks.filter(
          (track) =>
            String(
              config.value(
                track,
              ),
            )
              .trim()
              .toLocaleLowerCase()
              ===
            String(
              folderValue,
            )
              .trim()
              .toLocaleLowerCase(),
        );
      },
      [
        category,
        folderValue,
        tracks,
      ],
    );


  const visibleTrackIds =
    (
      normalizedSearch
        ? searchResults
        : folderValue
          ? folderTracks
          : []
    ).map(
      (track) =>
        String(
          track.id,
        ),
    );

  const selectedTrackCount =
    selectedTrackIds.size;


  const deleteSelectedTracks =
    async () => {
      if (
        bulkDeleteBusy ||
        selectedTrackCount ===
          0
      ) {
        return;
      }

      const requestedTrackIds =
        Array.from(
          selectedTrackIds,
        );

      setBulkDeleteBusy(
        true,
      );

      setMessage("");

      try {
        const result =
          await deleteCatalogTracks(
            requestedTrackIds,
          );

        const deletedTrackIds =
          new Set(
            (
              Array.isArray(
                result?.deleted_track_ids,
              )
                ? result.deleted_track_ids
                : []
            ).map(
              (trackId) =>
                String(
                  trackId,
                ),
            ),
          );

        setSelectedTrackIds(
          (current) =>
            new Set(
              Array.from(
                current,
              ).filter(
                (trackId) =>
                  !deletedTrackIds.has(
                    String(
                      trackId,
                    ),
                  ),
              ),
            ),
        );

        const failed =
          Array.isArray(
            result?.failed,
          )
            ? result.failed
            : [];

        if (
          failed.length >
          0
        ) {
          setMessage(
            `Deleted ${result?.deleted_count ?? deletedTrackIds.size} songs; ${failed.length} could not be deleted.`,
          );
        } else {
          setMessage(
            `Deleted ${result?.deleted_count ?? deletedTrackIds.size} selected songs.`,
          );

          setSelectedTrackIds(
            new Set(),
          );
        }

      } catch (deleteError) {
        setMessage(
          deleteError instanceof Error
            ? deleteError.message
            : "Unable to delete selected tracks.",
        );

      } finally {
        setBulkDeleteBusy(
          false,
        );
      }
    };


  const deleteTrack =
    async (
      track,
    ) => {
      setMessage("");

      try {
        await deleteCatalogTrack(
          track.id,
        );

        setSelectedTrackIds(
          (current) => {
            const next =
              new Set(
                current,
              );

            next.delete(
              String(
                track.id,
              ),
            );

            return next;
          },
        );

        setMessage(
          `Deleted "${track.title}".`,
        );
      } catch (deleteError) {
        setMessage(
          deleteError instanceof Error
            ? deleteError.message
            : "Unable to delete track.",
        );
      }
    };


  const renderFile =
    (
      track,
    ) => {
      const trackId =
        String(
          track.id,
        );

      const selected =
        selectedTrackIds.has(
          trackId,
        );

      return (
      <div
        className={
          selected
            ? "admin-explorer-file is-selected"
            : "admin-explorer-file"
        }
        key={track.id}
        onContextMenu={(
          event,
        ) => {
          event.preventDefault();

          if (
            bulkDeleteBusy
          ) {
            return;
          }

          setSelectedTrackIds(
            (current) =>
              toggleTrackSelection(
                current,
                trackId,
              ),
          );
        }}
      >
        <TrackArtwork
          src={track.artwork_url}
          alt={track.title}
          variant={1}
        />

        <div className="admin-explorer-file__copy">
          <strong>
            {track.title}
          </strong>

          <span>
            {track.artist}
            {" • "}
            {track.album ||
              "No album"}
            {" • "}
            {track.genre ||
              "No genre"}
          </span>
        </div>

        <span className="admin-explorer-file__type">
          {String(
            track.mime_type ||
              "audio",
          )
            .replace(
              "audio/",
              "",
            )
            .toUpperCase()}
        </span>

        <button
          type="button"
          className="danger-button"
          onClick={() => {
            void deleteTrack(
              track,
            );
          }}
        >
          Delete
        </button>
      </div>
      );
    };


  let explorerBody = null;

  if (loading) {
    explorerBody = (
      <div className="admin-empty-state">
        <Icon
          name="chart"
          size={28}
        />

        <strong>
          Loading catalog...
        </strong>
      </div>
    );

  } else if (
    normalizedSearch
  ) {
    explorerBody =
      searchResults.length > 0
        ? (
          <div className="admin-explorer-files">
            {searchResults.map(
              renderFile,
            )}
          </div>
        )
        : (
          <div className="admin-empty-state">
            <Icon
              name="search"
              size={28}
            />

            <strong>
              No files or folders match
            </strong>

            <p>
              Search title, artist,
              album, or genre.
            </p>
          </div>
        );

  } else if (!category) {
    explorerBody = (
      <div className="admin-explorer-folder-grid">
        {Object.entries(
          folderConfig,
        ).map(
          ([
            key,
            config,
          ]) => {
            const count =
              new Set(
                tracks.map(
                  (track) =>
                    String(
                      config.value(
                        track,
                      ),
                    )
                      .trim()
                      .toLocaleLowerCase(),
                ),
              ).size;

            return (
              <button
                type="button"
                className="admin-explorer-folder"
                key={key}
                onClick={() => {
                  setCategory(
                    key,
                  );

                  setFolderValue(
                    null,
                  );
                }}
              >
                <span className="admin-explorer-folder__icon">
                  <Icon
                    name={
                      config.icon
                    }
                    size={24}
                  />
                </span>

                <span>
                  <strong>
                    {config.label}
                  </strong>

                  <small>
                    {count}
                    {" folders"}
                  </small>
                </span>

                <Icon
                  name="chevron"
                  size={15}
                />
              </button>
            );
          },
        )}

      </div>
    );

  } else if (
    category &&
    !folderValue
  ) {
    explorerBody = (
      <div className="admin-explorer-folder-list">
        {folders.map(
          (folder) => {
            const folderTrackIds =
              folder.tracks.map(
                (track) =>
                  String(
                    track.id,
                  ),
              );

            const selectionState =
              getTrackGroupSelectionState(
                selectedTrackIds,
                folderTrackIds,
              );

            const artistSelectable =
              category ===
              "artists";

            const folderClassName =
              [
                "admin-explorer-folder",
                "admin-explorer-folder--row",
                selectionState.allSelected
                  ? "is-selected"
                  : "",
                selectionState.partiallySelected
                  ? "is-partial"
                  : "",
                artistSelectable
                  ? "is-multiselectable"
                  : "",
              ]
                .filter(
                  Boolean,
                )
                .join(
                  " ",
                );

            return (
            <button
              type="button"
              className={
                folderClassName
              }
              key={folder.key}
              onClick={() => {
                setFolderValue(
                  folder.value,
                );
              }}
              onContextMenu={(
                event,
              ) => {
                if (
                  !artistSelectable
                ) {
                  return;
                }

                event.preventDefault();

                if (
                  bulkDeleteBusy
                ) {
                  return;
                }

                setSelectedTrackIds(
                  (current) =>
                    toggleTrackGroupSelection(
                      current,
                      folderTrackIds,
                    ),
                );
              }}
              title={
                artistSelectable
                  ? "Right-click to select every song by this artist"
                  : undefined
              }
            >
              <span className="admin-explorer-folder__icon">
                <Icon
                  name={
                    folderConfig[
                      category
                    ].icon
                  }
                  size={20}
                />
              </span>

              <span>
                <strong>
                  {folder.value}
                </strong>

                <small>
                  {folder.tracks.length}
                  {" files"}

                  {artistSelectable &&
                  selectionState.selectedCount >
                    0
                    ? (
                        " • " +
                        selectionState.selectedCount +
                        " selected"
                      )
                    : ""}
                </small>
              </span>

              <Icon
                name="chevron"
                size={15}
              />
            </button>
            );
          },
        )}
      </div>
    );

  } else {
    explorerBody = (
      <div className="admin-explorer-files">
        {folderTracks.map(
          renderFile,
        )}
      </div>
    );
  }


  return (
    <div className="page-stack hs-search-page admin-page admin-catalog-explorer-page">
      <section className="hs-search-console admin-command-console">
        <div
          className="hs-search-console__grid"
          aria-hidden="true"
        />

        <div
          className="hs-search-console__ambient hs-search-console__ambient--one"
          aria-hidden="true"
        />

        <div className="hs-search-console__heading admin-command-console__heading">
          <div className="hs-search-console__intro">
            <div className="hs-search-console__eyebrow-row">
              <span className="hs-search-eyebrow">
                <i aria-hidden="true" />
                MEDIA STORAGE
              </span>
            </div>

            <h2>
              Catalog Explorer
            </h2>

            <p className="admin-command-console__copy">
              Browse the music catalog like a
              file system or search across
              artists, albums, genres, and tracks.
            </p>
          </div>

          <button
            type="button"
            className="hs-search-primary-action admin-refresh-button"
            disabled={loading}
            onClick={() => {
              refreshCatalog({
                force: true,
              });
            }}
          >
            <Icon
              name="chart"
              size={16}
            />

            {loading
              ? "Refreshing..."
              : "Refresh"}
          </button>
        </div>

        <label className="hs-search-input admin-explorer-search">
          <span className="hs-search-input__icon">
            <Icon
              name="search"
              size={17}
            />
          </span>

          <input
            type="search"
            value={searchQuery}
            placeholder="Search files, artists, albums, or genres..."
            onChange={(
              event,
            ) => {
              setSearchQuery(
                event.target.value,
              );
            }}
          />
        </label>

        <div className="admin-explorer-breadcrumb">
          <button
            type="button"
            onClick={() => {
              setCategory(null);
              setFolderValue(null);
              setSearchQuery("");
            }}
          >
            Catalog
          </button>

          {category ? (
            <>
              <Icon
                name="chevron"
                size={12}
              />

              <button
                type="button"
                onClick={() => {
                  setFolderValue(
                    null,
                  );

                  setSearchQuery(
                    "",
                  );
                }}
              >
                {folderConfig[
                  category
                ].label}
              </button>
            </>
          ) : null}

          {folderValue ? (
            <>
              <Icon
                name="chevron"
                size={12}
              />

              <span>
                {folderValue}
              </span>
            </>
          ) : null}

          {normalizedSearch ? (
            <>
              <Icon
                name="chevron"
                size={12}
              />

              <span>
                Search
              </span>
            </>
          ) : null}
        </div>
      </section>

      {message || error ? (
        <div className="admin-alert">
          <Icon
            name="shield"
            size={18}
          />

          <span>
            {message || error}
          </span>
        </div>
      ) : null}

      <section className="admin-panel admin-explorer-shell">
        <div className="admin-panel__heading">
          <div>
            <span>
              FILE EXPLORER
            </span>

            <h3>
              {normalizedSearch
                ? "Search Results"
                : folderValue ||
                  (
                    category
                      ? folderConfig[
                          category
                        ].label
                      : "Catalog Root"
                  )}
            </h3>
          </div>

          <strong className="admin-panel-count">
            {normalizedSearch
              ? searchResults.length
              : folderValue
                ? folderTracks.length
                : category
                  ? folders.length
                  : tracks.length}
            {" items"}
          </strong>
        </div>

        <div
          className={
            selectedTrackCount >
              0
              ? "admin-explorer-selection-bar is-active"
              : "admin-explorer-selection-bar"
          }
        >
          <span>
            {selectedTrackCount >
            0
              ? (
                  selectedTrackCount +
                  " songs selected"
                )
              : "Right-click songs or artist folders to select multiple items while you scroll."}
          </span>

          {selectedTrackCount >
          0 ? (
            <div className="admin-explorer-selection-bar__actions">
              {visibleTrackIds.length >
              0 ? (
                <button
                  type="button"
                  disabled={
                    bulkDeleteBusy
                  }
                  onClick={() => {
                    setSelectedTrackIds(
                      (current) =>
                        addTrackGroupSelection(
                          current,
                          visibleTrackIds,
                        ),
                    );
                  }}
                >
                  Select all shown
                </button>
              ) : null}

              <button
                type="button"
                disabled={
                  bulkDeleteBusy
                }
                onClick={() => {
                  setSelectedTrackIds(
                    new Set(),
                  );
                }}
              >
                Clear
              </button>

              <button
                type="button"
                className="danger-button"
                disabled={
                  bulkDeleteBusy
                }
                onClick={() => {
                  void deleteSelectedTracks();
                }}
              >
                {bulkDeleteBusy
                  ? (
                      "Deleting " +
                      selectedTrackCount +
                      "..."
                    )
                  : (
                      "Delete selected (" +
                      selectedTrackCount +
                      ")"
                    )}
              </button>
            </div>
          ) : null}
        </div>

        {explorerBody}
      </section>
    </div>
  );
}

function AdminDashboardPage({
  onNavigate,
}) {
  const [
    tracks,
    setTracks,
  ] = useState([]);

  const [
    diagnostics,
    setDiagnostics,
  ] = useState(null);

  const [
    botStatus,
    setBotStatus,
  ] = useState(null);

  const [
    duplicates,
    setDuplicates,
  ] = useState(null);

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    duplicateBusy,
    setDuplicateBusy,
  ] = useState(false);

  const [
    userQuery,
    setUserQuery,
  ] = useState("");

  const [
    userResults,
    setUserResults,
  ] = useState([]);

  const [
    userSearchBusy,
    setUserSearchBusy,
  ] = useState(false);

  const [
    userDeleteBusy,
    setUserDeleteBusy,
  ] = useState(null);

  const [
    message,
    setMessage,
  ] = useState("");

  const [
    lastChecked,
    setLastChecked,
  ] = useState(null);

  const [
    wipePassword,
    setWipePassword,
  ] = useState("");

  const [
    wipeConfirmation,
    setWipeConfirmation,
  ] = useState("");

  const [
    wipeBusy,
    setWipeBusy,
  ] = useState(false);

  const [
    wipeResult,
    setWipeResult,
  ] = useState("");


  const deleteAllData = useCallback(
    async () => {
      setMessage("");
      setWipeResult("");

      if (
        !wipePassword ||
        wipeConfirmation !==
          "DELETE ALL DATA"
      ) {
        setMessage(
          "Enter the admin reset password and type DELETE ALL DATA exactly.",
        );

        return;
      }

      const confirmed =
        window.confirm(
          "This permanently deletes ALL HyperSync database data and EVERY version of EVERY file in the configured B2 bucket. This also deletes the current admin account. Continue?",
        );

      if (!confirmed) {
        return;
      }

      setWipeBusy(true);

      try {
        const result =
          await apiRequest(
            "/admin/database/delete-all",
            {
              method:
                "POST",
              body:
                JSON.stringify({
                  password:
                    wipePassword,
                  confirmation:
                    wipeConfirmation,
                }),
            },
          );

        player.stopTrack();

        const clientReset =
          await clearAllHyperSyncClientData();

        rememberResetGeneration(
          result?.reset_generation,
        );

        setTracks([]);

        setWipeResult(
          `Deleted ${result?.deleted_row_count ?? 0} database rows, ${result?.deleted_b2_versions ?? 0} B2 file versions, ${clientReset.indexedDatabases.length} IndexedDB databases, and ${clientReset.cacheNames.length} browser caches.`,
        );

        setWipePassword("");
        setWipeConfirmation("");

        window.setTimeout(
          () => {
            window.location.replace(
              "/",
            );
          },
          250,
        );
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Unable to delete all data.",
        );
      } finally {
        setWipeBusy(false);
      }
    },
    [
      wipePassword,
      wipeConfirmation,
    ],
  );


  const loadDashboard =
    useCallback(
      async () => {
        setLoading(true);

        const results =
          await Promise.allSettled([
            apiRequest(
              "/catalog/tracks",
            ),
            apiRequest(
              "/admin/diagnostics",
            ),
            apiRequest(
              "/admin/bot/status",
            ),
          ]);

        const errors = [];

        if (
          results[0].status ===
          "fulfilled"
        ) {
          setTracks(
            results[0].value ||
              [],
          );
        } else {
          errors.push(
            "catalog",
          );
        }

        if (
          results[1].status ===
          "fulfilled"
        ) {
          setDiagnostics(
            results[1].value,
          );
        } else {
          setDiagnostics(null);
          errors.push(
            "diagnostics",
          );
        }

        if (
          results[2].status ===
          "fulfilled"
        ) {
          setBotStatus(
            results[2].value,
          );
        } else {
          setBotStatus(null);
          errors.push(
            "bot",
          );
        }

        setLastChecked(
          new Date(),
        );

        setMessage(
          errors.length > 0
            ? `Could not refresh: ${errors.join(", ")}.`
            : "",
        );

        setLoading(false);
      },
      [],
    );


  const runDuplicateCheck =
    useCallback(
      async () => {
        setDuplicateBusy(true);
        setMessage("");

        try {
          const result =
            await apiRequest(
              "/admin/duplicates",
            );

          setDuplicates(
            result,
          );
        } catch (error) {
          setMessage(
            error instanceof Error
              ? error.message
              : "Duplicate scan failed.",
          );
        } finally {
          setDuplicateBusy(false);
        }
      },
      [],
    );


  useEffect(() => {
    const term =
      userQuery.trim();

    if (!term) {
      setUserResults([]);
      setUserSearchBusy(false);

      return undefined;
    }

    let cancelled = false;

    const timer =
      window.setTimeout(
        async () => {
          setUserSearchBusy(
            true,
          );

          try {
            const result =
              await apiRequest(
                `/admin/users?q=${encodeURIComponent(
                  term,
                )}`,
              );

            if (!cancelled) {
              setUserResults(
                result?.users ||
                  [],
              );
            }
          } catch (searchError) {
            if (!cancelled) {
              setUserResults([]);

              setMessage(
                searchError instanceof Error
                  ? searchError.message
                  : "User search failed.",
              );
            }
          } finally {
            if (!cancelled) {
              setUserSearchBusy(
                false,
              );
            }
          }
        },
        220,
      );

    return () => {
      cancelled = true;

      window.clearTimeout(
        timer,
      );
    };
  }, [
    userQuery,
  ]);


  const deleteUserAccount =
    useCallback(
      async (
        foundUser,
      ) => {
        setUserDeleteBusy(
          foundUser.id,
        );

        setMessage("");

        try {
          const result =
            await apiRequest(
              `/admin/users/${foundUser.id}`,
              {
                method:
                  "DELETE",
              },
            );

          setUserResults(
            (current) =>
              current.filter(
                (entry) =>
                  entry.id !==
                  foundUser.id,
              ),
          );

          setMessage(
            result?.message ||
              `Deleted @${foundUser.username}.`,
          );
        } catch (deleteError) {
          setMessage(
            deleteError instanceof Error
              ? deleteError.message
              : "Unable to delete user.",
          );
        } finally {
          setUserDeleteBusy(
            null,
          );
        }
      },
      [],
    );


  useEffect(() => {
    void loadDashboard();

    const interval =
      window.setInterval(
        () => {
          void loadDashboard();
        },
        30000,
      );

    return () => {
      window.clearInterval(
        interval,
      );
    };
  }, [
    loadDashboard,
  ]);


  const artistCount =
    useMemo(
      () =>
        new Set(
          tracks
            .map(
              (track) =>
                track.artist,
            )
            .filter(Boolean),
        ).size,
      [
        tracks,
      ],
    );

  const albumCount =
    useMemo(
      () =>
        new Set(
          tracks
            .map(
              (track) =>
                track.album,
            )
            .filter(Boolean),
        ).size,
      [
        tracks,
      ],
    );

  const artworkCount =
    useMemo(
      () =>
        tracks.filter(
          (track) =>
            Boolean(
              track.artwork_url,
            ),
        ).length,
      [
        tracks,
      ],
    );

  const apiHealthy =
    diagnostics?.api
      ?.healthy === true;

  const databaseHealthy =
    diagnostics?.database
      ?.healthy === true;

  const storageHealthy =
    diagnostics?.storage
      ?.healthy === true;

  const catalogHealthy =
    diagnostics?.catalog
      ?.healthy === true;

  const botReachable =
    diagnostics?.bot
      ?.healthy === true;

  const botRunning =
    Boolean(
      botStatus?.running ??
      diagnostics?.bot
        ?.running,
    );

  const duplicateCount =
    duplicates
      ?.duplicate_group_count ??
    diagnostics?.catalog
      ?.duplicate_groups ??
    0;

  const coreHealthy =
    apiHealthy &&
    databaseHealthy &&
    storageHealthy;


  return (
    <div className="page-stack hs-search-page admin-dashboard-page admin-dashboard-page--revamped">

      <section className="hs-search-console admin-command-console">
        <div
          className="hs-search-console__grid"
          aria-hidden="true"
        />

        <div
          className="hs-search-console__ambient hs-search-console__ambient--one"
          aria-hidden="true"
        />

        <div
          className="hs-search-console__ambient hs-search-console__ambient--two"
          aria-hidden="true"
        />

        <div className="hs-search-console__heading admin-command-console__heading">
          <div className="hs-search-console__intro">
            <div className="hs-search-console__eyebrow-row">
              <span className="hs-search-eyebrow">
                <i aria-hidden="true" />
                HYPERSYNCED ADMIN
              </span>
            </div>

            <h2>
              Control Center
            </h2>

            <p className="admin-command-console__copy">
              Live system checks, catalog tools,
              automation controls, upload access,
              and maintenance in one console.
            </p>
          </div>

          <button
            type="button"
            className="hs-search-primary-action admin-refresh-button"
            onClick={() => {
              void loadDashboard();
            }}
            disabled={loading}
          >
            <Icon
              name="chart"
              size={16}
            />

            {loading
              ? "Checking..."
              : "Refresh Systems"}
          </button>
        </div>

        <div className="hs-search-console__status admin-command-status">
          <span className="hs-search-status-chip hs-search-status-chip--primary">
            <i
              className={
                coreHealthy
                  ? "admin-blue-light is-on"
                  : "admin-blue-light"
              }
            />

            {coreHealthy
              ? "CORE SYSTEMS ONLINE"
              : "SYSTEM CHECK NEEDED"}
          </span>

          <span className="hs-search-status-chip">
            {storageHealthy
              ? "B2 CONNECTED"
              : "B2 CHECK"}
          </span>

          <span className="hs-search-status-chip">
            {lastChecked
              ? `CHECKED ${lastChecked.toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}`
              : "CHECKING"}
          </span>
        </div>
      </section>


      {message ? (
        <div className="admin-alert">
          <Icon
            name="shield"
            size={18}
          />

          <span>
            {message}
          </span>
        </div>
      ) : null}


      <section className="admin-stat-grid admin-stat-grid--revamped">
        <AdminStatCard
          icon="music"
          label="Published Tracks"
          value={tracks.length}
          detail="Live catalog count"
        />

        <AdminStatCard
          icon="people"
          label="Artists"
          value={artistCount}
          detail="Unique artists"
        />

        <AdminStatCard
          icon="disc"
          label="Albums"
          value={albumCount}
          detail="Unique albums"
        />

        <AdminStatCard
          icon="mountains"
          label="Artwork"
          value={
            tracks.length
              ? `${Math.round(
                  (
                    artworkCount /
                    tracks.length
                  ) *
                    100,
                )}%`
              : "0%"
          }
          detail={
            `${artworkCount} covered`
          }
        />

        <AdminStatCard
          icon="shield"
          label="Duplicate Groups"
          value={duplicateCount}
          detail={
            duplicates
              ? `${duplicates.scanned_tracks ?? tracks.length} scanned`
              : "Run duplicate check"
          }
        />
      </section>


      <section className="admin-dashboard-grid admin-dashboard-grid--revamped">
        <article className="admin-panel admin-health-panel admin-panel--interactive">
          <div className="admin-panel__heading">
            <div>
              <span>LIVE DIAGNOSTICS</span>
              <h3>Service Matrix</h3>
            </div>

            <span
              className={
                coreHealthy
                  ? "admin-status admin-status--online"
                  : "admin-status admin-status--offline"
              }
            >
              {coreHealthy
                ? "HEALTHY"
                : "CHECK"}
            </span>
          </div>

          <div className="admin-health-list">
            <AdminHealthRow
              label="Admin API"
              value={
                apiHealthy
                  ? "Responding"
                  : "Unavailable"
              }
              healthy={apiHealthy}
            />

            <AdminHealthRow
              label="Database"
              value={
                databaseHealthy
                  ? "Connected"
                  : "Unavailable"
              }
              healthy={
                databaseHealthy
              }
            />

            <AdminHealthRow
              label="B2 Storage"
              value={
                storageHealthy
                  ? "Connected"
                  : "Unavailable"
              }
              healthy={
                storageHealthy
              }
            />

            <AdminHealthRow
              label="Catalog"
              value={
                catalogHealthy
                  ? `${diagnostics?.catalog?.track_count ?? tracks.length} tracks`
                  : "Unavailable"
              }
              healthy={
                catalogHealthy
              }
            />

            <AdminHealthRow
              label="Bot Service"
              value={
                botRunning
                  ? "Running"
                  : (
                      botReachable
                        ? "Ready / stopped"
                        : "Unavailable"
                    )
              }
              healthy={
                botReachable
              }
            />
          </div>
        </article>


        <article className="admin-panel admin-panel--interactive">
          <div className="admin-panel__heading">
            <div>
              <span>AUTOMATION</span>
              <h3>Bot Telemetry</h3>
            </div>

            <span
              className={
                botRunning
                  ? "admin-status admin-status--online"
                  : "admin-status admin-status--offline"
              }
            >
              {botRunning
                ? "RUNNING"
                : "STOPPED"}
            </span>
          </div>

          <div className="bot-status-card">
            <div className="bot-status-icon">
              <Icon
                name="chart"
                size={25}
              />
            </div>

            <div>
              <strong>
                HyperSynced Bot
              </strong>

              <p>
                {botStatus?.current_job
                  ? `Working: ${botStatus.current_job}`
                  : `${botStatus?.queued_jobs ?? 0} queued • ${botStatus?.completed_jobs ?? 0} completed • ${botStatus?.failed_jobs ?? 0} failed`}
              </p>
            </div>
          </div>

          <button
            type="button"
            className="secondary-admin-button"
            onClick={() => {
              onNavigate(
                "admin-bot",
              );
            }}
          >
            Open Bot Controls

            <Icon
              name="chevron"
              size={14}
            />
          </button>
        </article>
      </section>


      <section className="admin-tool-deck">
        <div className="admin-tool-deck__heading">
          <div>
            <span>ADMIN TOOLS</span>
            <h3>Operations Deck</h3>
          </div>

          <small>
            Blue lights mean the supporting
            service responded successfully.
          </small>
        </div>

        <div className="admin-quick-actions admin-quick-actions--four">
          <AdminQuickAction
            icon="plus"
            title="Upload Studio"
            description="Upload and process music."
            active={
              apiHealthy &&
              storageHealthy
            }
            status={
              storageHealthy
                ? "READY"
                : "CHECK"
            }
            onClick={() => {
              onNavigate(
                "admin-uploads",
              );
            }}
          />

          <AdminQuickAction
            icon="music"
            title="Media Catalog"
            description="Browse artists, albums, genres, and files."
            active={
              catalogHealthy
            }
            status={
              catalogHealthy
                ? "READY"
                : "CHECK"
            }
            onClick={() => {
              onNavigate(
                "admin-catalog",
              );
            }}
          />

          <AdminQuickAction
            icon="chart"
            title="Bot Control"
            description="Run automation and processing."
            active={
              botReachable
            }
            status={
              botReachable
                ? "READY"
                : "CHECK"
            }
            onClick={() => {
              onNavigate(
                "admin-bot",
              );
            }}
          />

          <AdminQuickAction
            icon="shield"
            title="Duplicate Check"
            description="Scan normalized title + artist identities."
            active={
              duplicates !== null &&
              duplicateCount === 0
            }
            status={
              duplicateBusy
                ? "SCANNING"
                : duplicates
                  ? (
                      duplicateCount === 0
                        ? "CLEAN"
                        : `${duplicateCount} FOUND`
                    )
                  : "RUN"
            }
            onClick={() => {
              document
                .getElementById(
                  "admin-duplicate-tool",
                )
                ?.scrollIntoView({
                  behavior:
                    "smooth",
                  block:
                    "start",
                });

              void runDuplicateCheck();
            }}
          />
        </div>
      </section>


      <section
        id="admin-duplicate-tool"
        className="admin-panel admin-duplicate-panel admin-panel--interactive"
      >
        <div className="admin-panel__heading">
          <div>
            <span>CATALOG INTEGRITY</span>
            <h3>Duplicate Check</h3>
          </div>

          <button
            type="button"
            className="secondary-admin-button admin-inline-button"
            disabled={
              duplicateBusy
            }
            onClick={() => {
              void runDuplicateCheck();
            }}
          >
            {duplicateBusy
              ? "Scanning..."
              : "Scan Catalog"}
          </button>
        </div>

        {duplicates === null ? (
          <div className="admin-duplicate-idle">
            <span className="admin-tool-light" />
            <div>
              <strong>
                Ready to scan
              </strong>
              <p>
                Uses the same normalized title and
                artist identity check used by the
                upload duplicate guard.
              </p>
            </div>
          </div>
        ) : duplicates.groups?.length ? (
          <div className="admin-duplicate-list">
            {duplicates.groups.map(
              (group) => (
                <div
                  className="admin-duplicate-group"
                  key={
                    `${group.artist_key}:${group.title_key}`
                  }
                >
                  <span className="admin-tool-light is-warning" />

                  <div>
                    <strong>
                      {group.title}
                    </strong>

                    <small>
                      {group.artist}
                      {" • "}
                      {group.count}
                      {" matching tracks"}
                    </small>
                  </div>

                  <span>
                    {group.tracks
                      ?.map(
                        (track) =>
                          track.album ||
                          "No album",
                      )
                      .join(" • ")}
                  </span>
                </div>
              ),
            )}
          </div>
        ) : (
          <div className="admin-duplicate-idle is-clean">
            <span className="admin-tool-light is-on" />

            <div>
              <strong>
                Catalog is clean
              </strong>

              <p>
                {duplicates.scanned_tracks ?? 0}
                {" tracks scanned with no normalized duplicates found."}
              </p>
            </div>
          </div>
        )}
      </section>


      <section className="admin-panel admin-user-manager admin-panel--interactive">
        <div className="admin-panel__heading">
          <div>
            <span>USER ADMINISTRATION</span>
            <h3>Find & Delete Account</h3>
          </div>

          <span className="admin-status admin-status--online">
            ADMIN ONLY
          </span>
        </div>

        <p className="admin-user-manager__copy">
          Search registered accounts by username,
          display name, or email. Deleting an
          account removes its server-side account
          rows and profile avatar storage.
        </p>

        <label className="hs-search-input admin-user-search">
          <span className="hs-search-input__icon">
            <Icon
              name="search"
              size={17}
            />
          </span>

          <input
            type="search"
            value={userQuery}
            placeholder="Search username, display name, or email..."
            onChange={(
              event,
            ) => {
              setUserQuery(
                event.target.value,
              );
            }}
          />
        </label>

        {userSearchBusy ? (
          <div className="admin-user-search-state">
            <span className="library-spinner" />
            <span>
              Searching accounts...
            </span>
          </div>
        ) : userQuery.trim() &&
          userResults.length === 0 ? (
          <div className="admin-user-search-state">
            <Icon
              name="people"
              size={18}
            />

            <span>
              No matching accounts.
            </span>
          </div>
        ) : (
          <div className="admin-user-results">
            {userResults.map(
              (foundUser) => (
                <div
                  className="admin-user-result"
                  key={foundUser.id}
                >
                  <span className="admin-user-result__avatar">
                    {foundUser.has_avatar ? (
                      <img
                        src={
                          `/api/users/${encodeURIComponent(
                            foundUser.username,
                          )}/avatar`
                        }
                        alt=""
                      />
                    ) : (
                      <Icon
                        name="people"
                        size={18}
                      />
                    )}
                  </span>

                  <div className="admin-user-result__copy">
                    <strong>
                      {foundUser.display_name}
                    </strong>

                    <span>
                      {"@"}
                      {foundUser.username}
                      {" • "}
                      {foundUser.email}
                    </span>
                  </div>

                  <span className="admin-user-result__role">
                    {String(
                      foundUser.role,
                    ).toUpperCase()}
                  </span>

                  <button
                    type="button"
                    className="danger-button"
                    disabled={
                      foundUser.is_current_admin ||
                      userDeleteBusy ===
                        foundUser.id
                    }
                    onClick={() => {
                      void deleteUserAccount(
                        foundUser,
                      );
                    }}
                  >
                    {foundUser.is_current_admin
                      ? "Current Admin"
                      : userDeleteBusy ===
                          foundUser.id
                        ? "Deleting..."
                        : "Delete Account"}
                  </button>
                </div>
              ),
            )}
          </div>
        )}
      </section>


      <section className="admin-panel admin-danger-zone admin-danger-zone--bottom">
        <div className="admin-panel__heading">
          <div>
            <span>DANGER ZONE</span>
            <h3>Delete All System Data</h3>
          </div>

          <span className="admin-status admin-status--danger">
            IRREVERSIBLE
          </span>
        </div>

        <p className="admin-danger-zone__copy">
          Permanently delete every application row
          and every version of every object in the
          configured B2 bucket. Database schema and
          migrations remain intact.
        </p>

        <div className="admin-danger-zone__form">
          <label>
            <span>
              Verification password
            </span>

            <input
              type="password"
              name="hypersync_admin_reset_code"
              autoComplete="one-time-code"
              data-1p-ignore="true"
              data-lpignore="true"
              value={wipePassword}
              onChange={(event) => {
                setWipePassword(
                  event.target.value,
                );
              }}
              placeholder="Enter password"
              disabled={wipeBusy}
            />
          </label>

          <label>
            <span>
              Type DELETE ALL DATA
            </span>

            <input
              type="text"
              autoComplete="off"
              value={wipeConfirmation}
              onChange={(event) => {
                setWipeConfirmation(
                  event.target.value,
                );
              }}
              placeholder="DELETE ALL DATA"
              disabled={wipeBusy}
            />
          </label>

          <button
            type="button"
            className="danger-button admin-danger-zone__button"
            disabled={
              wipeBusy ||
              !wipePassword ||
              wipeConfirmation !==
                "DELETE ALL DATA"
            }
            onClick={() => {
              void deleteAllData();
            }}
          >
            {wipeBusy
              ? "Deleting everything..."
              : "Delete DB + B2 Data"}
          </button>
        </div>

        {wipeResult ? (
          <p className="admin-danger-zone__result">
            {wipeResult}
          </p>
        ) : null}
      </section>

    </div>
  );
}

function AdminStatCard({
  icon,
  label,
  value,
  detail,
}) {
  return (
    <article className="admin-stat-card">
      <div className="admin-stat-card__icon">
        <Icon
          name={icon}
          size={19}
        />
      </div>

      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function AdminHealthRow({
  label,
  value,
  healthy,
}) {
  return (
    <div className="admin-health-row">
      <span>{label}</span>

      <div>
        <i
          className={
            healthy
              ? "admin-health-dot admin-health-dot--ok"
              : "admin-health-dot"
          }
        />

        <strong>{value}</strong>
      </div>
    </div>
  );
}

function AdminQuickAction({
  icon,
  title,
  description,
  onClick,
  active = false,
  status = "",
}) {
  return (
    <button
      type="button"
      className="admin-quick-action admin-quick-action--status"
      onClick={onClick}
    >
      <span className="admin-quick-action__icon">
        <Icon
          name={icon}
          size={20}
        />
      </span>

      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>

      <span className="admin-quick-action__state">
        <i
          className={
            active
              ? "admin-tool-light is-on"
              : "admin-tool-light"
          }
        />

        <small>
          {status}
        </small>
      </span>
    </button>
  );
}

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
  onOpenProfile,
  onMessageUser,
  messageUsername,
  onMessageUsernameHandled,
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
   * Keep visited pages alive for two hours.
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
                only to HyperSync
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
                to registered HyperSync accounts.
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
            onQueryChange
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
            onQueryChange
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
  onEnablePush,
  pushBusy,
  pushEnabled,
  installState,
  onInstallApp,
}) {
  const trackActionMenu =
    useTrackActionMenu();

  const [
    notificationsOpen,
    setNotificationsOpen,
  ] = useState(false);
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


  const toggle =
    useCallback(
      async () => {
        try {
          await player.togglePlay();
        } catch {
          // Browser autoplay restrictions
          // can prevent playback.
        }
      },
      [],
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

  const titleText =
    state.title ||
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
    state.artist
      ? [
          state.artist,
          state.album ||
            "",
        ]
          .filter(Boolean)
          .join(" • ")
      : state.src
        ? "Now playing"
        : "Select a track to start listening";

  const canControl =
    Boolean(state.src);

  const progressMax =
    state.duration > 0
      ? state.duration
      : 1;

  const progressValue =
    Math.min(
      Math.max(
        state.currentTime || 0,
        0,
      ),
      progressMax,
    );

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

  const currentTrackAction =
    state.trackId
      ? {
          id:
            state.trackId,
          title:
            state.title ??
            currentQueueTrack?.meta
              ?.title ??
            "",
          artist:
            state.artist ??
            currentQueueTrack?.meta
              ?.artist ??
            "",
          album:
            state.album ??
            currentQueueTrack?.meta
              ?.album ??
            "",
          audio_url:
            currentQueueTrack?.meta
              ?.audioUrl ??
            null,
          artwork_url:
            state.artworkUrl ??
            currentQueueTrack?.meta
              ?.artworkUrl ??
            null,
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

  return (
    <section
      className="player-bar"
      aria-label="Player"
    >

      {/* =================================================
          LEFT - CURRENT TRACK
          ================================================= */}

      <div
        className="player-bar__track"
        {...(
          currentTrackAction
            ? trackActionMenu.getTriggerProps(
                currentTrackAction,
              )
            : {}
        )}
      >

        <TrackArtwork
          src={state.artworkUrl}
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
            onClick={() =>
              player.seekTo(0)
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
              state.paused
                ? "Play"
                : "Pause"
            }
          >
            <Icon
              name={
                state.paused
                  ? "play"
                  : "pause"
              }
              size={20}
            />
          </button>


          <button
            type="button"
            onClick={() => {
              void player.skipToNext();
            }}
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
              state.currentTime,
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

    player.seekTo(
      value,
    );
  }}
/>


          <span>
            {formatTime(
              state.duration,
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
                onOpenMessage={(
                  username,
                ) => {
                  setNotificationsOpen(
                    false,
                  );

                  onOpenMessage?.(
                    username,
                  );
                }}
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

      <button
        className="mobile-player-control"
        type="button"
        onClick={toggle}
        disabled={!canControl}
        aria-label="Playback"
      >
        <Icon
          name={
            state.paused
              ? "play"
              : "pause"
          }
          size={19}
        />
      </button>


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
              ? "Create your HyperSync account"
              : "Welcome to HyperSynced"}
          </h2>

          <p>
            {isCreate
              ? (
                "Create a HyperSync account to save " +
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
              placeholder="Username"
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
                  setMessage(
                    "Password recovery is not " +
                    "implemented yet.",
                  );
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
    messageToOpen,
    setMessageToOpen,
  ] = useState("");

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

  const [authOpen, setAuthOpen] =
    useState(
      () => (
        !shouldRestoreSession() &&
        !readCachedUserProfile()
      ),
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

  const playbackDeviceIdRef =
    useRef(
      getAccountPlaybackDeviceId(),
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
    });

  const playbackWriteInFlightRef =
    useRef(false);

  const playbackPendingWriteRef =
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

        const currentTime =
          Number.isFinite(
            playerState.currentTime,
          )
            ? playerState.currentTime
            : 0;

        const duration =
          Number.isFinite(
            playerState.duration,
          ) &&
          playerState.duration >
            0
            ? playerState.duration
            : Infinity;

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

      return undefined;
    }

    let cancelled =
      false;

    let unsubscribe =
      null;

    let pollInterval =
      null;

    const deviceId =
      playbackDeviceIdRef.current;

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
          return;
        }

        if (
          playbackWriteInFlightRef
            .current
        ) {
          playbackPendingWriteRef.current =
            state;

          return;
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
                      state?.trackId ??
                      null,

                    position_seconds:
                      Math.max(
                        Number(
                          state?.currentTime ??
                          0,
                        ) || 0,
                        0,
                      ),

                    paused:
                      state?.trackId
                        ? Boolean(
                            state.paused,
                          )
                        : true,

                    device_id:
                      deviceId,
                  }),
              },
            );

          if (cancelled) {
            return;
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

          markPublished(
            state,
          );
        } catch {
          // Playback remains fully usable
          // if account sync is temporarily
          // unavailable.
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

        const now =
          Date.now();

        return (
          trackId !==
            previous.trackId ||
          paused !==
            previous.paused ||
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

        if (
          snapshot?.device_id ===
            deviceId
        ) {
          return;
        }

        playbackApplyingRemoteRef.current =
          true;

        try {
          if (
            snapshot?.track?.id
          ) {
            await player
              .restoreAccountPlayback(
                snapshot.track,
                accountPlaybackPosition(
                  snapshot,
                ),
              );
          } else {
            player.stopTrack();
          }

          markPublished(
            player.getState(),
          );
        } finally {
          playbackApplyingRemoteRef.current =
            false;
        }
      };

    const fetchRemotePlayback =
      async () => {
        if (
          cancelled ||
          globalThis.navigator
            ?.onLine ===
            false
        ) {
          return null;
        }

        try {
          const snapshot =
            await apiRequest(
              "/users/me/playback-state",
            );

          if (cancelled) {
            return null;
          }

          await applyRemotePlayback(
            snapshot,
          );

          return snapshot;
        } catch {
          return null;
        }
      };

    const bootstrap =
      async () => {
        const remote =
          await fetchRemotePlayback();

        if (cancelled) {
          return;
        }

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
              void fetchRemotePlayback();
            },
            ACCOUNT_PLAYBACK_SYNC_INTERVAL_MS,
          );
      };

    void bootstrap();

    const handleFocus =
      () => {
        void fetchRemotePlayback();
      };

    const handleVisibility =
      () => {
        if (
          document.visibilityState ===
            "visible"
        ) {
          void fetchRemotePlayback();
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

      playbackPendingWriteRef.current =
        null;

      window.removeEventListener(
        "focus",
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
    currentUser?.account_type,
    currentUser?.id,
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

  logoutSession();

  setCurrentUser(null);
  setPlaylistUpdates([]);
  setMessageToOpen("");
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
        ] ?? "HyperSync";

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
        onOpenAuth={() => {
          openAuth("signin");
        }}
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
  onGuest={() => {
    setAuthOpen(false);
  }}
/>
    </div>
  );
}
