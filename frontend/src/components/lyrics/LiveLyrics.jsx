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
  getActiveLyricIndex,
  parseSyncedLyrics,
} from "../../lyricsSync.js";


function LiveLyrics() {
  const [
    playerState,
    setPlayerState,
  ] = useState(
    () => player.getState(),
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


  /*
   * Use HyperSync's real audio
   * player as our timing clock.
   */
  useEffect(() => {
    return player.subscribe(
      setPlayerState,
    );
  }, []);


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
      try {
        const result =
          await apiRequest(
            (
              "/catalog/tracks/" +
              `${encodeURIComponent(
                trackId,
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
      } catch (loadError) {
        if (
          cancelled ||
          loadError?.name ===
            "AbortError"
        ) {
          return;
        }

        setError(
          loadError
            instanceof Error
            ? loadError.message
            : (
                "Unable to load "
                + "lyrics."
              ),
        );
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
    || "HyperSync";


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
