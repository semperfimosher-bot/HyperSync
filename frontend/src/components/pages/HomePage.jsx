import { useEffect, useState } from "react";

import {
  API_BASE,
  apiRequest,
} from "../../api/client.js";

import * as player from "../../audioPlayer.js";

import {
  getGreetingName,
} from "../../utils/user.js";

import SectionHeading from "../ui/SectionHeading.jsx";

function HomePage({
  currentUser,
  onNavigate,
  onOpenAuth,
}) {
  const greetingName =
    getGreetingName(currentUser);

  const [tracks, setTracks] = useState([]);
  const [catalogError, setCatalogError] =
    useState("");

  const resolveArtworkUrl = (url) => {
  if (!url) return null;

  if (
    url.startsWith("http://") ||
    url.startsWith("https://")
  ) {
    return url;
  }

  return `${API_BASE}${url.replace(/^\/api/, "")}`;
  };

useEffect(() => {
  let cancelled = false;

  async function loadTracks() {
    try {
      const data = await apiRequest(
        "/catalog/tracks",
      );

      if (cancelled) return;

      setTracks(data || []);
      setCatalogError("");
    } catch (error) {
      if (!cancelled) {
        setTracks([]);

        setCatalogError(
          error instanceof Error
            ? error.message
            : "Unable to load catalog.",
        );
      }
    }
  }

  loadTracks();

  return () => {
    cancelled = true;
  };
}, []);


useEffect(() => {
  const handleTrackDeleted = (event) => {
    const trackId = event.detail?.trackId;

    if (!trackId) {
      return;
    }

    setTracks((current) =>
      current.filter(
        (track) => track.id !== trackId,
      ),
    );
  };

  window.addEventListener(
    "hypersync:track-deleted",
    handleTrackDeleted,
  );

  return () => {
    window.removeEventListener(
      "hypersync:track-deleted",
      handleTrackDeleted,
    );
  };
}, []);

  const playTrack = async (
    trackId,
    track = null,
  ) => {
    if (!trackId) return;

    try {
      await player.playTrack(trackId, {
        artworkUrl:
            resolveArtworkUrl(
          track?.artwork_url,
  ),
        title:
          track?.title ?? "",
        artist:
          track?.artist ?? "",
      });
    } catch (error) {
      setCatalogError(
        error instanceof Error
          ? error.message
          : "Playback failed.",
      );
    }
  };

  return (
    <div className="page-stack home-page">

      {/* =====================================================
          HYPERSYNC HERO
          ===================================================== */}

      <section
        className="home-hero-image"
        aria-label="HyperSync"
      >

        <div className="home-hero-image__status">

          <span>
            <i />

            {currentUser
              ? `SYNCED • ${greetingName}`
              : "GUEST MODE"}
          </span>

          {!currentUser ? (
            <button
              type="button"
              onClick={onOpenAuth}
            >
              Sign in →
            </button>
          ) : null}

        </div>
      </section>


      {/* =====================================================
          RECENTLY PLAYED
          ===================================================== */}

      <section className="home-music-section">

        <SectionHeading
          title="Recently Played"
          actionLabel="View all"
          onAction={() =>
            onNavigate("library")
          }
        />

        {catalogError ? (
          <div className="empty-content-card">
            <div>
              <strong>
                Catalog unavailable
              </strong>

              <p>
                {catalogError}
              </p>
            </div>
          </div>
        ) : tracks.length > 0 ? (

          <div className="home-track-grid">

            {tracks
              .slice(0, 6)
              .map((track, index) => (

                <button
                  key={track.id}
                  type="button"
                  className="home-track-card"
                  onClick={() =>
                    playTrack(
                      track.id,
                      track,
                    )
                  }
                >

                  <div className="home-track-card__art">

                    {track.artwork_url ? (
                     <img
  src={resolveArtworkUrl(track.artwork_url)}
  alt=""
/>
                    ) : (
                      <div
                        className={
                          "home-track-card__fallback " +
                          `home-track-card__fallback--${
                            (index % 4) + 1
                          }`
                        }
                      >
                        H
                      </div>
                    )}

                    <span className="home-track-card__play">
                      ▶
                    </span>

                  </div>

                  <div className="home-track-card__info">

                    <strong>
                      {track.title}
                    </strong>

                    <small>
                      {track.artist}
                    </small>

                  </div>

                </button>

              ))}

          </div>

        ) : (

          <div className="home-empty-state">

            <div className="home-empty-state__icon">
              ♫
            </div>

            <div>
              <strong>
                Your library is ready
              </strong>

              <p>
                Upload music to start
                building your HyperSync
                collection.
              </p>
            </div>

          </div>

        )}

      </section>


      {/* =====================================================
          QUICK ACTIONS
          ===================================================== */}

      <section className="home-quick-actions">

        <button
          type="button"
          onClick={() =>
            onNavigate("search")
          }
        >
          <span>
            ⌕
          </span>

          <div>
            <strong>
              Search your music
            </strong>

            <small>
              Find songs, artists, and albums.
            </small>
          </div>

          <b>→</b>
        </button>


        <button
          type="button"
          onClick={() =>
            onNavigate("library")
          }
        >
          <span>
            ♫
          </span>

          <div>
            <strong>
              Open your library
            </strong>

            <small>
              Browse your complete collection.
            </small>
          </div>

          <b>→</b>
        </button>

      </section>

    </div>
  );
}

export default HomePage;
