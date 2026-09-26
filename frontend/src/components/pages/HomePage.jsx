import {
  useCallback,
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

import TrackActionMenu from
  "../music/TrackActionMenu.jsx";

import useTrackActionMenu from
  "../../hooks/useTrackActionMenu.js";

import useQuietRefresh from
  "../../hooks/useQuietRefresh.js";

import useOnlineStatus from
  "../../hooks/useOnlineStatus.js";

import OfflineNotice from
  "../ui/OfflineNotice.jsx";

import {
  getMyProfile,
} from "../../profileApi.js";

import {
  getHomeRecentlyPlayed,
} from "../../homeRecentlyPlayed.js";

import {
  getDownloadedTracks,
} from "../../offlineDownloads.js";

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
  const online =
    useOnlineStatus();

  const trackActionMenu =
    useTrackActionMenu();

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

const loadDownloadedFallback =
  useCallback(
    async () => {
      try {
        return (
          await getDownloadedTracks()
        ).slice(
          0,
          12,
        );
      } catch {
        return [];
      }
    },
    [],
  );


const loadRecentlyPlayed =
  useCallback(
    async ({
      quiet = false,
    } = {}) => {
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

      if (!quiet) {
        setRecentLoading(
          true,
        );

        setRecentError(
          "",
        );
      }

      const offline =
        typeof navigator !==
          "undefined" &&
        navigator.onLine ===
          false;

      if (offline) {
        const localTracks =
          await loadDownloadedFallback();

        setRecentlyPlayed(
          localTracks,
        );

        if (!quiet) {
          setRecentError(
            localTracks.length > 0
              ? ""
              : "No downloaded tracks are available offline yet.",
          );

          setRecentLoading(
            false,
          );
        }

        return;
      }

      try {
        const profile =
          await getMyProfile();

        setRecentlyPlayed(
          getHomeRecentlyPlayed(
            profile,
          ),
        );

        setRecentError(
          "",
        );
      } catch (error) {
        const localTracks =
          await loadDownloadedFallback();

        if (
          localTracks.length > 0
        ) {
          setRecentlyPlayed(
            localTracks,
          );

          setRecentError(
            "",
          );
        } else if (!quiet) {
          setRecentlyPlayed(
            [],
          );

          setRecentError(
            error instanceof Error
              ? error.message
              : "Unable to load recently played.",
          );
        }
      } finally {
        if (!quiet) {
          setRecentLoading(
            false,
          );
        }
      }
    },
    [
      currentUser,
      loadDownloadedFallback,
    ],
  );


useEffect(() => {
  void loadRecentlyPlayed();
}, [
  loadRecentlyPlayed,
]);


useQuietRefresh(
  () =>
    loadRecentlyPlayed({
      quiet:
        true,
    }),
  {
    enabled:
      Boolean(
        currentUser,
      ),
    intervalMs:
      30_000,
  },
);

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

    album:
      track?.album ?? "",

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

          {!online && currentUser ? (
  <OfflineNotice
    compact
    title="Go back online to see Recently Played"
    description="Your real listening history syncs from your HyperSync account. Downloaded music is still available in Library."
  />
) : recentLoading ? (

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
          {...trackActionMenu.getTriggerProps(
            track,
          )}
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

           </div>
  );
}

export default HomePage;