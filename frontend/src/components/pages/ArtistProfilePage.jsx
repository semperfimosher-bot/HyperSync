import {
  useCallback,
  useEffect,
  useState,
} from "react";

import * as player from
  "../../audioPlayer.js";

import {
  followArtist,
  getArtistProfile,
  unfollowArtist,
} from "../../artistApi.js";

import {
  resolveArtworkUrl,
} from "../../artworkUrl.js";

import useOnlineStatus from
  "../../hooks/useOnlineStatus.js";

import Icon from "../ui/Icon.jsx";
import OfflineNotice from
  "../ui/OfflineNotice.jsx";
import TrackArtwork from
  "../ui/TrackArtwork.jsx";


function statValue(
  value,
) {
  return new Intl.NumberFormat(
    undefined,
    {
      notation:
        Number(value) >= 10000
          ? "compact"
          : "standard",
      maximumFractionDigits: 1,
    },
  ).format(
    Number(value) || 0,
  );
}


function trackMeta(
  track,
) {
  return {
    audioUrl:
      track.audio_url,
    artworkUrl:
      track.artwork_url,
    title:
      track.title,
    artist:
      track.artist,
    album:
      track.album ?? "",
    mimeType:
      track.mime_type ?? null,
    fileSize:
      track.file_size ?? null,
    mediaVersion:
      track.media_version ?? null,
  };
}


