import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import * as player from "../../audioPlayer.js";

import {
  apiRequest,
} from "../../api/client.js";

import {
  clearAllHyperSyncClientData,
} from "../../clientDataReset.js";

import {
  rememberResetGeneration,
} from "../../globalResetSync.js";

import {
  deleteCatalogTracks,
} from "../../catalogStore.js";

import {
  duplicateTrackIdsToDelete,
} from "../../duplicateCleanup.js";

import Icon from "../ui/Icon.jsx";


function AdminDashboardPage({
  onNavigate,
}) {
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
    duplicateDeleteBusy,
    setDuplicateDeleteBusy,
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
          "This permanently deletes ALL HyperSynced database data and EVERY version of EVERY file in the configured B2 bucket. This also deletes the current admin account. Continue?",
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
          setDiagnostics(
            results[0].value,
          );
        } else {
          setDiagnostics(null);
          errors.push(
            "diagnostics",
          );
        }

        if (
          results[1].status ===
          "fulfilled"
        ) {
          setBotStatus(
            results[1].value,
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


  const duplicateDeleteTrackIds =
    useMemo(
      () =>
        duplicateTrackIdsToDelete(
          duplicates,
        ),
      [
        duplicates,
      ],
    );


  const deleteFoundDuplicates =
    useCallback(
      async () => {
        if (
          duplicateDeleteBusy ||
          duplicateDeleteTrackIds
            .length === 0
        ) {
          return;
        }

        const confirmed =
          window.confirm(
            "Delete " +
            duplicateDeleteTrackIds.length +
            " duplicate track" +
            (
              duplicateDeleteTrackIds.length ===
                1
                ? ""
                : "s"
            ) +
            "? HyperSynced will keep the oldest catalog copy in each duplicate group and permanently delete the extra database rows and B2 files.",
          );

        if (!confirmed) {
          return;
        }

        setDuplicateDeleteBusy(
          true,
        );

        setMessage("");

        try {
          const result =
            await deleteCatalogTracks(
              duplicateDeleteTrackIds,
            );

          await loadDashboard();

          await runDuplicateCheck();

          const deletedCount =
            Number(
              result
                ?.deleted_count ??
              result
                ?.deleted_track_ids
                ?.length ??
              0,
            );

          const failedCount =
            Array.isArray(
              result?.failed,
            )
              ? result.failed.length
              : 0;

          setMessage(
            failedCount > 0
              ? (
                  "Deleted " +
                  deletedCount +
                  " duplicate track" +
                  (
                    deletedCount === 1
                      ? ""
                      : "s"
                  ) +
                  ". " +
                  failedCount +
                  " could not be deleted and remain in the catalog."
                )
              : (
                  "Deleted " +
                  deletedCount +
                  " duplicate track" +
                  (
                    deletedCount === 1
                      ? ""
                      : "s"
                  ) +
                  " and kept one canonical copy per group."
                ),
          );
        } catch (error) {
          setMessage(
            error instanceof Error
              ? error.message
              : "Unable to delete duplicates.",
          );
        } finally {
          setDuplicateDeleteBusy(
            false,
          );
        }
      },
      [
        duplicateDeleteBusy,
        duplicateDeleteTrackIds,
        loadDashboard,
        runDuplicateCheck,
      ],
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


  const trackCount =
    Number(
      diagnostics?.catalog
        ?.track_count ??
      0,
    );

  const artistCount =
    Number(
      diagnostics?.catalog
        ?.artist_count ??
      0,
    );

  const albumCount =
    Number(
      diagnostics?.catalog
        ?.album_count ??
      0,
    );

  const artworkCount =
    Number(
      diagnostics?.catalog
        ?.artwork_count ??
      0,
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
          value={trackCount}
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
            trackCount
              ? `${Math.round(
                  (
                    artworkCount /
                    trackCount
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
              ? `${duplicates.scanned_tracks ?? trackCount} scanned`
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
                  ? `${diagnostics?.catalog?.track_count ?? trackCount} tracks`
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
              duplicateDeleteBusy
                ? "DELETING"
                : duplicateBusy
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

          <div className="admin-duplicate-actions">
            {duplicateDeleteTrackIds.length >
              0 ? (
              <button
                type="button"
                className="danger-button admin-inline-button"
                disabled={
                  duplicateBusy ||
                  duplicateDeleteBusy
                }
                onClick={() => {
                  void deleteFoundDuplicates();
                }}
              >
                {duplicateDeleteBusy
                  ? "Deleting duplicates..."
                  : (
                      "Delete duplicates (" +
                      duplicateDeleteTrackIds.length +
                      ")"
                    )}
              </button>
            ) : null}

            <button
              type="button"
              className="secondary-admin-button admin-inline-button"
              disabled={
                duplicateBusy ||
                duplicateDeleteBusy
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
