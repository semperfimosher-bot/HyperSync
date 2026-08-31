import {
  useEffect,
  useState,
} from "react";

import * as player
  from "../../audioPlayer.js";

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


function DesktopRightRail() {
  const [
    state,
    setState,
  ] = useState(() => ({
    src: null,
    artworkUrl: null,
    title: "",
    artist: "",
    paused: true,
    currentTime: 0,
    duration: 0,
  }));

  const [
    activeTab,
    setActiveTab,
  ] = useState("queue");


  useEffect(() => {
    const unsubscribe =
      player.subscribe(
        (nextState) => {
          setState(
            nextState,
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
              "right-rail-list"
            }
          >
            <span>
              Queue is empty
            </span>

            <small>
              Add tracks to your
              queue to see them
              here.
            </small>
          </div>

        )}

      </div>

    </aside>
  );
}


export default DesktopRightRail;