export default function ArtistProfilePage({
  artistName,
  currentUser,
  onOpenAuth,
  onBack,
}) {
  const online =
    useOnlineStatus();

  const [
    profile,
    setProfile,
  ] = useState(null);

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    error,
    setError,
  ] = useState("");

  const [
    followBusy,
    setFollowBusy,
  ] = useState(false);


  const load =
    useCallback(
      async () => {
        if (
          !artistName
          || !online
        ) {
          setLoading(
            false,
          );
          return;
        }

        setLoading(
          true,
        );
        setError(
          "",
        );

        try {
          setProfile(
            await getArtistProfile(
              artistName,
            ),
          );
        } catch (loadError) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load artist.",
          );
        } finally {
          setLoading(
            false,
          );
        }
      },
      [
        artistName,
        online,
      ],
    );


  useEffect(() => {
    void load();
  }, [
    load,
  ]);


  async function toggleFollow() {
    if (
      currentUser?.account_type !==
      "registered"
    ) {
      onOpenAuth?.();
      return;
    }

    if (
      !profile
      || followBusy
    ) {
      return;
    }

    setFollowBusy(
      true,
    );

    try {
      const next =
        profile.is_following
          ? await unfollowArtist(
              profile.name,
            )
          : await followArtist(
              profile.name,
            );

      setProfile(
        next,
      );
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Unable to update artist follow.",
      );
    } finally {
      setFollowBusy(
        false,
      );
    }
  }


  function playTracks(
    tracks,
    startIndex = 0,
  ) {
    const queue = (
      Array.isArray(
        tracks,
      )
        ? tracks
        : []
    ).map(
      (track) => ({
        id:
          track.id,
        meta:
          trackMeta(
            track,
          ),
      }),
    );

    if (!queue.length) {
      return;
    }

    void player.playTrackQueue(
      queue,
      startIndex,
    ).catch(
      () => {},
    );
  }


  if (!online) {
    return (
      <div className="hs-artist-profile-page">
        <button
          type="button"
          className="hs-artist-back"
          onClick={
            onBack
          }
        >
          <Icon
            name="chevron"
            size={16}
          />
          Back
        </button>

        <OfflineNotice
          title="Go back online to see this artist"
          description="Artist profiles, follower stats, releases, and live catalog information sync from HyperSync."
        />
      </div>
    );
  }


  if (
    loading
    && !profile
  ) {
    return (
      <div className="hs-artist-profile-page">
        <div className="hs-profile-skeleton" />
        <div className="hs-profile-skeleton" />
      </div>
    );
  }


  if (
    error
    && !profile
  ) {
    return (
      <div className="hs-artist-profile-page">
        <button
          type="button"
          className="hs-artist-back"
          onClick={
            onBack
          }
        >
          <Icon
            name="chevron"
            size={16}
          />
          Back
        </button>

        <section className="hs-locked-card">
          <Icon
            name="music"
            size={30}
          />

          <h2>
            Artist unavailable
          </h2>

          <p>
            {error}
          </p>
        </section>
      </div>
    );
  }


  if (!profile) {
    return null;
  }

  const popular =
    profile.popular_tracks ?? [];

  const releases =
    profile.new_releases ?? [];

  return (
    <div className="hs-artist-profile-page">
      <button
        type="button"
        className="hs-artist-back"
        onClick={
          onBack
        }
      >
        <Icon
          name="chevron"
          size={16}
        />
        Back to search
      </button>

      <section className="hs-artist-hero">
        <div className="hs-artist-hero__art">
          {resolveArtworkUrl(
            profile.artwork_url,
          ) ? (
            <img
              src={
                resolveArtworkUrl(
                  profile.artwork_url,
                )
              }
              alt=""
            />
          ) : (
            <Icon
              name="music"
              size={54}
            />
          )}
        </div>

        <div className="hs-artist-hero__copy">
          <span className="hs-eyebrow">
            ARTIST
          </span>

          <h1>
            {profile.name}
          </h1>

          <p>
            {profile.bio ||
              `${statValue(
                profile.monthly_listeners,
              )} monthly listeners`}
          </p>

          <div className="hs-artist-hero__actions">
            <button
              type="button"
              className="hs-primary-button"
              disabled={
                !popular.length
              }
              onClick={() => {
                playTracks(
                  popular,
                  0,
                );
              }}
            >
              <Icon
                name="play"
                size={17}
              />
              Play
            </button>

            <button
              type="button"
              className={
                profile.is_following
                  ? "hs-artist-follow is-following"
                  : "hs-artist-follow"
              }
              disabled={
                followBusy
              }
              onClick={() => {
                void toggleFollow();
              }}
            >
              {followBusy
                ? "Updating..."
                : profile.is_following
                  ? "Following"
                  : "Follow"}
            </button>
          </div>
        </div>
      </section>

      <section className="hs-artist-stats">
        <div>
          <strong>
            {statValue(
              profile.monthly_listeners,
            )}
          </strong>
          <span>
            Monthly listeners
          </span>
        </div>

        <div>
          <strong>
            {statValue(
              profile.followers_count,
            )}
          </strong>
          <span>
            Followers
          </span>
        </div>

        <div>
          <strong>
            {statValue(
              profile.total_plays,
            )}
          </strong>
          <span>
            Total plays
          </span>
        </div>

        <div>
          <strong>
            {profile.track_count}
          </strong>
          <span>
            Songs
          </span>
        </div>
      </section>

      {error ? (
        <p className="auth-message">
          {error}
        </p>
      ) : null}

      <section className="hs-profile-section">
        <header className="hs-section-header">
          <div>
            <span className="hs-eyebrow">
              MOST PLAYED
            </span>
            <h2>
              Popular
            </h2>
          </div>
        </header>

        {popular.length ? (
          <div className="hs-artist-track-list">
            {popular.map(
              (
                track,
                index,
              ) => (
                <button
                  type="button"
                  key={track.id}
                  onClick={() => {
                    playTracks(
                      popular,
                      index,
                    );
                  }}
                >
                  <span className="hs-artist-track-list__rank">
                    {index + 1}
                  </span>

                  <TrackArtwork
                    src={
                      track.artwork_url
                    }
                    alt={
                      track.title
                    }
                    variant={1}
                  />

                  <span className="hs-artist-track-list__copy">
                    <strong>
                      {track.title}
                    </strong>
                    <small>
                      {track.album ||
                        profile.name}
                    </small>
                  </span>

                  <em>
                    {statValue(
                      track.global_play_count,
                    )}
                    {" "}
                    plays
                  </em>

                  <Icon
                    name="play"
                    size={16}
                  />
                </button>
              ),
            )}
          </div>
        ) : (
          <div className="hs-empty-card">
            <strong>
              No music yet
            </strong>
            <p>
              New uploads by this artist will appear here automatically.
            </p>
          </div>
        )}
      </section>

      <section className="hs-profile-section">
        <header className="hs-section-header">
          <div>
            <span className="hs-eyebrow">
              FRESH FROM THE CATALOG
            </span>
            <h2>
              New Releases
            </h2>
          </div>
        </header>

        {releases.length ? (
          <div className="hs-recent-grid">
            {releases.map(
              (
                track,
                index,
              ) => (
                <button
                  type="button"
                  className="hs-recent-card"
                  key={track.id}
                  onClick={() => {
                    playTracks(
                      releases,
                      index,
                    );
                  }}
                >
                  <div className="hs-recent-card__art">
                    <TrackArtwork
                      src={
                        track.artwork_url
                      }
                      alt={
                        track.title
                      }
                      variant={1}
                    />
                    <span className="hs-play-overlay">
                      <Icon
                        name="play"
                        size={20}
                      />
                    </span>
                  </div>

                  <strong>
                    {track.title}
                  </strong>
                  <span>
                    {track.album ||
                      "Single"}
                  </span>
                </button>
              ),
            )}
          </div>
        ) : null}
      </section>

      <section className="hs-profile-section">
        <header className="hs-section-header">
          <div>
            <span className="hs-eyebrow">
              DISCOGRAPHY
            </span>
            <h2>
              Albums & Singles
            </h2>
          </div>
        </header>

        <div className="hs-artist-albums">
          {(profile.albums ?? []).map(
            (album) => (
              <article
                key={
                  album.title
                }
              >
                <div className="hs-artist-albums__art">
                  {resolveArtworkUrl(
                    album.artwork_url,
                  ) ? (
                    <img
                      src={
                        resolveArtworkUrl(
                          album.artwork_url,
                        )
                      }
                      alt=""
                    />
                  ) : (
                    <Icon
                      name="disc"
                      size={30}
                    />
                  )}
                </div>

                <strong>
                  {album.title}
                </strong>

                <span>
                  {album.track_count}
                  {" "}
                  {album.track_count === 1
                    ? "song"
                    : "songs"}
                </span>
              </article>
            ),
          )}
        </div>
      </section>
    </div>
  );
}
