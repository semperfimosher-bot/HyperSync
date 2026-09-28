import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  apiRequest,
} from "../../api/client.js";

import Icon from
  "../ui/Icon.jsx";


const ACTIVE_SCAN_STATES =
  new Set([
    "discovering",
    "ingesting",
    "cancelling",
  ]);


function scanLabel(
  value,
) {
  return String(
    value || "idle",
  )
    .replace(
      "-",
      " ",
    )
    .toUpperCase();
}


function eventTime(
  value,
) {
  if (!value) {
    return "";
  }

  const date =
    new Date(
      value,
    );

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return "";
  }

  return date.toLocaleTimeString(
    [],
    {
      hour:
        "numeric",
      minute:
        "2-digit",
    },
  );
}


function durationLabel(
  value,
) {
  const seconds =
    Number(
      value,
    );

  if (
    !Number.isFinite(
      seconds,
    )
    || seconds <= 0
  ) {
    return "--:--";
  }

  return (
    Math.floor(
      seconds / 60,
    )
    + ":"
    + String(
        Math.floor(
          seconds % 60,
        ),
      ).padStart(
        2,
        "0",
      )
  );
}


export default function AdminBotPage() {
  const [
    botData,
    setBotData,
  ] = useState({
    status:
      "offline",
    running:
      false,
    current_job:
      null,
    queued_jobs:
      0,
    completed_jobs:
      0,
    failed_jobs:
      0,
    provisions:
      [],
    events:
      [],
    catalog_scan:
      null,
  });

  const [
    message,
    setMessage,
  ] = useState("");

  const [
    loading,
    setLoading,
  ] = useState(false);

  const [
    scanBusy,
    setScanBusy,
  ] = useState(false);

  const [
    rightsConfirmed,
    setRightsConfirmed,
  ] = useState(false);

  const [
    musicQuery,
    setMusicQuery,
  ] = useState("");

  const [
    musicKind,
    setMusicKind,
  ] = useState("song");

  const [
    musicResults,
    setMusicResults,
  ] = useState([]);

  const [
    musicSearching,
    setMusicSearching,
  ] = useState(false);

  const [
    ingestingKeys,
    setIngestingKeys,
  ] = useState(
    () => new Set(),
  );


  const scan =
    botData.catalog_scan ?? {
      state:
        "idle",
      auto_ingest:
        false,
      artist_total:
        0,
      artists_scanned:
        0,
      artist_failures:
        0,
      current_artist:
        null,
      missing_discovered:
        0,
      ingest_started:
        0,
      ingest_ready:
        0,
      ingest_failed:
        0,
      recent_missing:
        [],
    };

  const provisions =
    Array.isArray(
      botData.provisions,
    )
      ? botData.provisions
      : [];

  const events =
    Array.isArray(
      botData.events,
    )
      ? botData.events
      : [];

  const scanActive =
    ACTIVE_SCAN_STATES.has(
      scan.state,
    );

  const activeProvisionCount =
    provisions.filter(
      (item) =>
        ![
          "ready",
          "failed",
        ].includes(
          item?.state,
        ),
    ).length;

  const isOnline =
    botData.status ===
      "online" ||
    botData.status ===
      "running" ||
    botData.status ===
      "healthy";

  const scanProgress =
    useMemo(
      () => {
        const total =
          Number(
            scan.artist_total,
          ) || 0;

        const scanned =
          Number(
            scan.artists_scanned,
          ) || 0;

        if (total <= 0) {
          return (
            scan.state ===
              "complete"
              ? 100
              : 0
          );
        }

        const discovery =
          Math.min(
            100,
            Math.max(
              0,
              (
                scanned /
                total
              ) * 100,
            ),
          );

        if (
          scan.state ===
          "ingesting"
        ) {
          const started =
            Number(
              scan.ingest_started,
            ) || 0;

          const finished =
            (
              Number(
                scan.ingest_ready,
              ) || 0
            ) +
            (
              Number(
                scan.ingest_failed,
              ) || 0
            );

          const ingestTotal =
            Math.max(
              Number(
                scan.missing_discovered,
              ) || 0,
              started,
              1,
            );

          return (
            60 +
            Math.min(
              40,
              (
                finished /
                ingestTotal
              ) * 40,
            )
          );
        }

        return (
          discovery * 0.6
        );
      },
      [
        scan,
      ],
    );


  const refreshStatus =
    useCallback(
      async ({
        quiet = false,
      } = {}) => {
        if (!quiet) {
          setLoading(
            true,
          );
        }

        try {
          const data =
            await apiRequest(
              "/admin/bot/status",
            );

          setBotData(
            data ?? {},
          );

        } catch (error) {
          if (!quiet) {
            setMessage(
              error instanceof Error
                ? error.message
                : "Unable to load bot status.",
            );
          }

        } finally {
          if (!quiet) {
            setLoading(
              false,
            );
          }
        }
      },
      [],
    );


  useEffect(() => {
    void refreshStatus();
  }, [
    refreshStatus,
  ]);


  useEffect(() => {
    const delay =
      (
        scanActive ||
        activeProvisionCount >
          0
      )
        ? 1400
        : 6000;

    const timer =
      window.setInterval(
        () => {
          void refreshStatus({
            quiet:
              true,
          });
        },
        delay,
      );

    return () => {
      window.clearInterval(
        timer,
      );
    };
  }, [
    activeProvisionCount,
    refreshStatus,
    scanActive,
  ]);


  const sendBotAction =
    async (
      action,
    ) => {
      setLoading(
        true,
      );
      setMessage(
        "",
      );

      try {
        if (
          action ===
          "restart"
        ) {
          await apiRequest(
            "/admin/bot/stop",
            {
              method:
                "POST",
            },
          );

          await apiRequest(
            "/admin/bot/start",
            {
              method:
                "POST",
            },
          );

        } else {
          await apiRequest(
            `/admin/bot/${action}`,
            {
              method:
                "POST",
            },
          );
        }

        setMessage(
          `Bot ${action} command completed.`,
        );

        await refreshStatus({
          quiet:
            true,
        });

      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Bot command failed.",
        );

      } finally {
        setLoading(
          false,
        );
      }
    };


  const startGapScan =
    async (
      autoIngest,
    ) => {
      if (
        scanActive ||
        scanBusy
      ) {
        return;
      }

      if (
        autoIngest &&
        !rightsConfirmed
      ) {
        setMessage(
          "Confirm media rights before bulk ingesting missing tracks.",
        );
        return;
      }

      setScanBusy(
        true,
      );
      setMessage(
        "",
      );

      try {
        const result =
          await apiRequest(
            "/admin/bot/scan",
            {
              method:
                "POST",
              body:
                JSON.stringify({
                  auto_ingest:
                    autoIngest,
                  confirm_authorized_media:
                    (
                      autoIngest &&
                      rightsConfirmed
                    ),
                  track_limit_per_artist:
                    500,
                  ingest_concurrency:
                    2,
                }),
            },
          );

        setMessage(
          result?.message ||
          "Catalog gap scan started.",
        );

        await refreshStatus({
          quiet:
            true,
        });

      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Unable to start catalog gap scan.",
        );

      } finally {
        setScanBusy(
          false,
        );
      }
    };


  const cancelGapScan =
    async () => {
      if (
        !scanActive ||
        scanBusy
      ) {
        return;
      }

      setScanBusy(
        true,
      );

      try {
        const result =
          await apiRequest(
            "/admin/bot/scan/cancel",
            {
              method:
                "POST",
            },
          );

        setMessage(
          result?.message ||
          "Cancellation requested.",
        );

        await refreshStatus({
          quiet:
            true,
        });

      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Unable to cancel catalog gap scan.",
        );

      } finally {
        setScanBusy(
          false,
        );
      }
    };


  const searchMusic =
    async (
      event,
    ) => {
      event?.preventDefault?.();

      const term =
        musicQuery.trim();

      if (
        term.length < 2 ||
        musicSearching
      ) {
        return;
      }

      setMusicSearching(
        true,
      );
      setMessage(
        "",
      );

      try {
        const params =
          new URLSearchParams({
            q:
              term,
            kind:
              musicKind,
          });

        const data =
          await apiRequest(
            `/admin/bot/music-search?${params.toString()}`,
          );

        const tracks =
          Array.isArray(
            data?.tracks,
          )
            ? data.tracks
            : [];

        setMusicResults(
          tracks,
        );

        if (
          tracks.length ===
          0
        ) {
          setMessage(
            "No new ingestable recordings matched that search.",
          );
        }

      } catch (error) {
        setMusicResults(
          [],
        );

        setMessage(
          error instanceof Error
            ? error.message
            : "Unable to search music metadata.",
        );

      } finally {
        setMusicSearching(
          false,
        );
      }
    };


  const ingestMusic =
    async (
      candidate,
    ) => {
      const key =
        candidate
          ?.provision_key;

      if (
        !key ||
        ingestingKeys.has(
          key,
        )
      ) {
        return;
      }

      setIngestingKeys(
        (current) =>
          new Set(
            current,
          ).add(
            key,
          ),
      );

      setMessage(
        "",
      );

      try {
        const result =
          await apiRequest(
            "/admin/bot/ingest",
            {
              method:
                "POST",
              body:
                JSON.stringify({
                  candidate_key:
                    key,
                }),
            },
          );

        setMessage(
          result?.track_id
            ? (
                "Already available in the catalog: "
                + candidate.artist
                + " — "
                + candidate.title
              )
            : (
                "Ingest started: "
                + candidate.artist
                + " — "
                + candidate.title
              ),
        );

        await refreshStatus({
          quiet:
            true,
        });

      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Unable to start ingest.",
        );

      } finally {
        setIngestingKeys(
          (current) => {
            const next =
              new Set(
                current,
              );

            next.delete(
              key,
            );

            return next;
          },
        );
      }
    };


  return (
    <div className="page-stack admin-page admin-bot-page admin-bot-command">
      <section className="admin-bot-hero">
        <div
          className="admin-bot-hero__grid"
          aria-hidden="true"
        />

        <div className="admin-bot-hero__copy">
          <span className="admin-bot-hero__eyebrow">
            <i aria-hidden="true" />
            AUTOMATION COMMAND CENTER
          </span>

          <h2>
            HyperSynced Bot
          </h2>

          <p>
            Discover catalog gaps, validate canonical
            metadata, resolve authorized audio, and publish
            safely into B2 + PostgreSQL without changing the
            existing on-demand pipeline.
          </p>
        </div>

        <div className="admin-bot-hero__status">
          <span
            className={
              isOnline
                ? "admin-bot-orb is-online"
                : "admin-bot-orb"
            }
          >
            <Icon
              name="chart"
              size={24}
            />
          </span>

          <div>
            <small>
              BOT STATUS
            </small>

            <strong>
              {isOnline
                ? "ONLINE"
                : "OFFLINE"}
            </strong>

            <em>
              {botData.current_job ||
                "Standing by"}
            </em>
          </div>
        </div>
      </section>


      {message ? (
        <div className="admin-alert admin-bot-alert">
          <Icon
            name="shield"
            size={18}
          />

          <span>
            {message}
          </span>
        </div>
      ) : null}


      <section className="admin-bot-kpi-grid">
        {[
          [
            "Active pipeline",
            activeProvisionCount,
            "resolving / publishing",
          ],
          [
            "Queued jobs",
            Number(
              botData.queued_jobs,
            ) || 0,
            "waiting for workers",
          ],
          [
            "Completed",
            Number(
              botData.completed_jobs,
            ) || 0,
            "automation jobs",
          ],
          [
            "Failures",
            Number(
              botData.failed_jobs,
            ) || 0,
            "review event log",
          ],
        ].map(
          ([
            label,
            value,
            detail,
          ]) => (
            <article
              className="admin-bot-kpi"
              key={label}
            >
              <span>
                {label}
              </span>

              <strong>
                {value}
              </strong>

              <small>
                {detail}
              </small>
            </article>
          ),
        )}
      </section>


      <section className="admin-bot-main-grid">
        <div className="admin-panel admin-bot-gap-panel">
          <div className="admin-panel__heading">
            <div>
              <span>
                CATALOG GAP ENGINE
              </span>

              <h3>
                Complete every artist
              </h3>
            </div>

            <span
              className={[
                "admin-bot-scan-state",
                scanActive
                  ? "is-active"
                  : "",
                scan.state ===
                  "failed"
                  ? "is-failed"
                  : "",
              ]
                .filter(
                  Boolean,
                )
                .join(
                  " ",
                )}
            >
              {scanLabel(
                scan.state,
              )}
            </span>
          </div>

          <p className="admin-bot-panel-copy">
            Reads every distinct artist already in your
            catalog, compares that artist against Deezer +
            iTunes metadata, filters tracks you already have,
            then optionally sends only missing tracks through
            the existing ingest, duplicate-check, B2 upload,
            and database publication pipeline.
          </p>

          <div className="admin-bot-progress">
            <div>
              <span>
                {scan.state ===
                "ingesting"
                  ? "Publishing missing tracks"
                  : scanActive
                    ? "Scanning artists"
                    : "Gap scan progress"}
              </span>

              <strong>
                {Math.round(
                  scanProgress,
                )}
                %
              </strong>
            </div>

            <span className="admin-bot-progress__track">
              <i
                style={{
                  width:
                    `${Math.max(
                      0,
                      Math.min(
                        100,
                        scanProgress,
                      ),
                    )}%`,
                }}
              />
            </span>

            <small>
              {scan.current_artist
                ? (
                    "Current artist: "
                    + scan.current_artist
                  )
                : (
                    (Number(
                      scan.artists_scanned,
                    ) || 0)
                    + " / "
                    + (Number(
                        scan.artist_total,
                      ) || 0)
                    + " artists scanned"
                  )}
            </small>
          </div>

          <div className="admin-bot-scan-metrics">
            {[
              [
                "Artists",
                (
                  (Number(
                    scan.artists_scanned,
                  ) || 0)
                  + " / "
                  + (Number(
                      scan.artist_total,
                    ) || 0)
                ),
              ],
              [
                "Missing",
                Number(
                  scan.missing_discovered,
                ) || 0,
              ],
              [
                "Published",
                Number(
                  scan.ingest_ready,
                ) || 0,
              ],
              [
                "Failed",
                (
                  (Number(
                    scan.ingest_failed,
                  ) || 0)
                  +
                  (Number(
                    scan.artist_failures,
                  ) || 0)
                ),
              ],
            ].map(
              ([
                label,
                value,
              ]) => (
                <div
                  key={label}
                >
                  <span>
                    {label}
                  </span>

                  <strong>
                    {value}
                  </strong>
                </div>
              ),
            )}
          </div>

          {Array.isArray(
            scan.recent_missing,
          ) &&
          scan.recent_missing
            .length > 0 ? (
            <div className="admin-bot-gap-preview">
              <span>
                RECENTLY DISCOVERED
              </span>

              {scan.recent_missing
                .slice(
                  0,
                  6,
                )
                .map(
                  (
                    item,
                    index,
                  ) => (
                    <div
                      key={
                        item.candidate_key ||
                        `${item.artist}-${item.title}-${index}`
                      }
                    >
                      <Icon
                        name="music"
                        size={13}
                      />

                      <span>
                        <strong>
                          {item.title}
                        </strong>

                        <small>
                          {item.artist}
                          {item.album
                            ? (
                                " • "
                                + item.album
                              )
                            : ""}
                        </small>
                      </span>
                    </div>
                  ),
                )}
            </div>
          ) : null}

          <label className="admin-bot-rights-check">
            <input
              type="checkbox"
              checked={
                rightsConfirmed
              }
              disabled={
                scanActive
              }
              onChange={(
                event,
              ) => {
                setRightsConfirmed(
                  event.target.checked,
                );
              }}
            />

            <span>
              <strong>
                Authorized media only
              </strong>

              <small>
                I confirm bulk-ingested audio is owned,
                licensed, or otherwise permitted for this
                catalog.
              </small>
            </span>
          </label>

          <div className="admin-bot-scan-actions">
            <button
              type="button"
              className="secondary-admin-button"
              disabled={
                scanActive ||
                scanBusy
              }
              onClick={() => {
                void startGapScan(
                  false,
                );
              }}
            >
              <Icon
                name="search"
                size={15}
              />

              Discover gaps
            </button>

            <button
              type="button"
              className="admin-bot-primary-action"
              disabled={
                scanActive ||
                scanBusy ||
                !rightsConfirmed
              }
              onClick={() => {
                void startGapScan(
                  true,
                );
              }}
            >
              <Icon
                name="play"
                size={15}
              />

              Scan + ingest missing
            </button>

            {scanActive ? (
              <button
                type="button"
                className="admin-bot-cancel-action"
                disabled={
                  scanBusy
                }
                onClick={() => {
                  void cancelGapScan();
                }}
              >
                <Icon
                  name="close"
                  size={14}
                />

                Cancel
              </button>
            ) : null}
          </div>
        </div>


        <div className="admin-panel admin-bot-control-panel">
          <div className="admin-panel__heading">
            <div>
              <span>
                SERVICE CONTROL
              </span>

              <h3>
                Runtime controls
              </h3>
            </div>
          </div>

          <div className="admin-bot-control-stack">
            {[
              [
                "start",
                "play",
                "Start Bot",
                "Enable automation runtime.",
              ],
              [
                "restart",
                "chart",
                "Restart Bot",
                "Refresh bot runtime state.",
              ],
              [
                "process",
                "music",
                "Process Queue",
                "Run legacy queue hook.",
              ],
              [
                "stop",
                "close",
                "Stop Bot",
                "Stop legacy automation state.",
              ],
            ].map(
              ([
                action,
                icon,
                title,
                detail,
              ]) => (
                <button
                  type="button"
                  key={action}
                  disabled={
                    loading
                  }
                  onClick={() => {
                    void sendBotAction(
                      action,
                    );
                  }}
                >
                  <span>
                    <Icon
                      name={icon}
                      size={18}
                    />
                  </span>

                  <div>
                    <strong>
                      {title}
                    </strong>

                    <small>
                      {detail}
                    </small>
                  </div>

                  <Icon
                    name="chevron"
                    size={13}
                  />
                </button>
              ),
            )}
          </div>

          <div className="admin-bot-runtime-note">
            <Icon
              name="shield"
              size={16}
            />

            <p>
              Gap scanning is isolated from normal search,
              playback, manual ingest, and on-demand first-play
              ingestion. Existing duplicate checks remain the
              final gate before publication.
            </p>
          </div>
        </div>
      </section>


      <section className="admin-panel admin-bot-music-panel">
        <div className="admin-panel__heading">
          <div>
            <span>
              MANUAL INGEST
            </span>

            <h3>
              Find authorized music
            </h3>
          </div>

          <span className="admin-status admin-status--online">
            DEEZER + ITUNES
          </span>
        </div>

        <form
          className="admin-bot-search"
          onSubmit={
            searchMusic
          }
        >
          <select
            value={
              musicKind
            }
            aria-label="Music search type"
            onChange={(
              event,
            ) => {
              setMusicKind(
                event.target.value,
              );
            }}
          >
            <option value="song">
              Song
            </option>

            <option value="album">
              Album
            </option>

            <option value="artist">
              Artist
            </option>
          </select>

          <label>
            <Icon
              name="search"
              size={16}
            />

            <input
              type="search"
              value={
                musicQuery
              }
              placeholder="Artist, album, or song"
              onChange={(
                event,
              ) => {
                setMusicQuery(
                  event.target.value,
                );
              }}
            />
          </label>

          <button
            type="submit"
            className="secondary-admin-button"
            disabled={
              musicSearching ||
              musicQuery.trim()
                .length < 2
            }
          >
            {musicSearching
              ? "Resolving..."
              : "Find music"}
          </button>
        </form>

        {musicResults.length > 0 ? (
          <div className="admin-bot-results">
            {musicResults.map(
              (
                candidate,
                index,
              ) => {
                const ingesting =
                  ingestingKeys.has(
                    candidate
                      .provision_key,
                  );

                return (
                  <article
                    className="admin-bot-result"
                    key={
                      candidate
                        .provision_key
                    }
                  >
                    <span className="admin-bot-result__rank">
                      {String(
                        index + 1,
                      ).padStart(
                        2,
                        "0",
                      )}
                    </span>

                    <span className="admin-bot-result__art">
                      {candidate.artwork_url ? (
                        <img
                          src={
                            candidate
                              .artwork_url
                          }
                          alt=""
                        />
                      ) : (
                        <Icon
                          name="music"
                          size={22}
                        />
                      )}
                    </span>

                    <span className="admin-bot-result__copy">
                      <strong>
                        {candidate.title}
                      </strong>

                      <small>
                        {candidate.artist}
                        {candidate.album
                          ? (
                              " • "
                              + candidate.album
                            )
                          : ""}
                      </small>

                      <em>
                        {candidate.provider
                          ?.replace(
                            "+",
                            " + ",
                          )
                          .toUpperCase()}
                        {candidate.isrc
                          ? (
                              " • ISRC "
                              + candidate.isrc
                            )
                          : ""}
                      </em>
                    </span>

                    <span className="admin-bot-result__meta">
                      <small>
                        {candidate.genre ||
                          "Genre pending"}
                      </small>

                      <small>
                        {candidate.release_year ||
                          "Year pending"}
                      </small>

                      <small>
                        {durationLabel(
                          candidate
                            .duration_seconds,
                        )}
                      </small>
                    </span>

                    <button
                      type="button"
                      className="secondary-admin-button admin-bot-result__action"
                      disabled={
                        ingesting
                      }
                      onClick={() => {
                        void ingestMusic(
                          candidate,
                        );
                      }}
                    >
                      {ingesting
                        ? "Preparing..."
                        : "Ingest"}
                    </button>
                  </article>
                );
              },
            )}
          </div>
        ) : (
          <div className="admin-duplicate-idle">
            <Icon
              name="music"
              size={20}
            />

            <div>
              <strong>
                Manual metadata-first ingest
              </strong>

              <p>
                Search a song, album, or artist and publish
                individual authorized tracks using the same
                pipeline as before.
              </p>
            </div>
          </div>
        )}
      </section>


      <section className="admin-bot-lower-grid">
        <div className="admin-panel">
          <div className="admin-panel__heading">
            <div>
              <span>
                LIVE PIPELINE
              </span>

              <h3>
                Provision activity
              </h3>
            </div>

            <strong>
              {provisions.length}
            </strong>
          </div>

          {provisions.length > 0 ? (
            <div className="admin-bot-provisions">
              {provisions
                .slice(
                  0,
                  14,
                )
                .map(
                  (item) => (
                    <div
                      className="admin-bot-provision"
                      key={
                        item.provision_id
                      }
                    >
                      <span
                        className={[
                          "admin-tool-light",
                          item.state ===
                            "ready"
                            ? "is-on"
                            : (
                                item.state ===
                                  "failed"
                                  ? "is-warning"
                                  : ""
                              ),
                        ]
                          .filter(
                            Boolean,
                          )
                          .join(
                            " ",
                          )}
                      />

                      <span>
                        <strong>
                          {item.title}
                        </strong>

                        <small>
                          {item.artist}
                        </small>
                      </span>

                      <em>
                        {scanLabel(
                          item.state ||
                            "queued",
                        )}
                      </em>
                    </div>
                  ),
                )}
            </div>
          ) : (
            <div className="admin-duplicate-idle is-clean">
              <Icon
                name="check"
                size={20}
              />

              <div>
                <strong>
                  Pipeline is clear
                </strong>

                <p>
                  Manual, on-demand, and bulk ingest jobs will
                  appear here while they resolve and publish.
                </p>
              </div>
            </div>
          )}
        </div>


        <div className="admin-panel admin-bot-event-panel">
          <div className="admin-panel__heading">
            <div>
              <span>
                EVENT STREAM
              </span>

              <h3>
                Automation log
              </h3>
            </div>

            <button
              type="button"
              className="admin-bot-mini-refresh"
              disabled={
                loading
              }
              onClick={() => {
                void refreshStatus();
              }}
            >
              Refresh
            </button>
          </div>

          {events.length > 0 ? (
            <div className="admin-bot-events">
              {events
                .slice(
                  0,
                  14,
                )
                .map(
                  (event) => (
                    <div
                      className={
                        "admin-bot-event is-"
                        + String(
                            event.level ||
                              "info",
                          )
                      }
                      key={
                        event.id
                      }
                    >
                      <i />

                      <span>
                        <strong>
                          {event.message}
                        </strong>

                        <small>
                          {eventTime(
                            event.timestamp,
                          )}
                        </small>
                      </span>
                    </div>
                  ),
                )}
            </div>
          ) : (
            <div className="admin-duplicate-idle">
              <Icon
                name="chart"
                size={20}
              />

              <div>
                <strong>
                  No bot events yet
                </strong>

                <p>
                  Scan, ingest, and runtime events will appear
                  here.
                </p>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
