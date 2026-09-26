import {
  useEffect,
  useMemo,
  useState,
} from "react";

import * as player from "../../audioPlayer.js";

import LiveLyrics from "../lyrics/LiveLyrics.jsx";
import TrackArtwork from "../ui/TrackArtwork.jsx";
import Icon from "../ui/Icon.jsx";


function formatQueueDuration(
  seconds,
) {
  const value =
    Number(
      seconds,
    );

  if (
    !Number.isFinite(
      value,
    )
    || value <= 0
  ) {
    return "";
  }

  const minutes =
    Math.floor(
      value / 60,
    );

  const remainder =
    Math.floor(
      value % 60,
    )
      .toString()
      .padStart(
        2,
        "0",
      );

  return (
    `${minutes}:${remainder}`
  );
}


function MobilePlayerDetails({
  open,
  onClose,
}) {
  const [
    activeTab,
    setActiveTab,
  ] = useState(
    "lyrics",
  );

  const [
    playerState,
    setPlayerState,
  ] = useState(
    () => player.getState(),
  );

  const [
    switchingIndex,
    setSwitchingIndex,
  ] = useState(
    null,
  );


  useEffect(() => {
    return player.subscribe(
      setPlayerState,
    );
  }, []);


  useEffect(() => {
    if (!open) {
      return;
    }

    setActiveTab(
      "lyrics",
    );
  }, [
    open,
  ]);


  const queue =
    useMemo(
      () => (
        Array.isArray(
          playerState.queue,
        )
          ? playerState.queue
          : []
      ),
      [
        playerState.queue,
      ],
    );


  const currentQueueTrack =
    Number.isInteger(
      playerState.queueIndex,
    )
      ? queue[
          playerState.queueIndex
        ] ??
        null
      : null;


  const title =
    playerState.title ||
    currentQueueTrack
      ?.meta
      ?.title ||
    "Nothing playing";

  const artist =
    playerState.artist ||
    currentQueueTrack
      ?.meta
      ?.artist ||
    "";

  const album =
    playerState.album ||
    currentQueueTrack
      ?.meta
      ?.album ||
    "";

  const artworkUrl =
    playerState.artworkUrl ??
    currentQueueTrack
      ?.meta
      ?.artworkUrl ??
    null;


  async function playQueueItem(
    index,
  ) {
    if (
      index ===
      playerState.queueIndex
    ) {
      return;
    }

    setSwitchingIndex(
      index,
    );

    try {
      await player.playQueueIndex(
        index,
      );
    } catch {
      // The shared player state exposes
      // playback errors to the rest of the UI.
    } finally {
      setSwitchingIndex(
        null,
      );
    }
  }


  if (!open) {
    return null;
  }


  return (
    <section
      className="mobile-player-details"
      role="dialog"
      aria-modal="true"
      aria-label="Lyrics and queue"
    >
      <header className="mobile-player-details__topbar">
        <div>
          <span>
            NOW PLAYING
          </span>

          <strong>
            Lyrics & Queue
          </strong>
        </div>

        <button
          type="button"
          className="mobile-player-details__close"
          onClick={
            onClose
          }
          aria-label="Close lyrics and queue"
        >
          <Icon
            name="close"
            size={21}
          />
        </button>
      </header>


      <div className="mobile-player-details__track">
        <TrackArtwork
          src={
            artworkUrl
          }
          alt={
            title
          }
          variant={2}
        />

        <div>
          <strong>
            {title}
          </strong>

          <span>
            {[
              artist,
              album,
            ]
              .filter(Boolean)
              .join(" • ") ||
              "Select a track to start listening"}
          </span>
        </div>
      </div>


      <nav
        className="mobile-player-details__tabs"
        aria-label="Player details"
      >
        <button
          type="button"
          className={
            activeTab ===
            "lyrics"
              ? "is-active"
              : ""
          }
          aria-pressed={
            activeTab ===
            "lyrics"
          }
          onClick={() => {
            setActiveTab(
              "lyrics",
            );
          }}
        >
          Lyrics
        </button>

        <button
          type="button"
          className={
            activeTab ===
            "queue"
              ? "is-active"
              : ""
          }
          aria-pressed={
            activeTab ===
            "queue"
          }
          onClick={() => {
            setActiveTab(
              "queue",
            );
          }}
        >
          Queue

          {queue.length > 0 ? (
            <span>
              {queue.length}
            </span>
          ) : null}
        </button>
      </nav>


      <div className="mobile-player-details__body">
        {activeTab ===
        "lyrics" ? (
          <div className="mobile-player-details__lyrics">
            <LiveLyrics />
          </div>
        ) : (
          <div className="mobile-player-details__queue">
            {queue.length > 0 ? (
              queue.map(
                (
                  entry,
                  index,
                ) => {
                  const meta =
                    entry?.meta ??
                    {};

                  const isCurrent =
                    index ===
                    playerState.queueIndex;

                  const isPast =
                    Number.isInteger(
                      playerState.queueIndex,
                    ) &&
                    index <
                      playerState.queueIndex;

                  return (
                    <button
                      key={
                        String(
                          entry?.id ??
                          "track",
                        ) +
                        "-" +
                        index
                      }
                      type="button"
                      className={[
                        "mobile-player-details__queue-row",
                        isCurrent
                          ? "is-current"
                          : "",
                        isPast
                          ? "is-past"
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() => {
                        void playQueueItem(
                          index,
                        );
                      }}
                      disabled={
                        switchingIndex !==
                          null
                      }
                      aria-current={
                        isCurrent
                          ? "true"
                          : undefined
                      }
                    >
                      <span className="mobile-player-details__queue-index">
                        {isCurrent
                          ? (
                              playerState.paused
                                ? "Ⅱ"
                                : "▶"
                            )
                          : index + 1}
                      </span>

                      <TrackArtwork
                        src={
                          meta.artworkUrl ??
                          meta.artwork_url ??
                          null
                        }
                        alt={
                          meta.title ??
                          "Queued track"
                        }
                        variant={
                          (
                            index %
                            4
                          ) +
                          1
                        }
                      />

                      <span className="mobile-player-details__queue-copy">
                        <strong>
                          {meta.title ||
                            "Queued track"}
                        </strong>

                        <small>
                          {[
                            meta.artist,
                            meta.album,
                            formatQueueDuration(
                              meta.durationSeconds ??
                              meta.duration_seconds,
                            ),
                          ]
                            .filter(Boolean)
                            .join(" • ") ||
                            (
                              isCurrent
                                ? "Now playing"
                                : isPast
                                  ? "Played"
                                  : "Up next"
                            )}
                        </small>
                      </span>

                      {switchingIndex ===
                      index ? (
                        <span className="mobile-player-details__queue-loading" />
                      ) : isCurrent ? (
                        <span className="mobile-player-details__queue-status">
                          NOW
                        </span>
                      ) : null}
                    </button>
                  );
                },
              )
            ) : (
              <div className="mobile-player-details__empty">
                <Icon
                  name="music"
                  size={29}
                />

                <strong>
                  Queue is empty
                </strong>

                <p>
                  Start a track or playlist and
                  upcoming songs will appear here.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}


export default MobilePlayerDetails;
