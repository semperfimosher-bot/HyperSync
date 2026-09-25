import {
  useEffect,
  useState,
} from "react";

import * as player
  from "../../audioPlayer.js";

import {
  getUpcomingQueueEntries,
} from "../../playerQueue.js";

import {
  isSameRightRailPlayerState,
  selectRightRailPlayerState,
} from "../../rightRailPlayerState.js";

import {
  normalizeRightRailTab,
} from "../../rightRailTabs.js";

import LiveLyrics
  from "../lyrics/LiveLyrics.jsx";

import Icon
  from "../ui/Icon.jsx";

import {
  TrackArtwork,
} from "../ui/TrackArtwork.jsx";

import TrackActionMenu from
  "../music/TrackActionMenu.jsx";

import useTrackActionMenu from
  "../../hooks/useTrackActionMenu.js";


function DesktopRightRail({
  currentUser,
  onOpenAuth,
}) {
  const trackActionMenu =
    useTrackActionMenu();
  const [
    state,
    setState,
  ] = useState(
    () =>
      selectRightRailPlayerState(
        player.getState(),
      ),
  );

  const [
    activeTab,
    setActiveTab,
  ] = useState("queue");


  useEffect(() => {
    const unsubscribe =
      player.subscribe(
        (nextState) => {
          const nextRailState =
            selectRightRailPlayerState(
              nextState,
            );

          setState(
            (currentState) =>
              isSameRightRailPlayerState(
                currentState,
                nextRailState,
              )
                ? currentState
                : nextRailState,
          );
        },
      );

    return unsubscribe;
  }, []);


  const titleText =
    state.title
    || "No track selected";

  const hasTrack =
    Boolean(
      state.src,
    );

  const upcomingQueue =
  getUpcomingQueueEntries(
    state.queue,
    state.queueIndex,
  );

  const selectTab = (
    tab,
  ) => {
    setActiveTab(
      normalizeRightRailTab(
        tab,
      ),
    );
  };


  return (
    <aside
      className={
        "desktop-right-rail"
      }
    >

      <div
        className={
          "right-rail-heading"
        }
      >
        <span>
          Now playing
        </span>

        <h2>
          {titleText}
        </h2>
      </div>


      <div
        className={
          "right-rail-art"
        }
      >
        <TrackArtwork
          src={
            state.artworkUrl
          }
          alt={
            state.title
            || "No track artwork"
          }
          variant={2}
        />
      </div>


      {!hasTrack ? (
        <div
          className={
            "right-rail-empty"
          }
        >
          <Icon
            name="music"
            size={28}
          />

          <strong>
            Playback is waiting
          </strong>

          <p>
            Choose a track to
            start listening.
          </p>
        </div>
      ) : (
        <div
          className={
            "right-rail-track-copy"
          }
        >
          <strong>
            {state.artist
              || "Unknown artist"}
          </strong>
        </div>
      )}


      <div
        className={
          "right-rail-tabs"
        }
        role="tablist"
        aria-label={
          "Player details"
        }
      >

        <button
          type="button"
          role="tab"
          aria-selected={
            activeTab ===
            "queue"
          }
          className={
            activeTab ===
            "queue"
              ? "is-active"
              : ""
          }
          onClick={() => {
            selectTab(
              "queue",
            );
          }}
        >
          Queue
        </button>


        <button
          type="button"
          role="tab"
          aria-selected={
            activeTab ===
            "lyrics"
          }
          className={
            activeTab ===
            "lyrics"
              ? "is-active"
              : ""
          }
          onClick={() => {
            selectTab(
              "lyrics",
            );
          }}
        >
          Lyrics
        </button>

      </div>


      <div
        className={
          "right-rail-panel"
        }
      >

        {activeTab ===
        "lyrics" ? (

          <div
            className={
              "right-rail-lyrics"
            }
          >
            <LiveLyrics />
          </div>

        ) : (

          <div
  className={
    "right-rail-queue"
  }
>
  {upcomingQueue.length >
  0 ? (
    <>
      <div
        className={
          "right-rail-queue__heading"
        }
      >
        <span>
          UP NEXT
        </span>

        <small>
          {
            upcomingQueue.length
          }{" "}
          {upcomingQueue.length ===
          1
            ? "track"
            : "tracks"}
        </small>
      </div>

      <div
        className={
          "right-rail-queue__rows"
        }
      >
        {upcomingQueue.map(
          ({
            queueIndex,
            track,
          }) => (
            <button
              type="button"
              className={
                "right-rail-queue-row"
              }
              key={
                `${track.id}-${queueIndex}`
              }
              {...trackActionMenu.getTriggerProps({
                id:
                  track.id,
                title:
                  track.meta?.title ??
                  "",
                artist:
                  track.meta?.artist ??
                  "",
                album:
                  track.meta?.album ??
                  "",
                audio_url:
                  track.meta?.audioUrl ??
                  null,
                artwork_url:
                  track.meta?.artworkUrl ??
                  null,
                mime_type:
                  track.meta?.mimeType ??
                  null,
                file_size:
                  track.meta?.fileSize ??
                  null,
                media_version:
                  track.meta?.mediaVersion ??
                  null,
                artwork_version:
                  track.meta?.artworkVersion ??
                  null,
                duration_seconds:
                  track.meta?.durationSeconds ??
                  null,
              })}
              onClick={() => {
                void player
                  .playQueueIndex(
                    queueIndex,
                  )
                  .catch(
                    () => {},
                  );
              }}
              aria-label={
                `Play ${
                  track.meta
                    ?.title ||
                  "queued track"
                }`
              }
            >
              <span
                className={
                  "right-rail-queue-row__art"
                }
              >
                <TrackArtwork
                  src={
                    track.meta
                      ?.artworkUrl
                  }
                  alt={
                    track.meta
                      ?.title ||
                    "Track artwork"
                  }
                  variant={1}
                />
              </span>

              <span
                className={
                  "right-rail-queue-row__copy"
                }
              >
                <strong>
                  {track.meta
                    ?.title ||
                    "Untitled Track"}
                </strong>

                <small>
                  {[
                    track.meta?.artist ||
                      "Unknown artist",
                    track.meta?.album ||
                      "",
                  ]
                    .filter(Boolean)
                    .join(" • ")}
                </small>
              </span>

              <Icon
                name="chevron"
                size={12}
              />
            </button>
          ),
        )}
      </div>
    </>
  ) : (
    <div
      className={
        "right-rail-list"
      }
    >
      <span>
        Queue is empty
      </span>

      <small>
        Play a collection of
        tracks to see what is
        coming next.
      </small>
    </div>
  )}
</div>

        )}

      </div>

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

    </aside>
  );
}


export default DesktopRightRail;
