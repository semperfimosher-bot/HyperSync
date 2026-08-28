import {
  useEffect,
  useState,
} from "react";

import {
  getCachedObjectUrl,
  resolveMediaUrl,
} from "../../mediaCache.js";

import {
  useCatalogTracks,
} from "../../catalogStore.js";

import { API_BASE } from "../../api/client.js";

import * as player from "../../audioPlayer.js";

import {
  getGreetingName,
} from "../../utils/user.js";

import SectionHeading from "../ui/SectionHeading.jsx";

function CachedArtwork({
  src,
  alt,
}) {
  const [displaySrc, setDisplaySrc] =
    useState(
      src ?? null,
    );

  useEffect(() => {
    let cancelled =
      false;

    let objectUrl =
      null;

    setDisplaySrc(
      src ?? null,
    );

    if (!src) {
      return undefined;
    }

    const loadCachedArtwork =
      async () => {
        try {
          const cachedUrl =
            await getCachedObjectUrl(
              src,
            );

          if (!cachedUrl) {
            return;
          }

          if (cancelled) {
            URL.revokeObjectURL(
              cachedUrl,
            );

            return;
          }

          objectUrl =
            cachedUrl;

          setDisplaySrc(
            cachedUrl,
          );
        } catch {
          // Fall back to the normal URL.
        }
      };

    void loadCachedArtwork();

    return () => {
      cancelled =
        true;

      if (objectUrl) {
        URL.revokeObjectURL(
          objectUrl,
        );
      }
    };
  }, [src]);

  return (
    <img
      src={displaySrc ?? src}
      alt={alt}
    />
  );
}

function HomePage({
  currentUser,
  onNavigate,
  onOpenAuth,
}) {
  const greetingName =
    getGreetingName(currentUser);

  const {
  tracks,
  error: catalogError,
} = useCatalogTracks();

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
        aria-label="Hypersync"
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
