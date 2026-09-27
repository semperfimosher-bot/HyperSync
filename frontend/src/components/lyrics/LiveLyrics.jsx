import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  apiRequest,
} from "../../api/client.js";

import * as player
  from "../../audioPlayer.js";

import {
  catalogLyricsTrackId,
  getActiveLyricIndex,
  getEffectiveLyricsPlaybackState,
  parseSyncedLyrics,
} from "../../lyricsSync.js";

import {
  getLyrics,
  saveLyrics,
} from "../../mediaStore.js";


function LiveLyrics({
  accountPlaybackSnapshot = null,
  currentPlaybackDeviceId = null,
}) {
  const [
    localPlayerState,
    setLocalPlayerState,
  ] = useState(
    () => player.getState(),
  );

  const [
    remoteClock,
    setRemoteClock,
  ] = useState(
    () => Date.now(),
  );

  const [
    lyricsData,
    setLyricsData,
  ] = useState(null);

  const [
    loading,
    setLoading,
  ] = useState(false);

  const [
    error,
    setError,
  ] = useState("");

  const lineRefs =
    useRef([]);


  useEffect(() => {
    return player.subscribe(
      setLocalPlayerState,
    );
  }, []);


  const playerState =
    getEffectiveLyricsPlaybackState({
      localState:
        localPlayerState,
      accountSnapshot:
        accountPlaybackSnapshot,
      currentPlaybackDeviceId,
      nowMs:
        remoteClock,
    });


  useEffect(() => {
    if (
      !playerState
        .controllingRemote ||
      playerState.paused ||
      !playerState.trackId
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
    playerState
      .controllingRemote,
    playerState.paused,
    playerState.trackId,
    accountPlaybackSnapshot
      ?.updated_at,
  ]);


  useEffect(() => {
    setRemoteClock(
      Date.now(),
    );
  }, [
    accountPlaybackSnapshot
      ?.track?.id,
    accountPlaybackSnapshot
      ?.position_seconds,
    accountPlaybackSnapshot
      ?.paused,
    accountPlaybackSnapshot
      ?.updated_at,
    accountPlaybackSnapshot
      ?.device_id,
    currentPlaybackDeviceId,
  ]);


  /*
   * Only fetch lyrics when the
   * current TRACK changes.
   *
   * timeupdate events do not
   * trigger another API request.
   */
  useEffect(() => {
    const trackId =
      playerState.trackId;

    const lyricsTrackId =
      catalogLyricsTrackId(
        playerState
          .catalogTrackId ??
        trackId,
      );

    if (!trackId) {
      setLyricsData(
        null,
      );

      setLoading(
        false,
      );

      setError(
        "",
      );

      lineRefs.current =
        [];

      return undefined;
    }

    if (!lyricsTrackId) {
      setLyricsData(
        null,
      );

      setLoading(
        false,
      );

      setError(
        "Lyrics will load automatically once this on-demand track finishes publishing.",
      );

      lineRefs.current =
        [];

      return undefined;
    }

    const controller =
      new AbortController();

    let cancelled =
      false;

    setLyricsData(
      null,
    );

    setLoading(
      true,
    );

    setError(
      "",
    );

    lineRefs.current =
      [];

    async function loadLyrics() {
      let cachedLyrics =
        null;

      try {
        cachedLyrics =
          await getLyrics(
            lyricsTrackId,
          );

        if (
          !cancelled &&
          cachedLyrics
        ) {
          setLyricsData(
            cachedLyrics,
          );

          setLoading(
            false,
          );
        }
      } catch {
        // Local lyrics are best effort.
      }

      if (
        typeof navigator !==
          "undefined" &&
        navigator.onLine ===
          false
      ) {
        if (
          !cancelled &&
          !cachedLyrics
        ) {
          setError(
            "Lyrics are not downloaded for this track.",
          );

          setLoading(
            false,
          );
        }

        return;
      }

      try {
        const result =
          await apiRequest(
            (
              "/catalog/tracks/" +
              `${encodeURIComponent(
                lyricsTrackId,
              )}/lyrics`
            ),
            {
              method: "GET",
              signal:
                controller.signal,
            },
          );

        if (cancelled) {
          return;
        }

        setLyricsData(
          result,
        );

        setError(
          "",
        );

        void saveLyrics(
          lyricsTrackId,
          result,
        ).catch(
          () => null,
        );
      } catch (loadError) {
        if (
          cancelled ||
          loadError?.name ===
            "AbortError"
        ) {
          return;
        }

        if (!cachedLyrics) {
          setError(
            loadError
              instanceof Error
              ? loadError.message
              : (
                  "Unable to load "
                  + "lyrics."
                ),
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(
            false,
          );
        }
      }
    }

    void loadLyrics();

    return () => {
      cancelled =
        true;

      controller.abort();
    };
  }, [
    playerState.trackId,
    playerState.catalogTrackId,
  ]);


  const syncedLines =
    useMemo(
      () => {
        if (
          !lyricsData
          ||
          lyricsData.status
            !== "synced"
        ) {
          return [];
        }

        return (
          parseSyncedLyrics(
            lyricsData
              .synced_lyrics,
          )
        );
      },
      [lyricsData],
    );


  /*
   * If LRCLIB says synced but
   * parsing somehow produced no
   * lines, fall back to plain
   * lyrics when available.
   */
  let displayMode =
    lyricsData?.status
    ?? null;

  if (
    displayMode ===
      "synced"
    &&
    syncedLines.length ===
      0
  ) {
    displayMode =
      lyricsData
        ?.plain_lyrics
        ? "plain"
        : "not_found";
  }


  const activeIndex =
    displayMode ===
      "synced"
      ? getActiveLyricIndex(
          syncedLines,
          playerState
            .currentTime,
        )
      : -1;


  /*
   * Auto-center the newly active
   * line. This only runs when the
   * INDEX changes, not every
   * timeupdate.
   */
  useEffect(() => {
    if (
      activeIndex < 0
    ) {
      return;
    }

    const line =
      lineRefs.current[
        activeIndex
      ];

    if (!line) {
      return;
    }

    const prefersReducedMotion =
      window.matchMedia?.(
        (
          "(prefers-reduced-"
          + "motion: reduce)"
        ),
      ).matches
      ?? false;

    line.scrollIntoView({
      block: "center",
      behavior:
        prefersReducedMotion
          ? "auto"
          : "smooth",
    });
  }, [
    activeIndex,
  ]);


  const trackTitle =
    playerState.title
    || "Current track";

  const trackArtist =
    playerState.artist
    || "HyperSynced";


  let badgeText =
    "";

  if (loading) {
    badgeText =
      "SYNCING";
  } else if (
    displayMode ===
      "synced"
  ) {
    badgeText =
      "LIVE SYNC";
  } else if (
    displayMode ===
      "plain"
  ) {
    badgeText =
      "NOT SYNCED";
  } else if (
    displayMode ===
      "instrumental"
  ) {
    badgeText =
      "INSTRUMENTAL";
  }


  return (
    <section
      className={
        "live-lyrics"
        + (
          playerState.trackId
            ? " has-track"
            : " is-idle"
        )
      }
      aria-label="Live lyrics"
    >

      <div
        className={
          "live-lyrics__glow"
        }
        aria-hidden="true"
      />

      <header
        className={
          "live-lyrics__header"
        }
      >

        <div>
          <span
            className={
              "live-lyrics__eyebrow"
            }
          >
            <i />

            LIVE LYRICS
          </span>

          <h2>
            {playerState.trackId
              ? trackTitle
              : "Live Lyrics"}
          </h2>

          <p>
            {playerState.trackId
              ? trackArtist
              : (
                  "Your music, "
                  + "locked to the "
                  + "timeline."
                )}
          </p>
        </div>


        {badgeText ? (
          <span
            className={
              "live-lyrics__badge"
            }
          >
            {badgeText}
          </span>
        ) : null}

      </header>


      <div
        className={
          "live-lyrics__viewport"
        }
      >

        {!playerState.trackId ? (

          <div
            className={
              "live-lyrics__state"
            }
          >
            <span
              className={
                "live-lyrics__state-icon"
              }
            >
              ≋
            </span>

            <strong>
              Start a track
            </strong>

            <p>
              Play something and
              Live Lyrics will sync
              itself automatically.
            </p>
          </div>

        ) : loading ? (

          <div
            className={
              "live-lyrics__state"
            }
          >
            <span
              className={
                "live-lyrics__loader"
              }
            />

            <strong>
              Syncing lyrics
            </strong>

            <p>
              Matching this track
              with LRCLIB.
            </p>
          </div>

        ) : error ? (

          <div
            className={
              "live-lyrics__state"
            }
          >
            <strong>
              Lyrics temporarily
              unavailable
            </strong>

            <p>
              {error}
            </p>
          </div>

        ) : displayMode ===
            "synced" ? (

          <div
            className={
              "live-lyrics__lines"
            }
          >
            {syncedLines.map(
              (line, index) => {
                const isActive =
                  index ===
                  activeIndex;

                const isPast =
                  index <
                  activeIndex;

                const className = [
                  "live-lyrics__line",
                  isActive
                    ? "is-active"
                    : "",
                  isPast
                    ? "is-past"
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ");

                return (
                  <button
                    key={
                      (
                        line
                          .timeSeconds
                      )
                      + "-"
                      + index
                    }
                    ref={(node) => {
                      lineRefs
                        .current[
                          index
                        ] = node;
                    }}
                    type="button"
                    className={
                      className
                    }
                    aria-current={
                      isActive
                        ? "true"
                        : undefined
                    }
                    onClick={() => {
                      player.seekTo(
                        line
                          .timeSeconds,
                      );
                    }}
                  >
                    {line.text}
                  </button>
                );
              },
            )}
          </div>

        ) : displayMode ===
            "plain" ? (

          <div
            className={
              "live-lyrics__plain"
            }
          >
            {
              lyricsData
                ?.plain_lyrics
            }
          </div>

        ) : displayMode ===
            "instrumental" ? (

          <div
            className={
              "live-lyrics__state"
            }
          >
            <span
              className={
                "live-lyrics__state-icon"
              }
            >
              ♫
            </span>

            <strong>
              Instrumental
            </strong>

            <p>
              This track has no
              vocal lyrics to sync.
            </p>
          </div>

        ) : (

          <div
            className={
              "live-lyrics__state"
            }
          >
            <span
              className={
                "live-lyrics__state-icon"
              }
            >
              ···
            </span>

            <strong>
              Lyrics not found
            </strong>

            <p>
              LRCLIB does not have
              lyrics for this track
              yet.
            </p>
          </div>

        )}

      </div>


      {playerState.trackId ? (
        <footer
          className={
            "live-lyrics__footer"
          }
        >
          <span>
            Lyrics via LRCLIB
          </span>

          {displayMode ===
          "synced" ? (
            <span>
              Tap any line to seek
            </span>
          ) : null}
        </footer>
      ) : null}

    </section>
  );
}


export default LiveLyrics;
