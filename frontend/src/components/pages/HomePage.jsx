import {
  useEffect,
  useState,
} from "react";

import {
  getCachedObjectUrl,
  resolveMediaUrl,
} from "../../mediaCache.js";

import {
  resolveArtworkUrl,
} from "../../artworkUrl.js";

import * as player from "../../audioPlayer.js";

import {
  getGreetingName,
} from "../../utils/user.js";

import SectionHeading from "../ui/SectionHeading.jsx";

import {
  getMyProfile,
} from "../../profileApi.js";

import {
  getHomeRecentlyPlayed,
} from "../../homeRecentlyPlayed.js";

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

  const [
  recentlyPlayed,
  setRecentlyPlayed,
] = useState([]);

const [
  recentLoading,
  setRecentLoading,
] = useState(
  Boolean(currentUser),
);

const [
  recentError,
  setRecentError,
] = useState("");

useEffect(() => {
  let cancelled =
    false;

  async function loadRecentlyPlayed() {
    if (!currentUser) {
      setRecentlyPlayed(
        [],
      );

      setRecentLoading(
        false,
      );

      setRecentError(
        "",
      );

      return;
    }

    setRecentLoading(
      true,
    );

    setRecentError(
      "",
    );

    try {
      const profile =
        await getMyProfile();

      if (cancelled) {
        return;
      }

      setRecentlyPlayed(
        getHomeRecentlyPlayed(
          profile,
        ),
      );
    } catch (error) {
      if (cancelled) {
        return;
      }

      setRecentlyPlayed(
        [],
      );

      setRecentError(
        error instanceof Error
          ? error.message
          : "Unable to load recently played.",
      );
    } finally {
      if (!cancelled) {
        setRecentLoading(
          false,
        );
      }
    }
  }

  void loadRecentlyPlayed();

  return () => {
    cancelled =
      true;
  };
}, [currentUser]);



  const playTrack = async (
    trackId,
    track = null,
  ) => {
    if (!trackId) return;

    try {
      await player.playTrack(
  trackId,
  {
    audioUrl:
      track?.audio_url ??
      null,

    artworkUrl:
      resolveArtworkUrl(
        track?.artwork_url,
      ),

    title:
      track?.title ?? "",

    artist:
      track?.artist ?? "",

    mimeType:
      track?.mime_type ??
      null,

    fileSize:
      track?.file_size ??
      null,

    mediaVersion:
      track?.media_version ??
      null,
  },
);
        } catch (error) {
      setRecentError(
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
          onAction={() => {
  if (currentUser) {
    onNavigate(
      "profile",
    );
  } else {
    onOpenAuth();
  }
}}
        />

          {recentLoading ? (

  <div className="home-empty-state">

    <div className="home-empty-state__icon">
      ♫
    </div>

    <div>
      <strong>
        Loading your rotation
      </strong>

      <p>
        Syncing your recent listening
        history.
      </p>
    </div>

  </div>

) : recentError ? (

  <div className="empty-content-card">

    <div>
      <strong>
        Recently played unavailable
      </strong>

      <p>
        {recentError}
      </p>
    </div>

  </div>

) : !currentUser ? (

  <div className="home-empty-state">

    <div className="home-empty-state__icon">
      ♫
    </div>

    <div>
      <strong>
        Sign in to see your rotation
      </strong>

      <p>
        Your listening history will
        appear here after you sign in.
      </p>
    </div>

  </div>

) : recentlyPlayed.length > 0 ? (

  <div className="home-track-grid">

    {recentlyPlayed.map(
      (track, index) => (

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
                src={
                  resolveArtworkUrl(
                    track.artwork_url,
                  )
                }
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

      ),
    )}

  </div>

) : (

  <div className="home-empty-state">

    <div className="home-empty-state__icon">
      ♫
    </div>

    <div>
      <strong>
        Your rotation is waiting
      </strong>

      <p>
        Start listening and your
        recently played tracks will
        appear here.
      </p>
    </div>

  </div>

)}
     </section>
           </div>
  );
}

export default HomePage;