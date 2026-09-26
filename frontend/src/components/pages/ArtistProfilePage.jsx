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

import useTrackActionMenu from
  "../../hooks/useTrackActionMenu.js";

import Icon from "../ui/Icon.jsx";
import OfflineNotice from
  "../ui/OfflineNotice.jsx";
import TrackArtwork from
  "../ui/TrackArtwork.jsx";

import TrackActionMenu from
  "../music/TrackActionMenu.jsx";


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


function formatTrackDuration(
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
    return "--:--";
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


function formatReleaseDate(
  value,
) {
  if (!value) {
    return "";
  }

  const date =
    new Date(
      value,
    );

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return "";
  }

  return date.toLocaleDateString(
    [],
    {
      year:
        "numeric",
      month:
        "short",
      day:
        "numeric",
    },
  );
}



export default function ArtistProfilePage({
  artistName,
  currentUser,
  onOpenAuth,
  onBack,
}) {
  const online =
    useOnlineStatus();

  const trackActionMenu =
    useTrackActionMenu();

  const [
    playbackState,
    setPlaybackState,
  ] = useState(
    () => player.getState(),
  );

  const currentTrackId =
    playbackState?.trackId
      ? String(
          playbackState.trackId,
        )
      : null;

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


  useEffect(() => {
    return player.subscribe(
      setPlaybackState,
    );
  }, []);


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
        audioUrl:
          track.audio_url ??
          null,
        artworkUrl:
          resolveArtworkUrl(
            track.artwork_url,
          ),
        mimeType:
          track.mime_type ??
          null,
        fileSize:
          track.file_size ??
          null,
        mediaVersion:
          track.media_version ??
          null,
        artworkVersion:
          track.artwork_version ??
          null,
        durationSeconds:
          track.duration_seconds ??
          null,
        title:
          track.title ??
          "",
        artist:
          track.artist ??
          "",
        album:
          track.album ??
          "",

        genre:
          track.genre ??
          "",

        releaseYear:
          track.release_year ??
          track.releaseYear ??
          null,
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


  function playArtistTrack(
    track,
  ) {
    if (!track?.id) {
      return;
    }

    const trackId =
      String(
        track.id,
      );

    if (
      currentTrackId ===
      trackId
    ) {
      void player
        .togglePlay()
        .catch(
          () => {},
        );

      return;
    }

    const index =
      songs.findIndex(
        (candidate) =>
          String(
            candidate.id,
          ) ===
          trackId,
      );

    playTracks(
      songs.length
        ? songs
        : [track],
      index >= 0
        ? index
        : 0,
    );
  }


  if (!online) {
    return (
      <div className="hs-profile-page hs-artist-profile-page">
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
          description="Artist profiles, follower stats, releases, and live catalog information sync from HyperSynced."
        />
      </div>
    );
  }


  if (
    loading
    && !profile
  ) {
    return (
      <div className="hs-profile-page hs-artist-profile-page">
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
      <div className="hs-profile-page hs-artist-profile-page">
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

  const songs =
    profile.tracks ?? [];

  const popular =
    profile.popular_tracks ?? [];

  const releases =
    profile.new_releases ?? [];

  return (
    <div className="hs-profile-page hs-artist-profile-page">
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

      <section className="hs-profile-hero hs-artist-hero">
        <div
          className="hs-profile-hero__ambient"
          aria-hidden="true"
        />
        <div className="hs-profile-hero__avatar hs-artist-hero__art">
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

        <div className="hs-profile-hero__identity hs-artist-hero__copy">
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
                !songs.length
              }
              onClick={() => {
                playTracks(
                  songs,
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

      <section className="hs-profile-stats hs-artist-stats">
        <div className="hs-profile-stat">
          <Icon
            name="headphones"
            size={19}
          />

          <strong>
            {statValue(
              profile.monthly_listeners,
            )}
          </strong>

          <span>
            Monthly listeners
          </span>
        </div>

        <div className="hs-profile-stat">
          <Icon
            name="people"
            size={19}
          />

          <strong>
            {statValue(
              profile.followers_count,
            )}
          </strong>

          <span>
            Followers
          </span>
        </div>

        <div className="hs-profile-stat">
          <Icon
            name="play"
            size={19}
          />

          <strong>
            {statValue(
              profile.total_plays,
            )}
          </strong>

          <span>
            Total plays
          </span>
        </div>

        <div className="hs-profile-stat">
          <Icon
            name="music"
            size={19}
          />

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
                    playArtistTrack(
                      track,
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

      <section className="hs-profile-section hs-artist-songs-section">
        <header className="hs-section-header">
          <div>
            <span className="hs-eyebrow">
              FULL CATALOG
            </span>
            <h2>
              Songs
            </h2>
          </div>

          <span className="hs-artist-song-count">
            {songs.length}
            {" "}
            {songs.length === 1
              ? "song"
              : "songs"}
          </span>
        </header>

        {songs.length ? (
          <div className="hs-search-track-list hs-artist-library-track-list">
            {songs.map(
              (
                track,
                index,
              ) => {
                const artwork =
                  resolveArtworkUrl(
                    track.artwork_url,
                  );

                const isCurrentTrack =
                  currentTrackId !== null
                  && String(
                    track.id,
                  ) ===
                    currentTrackId;

                const releaseYear =
                  track.release_year ??
                  null;

                const playTrack =
                  () => {
                    playArtistTrack(
                      track,
                    );
                  };

                return (
                  <div
                    key={
                      String(
                        track.id,
                      )
                    }
                    role="button"
                    tabIndex={0}
                    {...trackActionMenu.getTriggerProps(
                      track,
                    )}
                    className={[
                      "hs-search-track",
                      "hs-library-track-row",
                      "hs-artist-library-track-row",
                      isCurrentTrack
                        ? "is-current-track"
                        : "",
                    ]
                      .filter(
                        Boolean,
                      )
                      .join(
                        " ",
                      )}
                    onClick={
                      playTrack
                    }
                    onKeyDown={(
                      event,
                    ) => {
                      if (
                        event.key ===
                          "Enter"
                        || event.key ===
                          " "
                      ) {
                        event.preventDefault();
                        playTrack();
                      }
                    }}
                  >
                    <span className="hs-search-track__rank">
                      {String(
                        index + 1,
                      ).padStart(
                        2,
                        "0",
                      )}
                    </span>

                    <span className="hs-search-track__art">
                      {artwork ? (
                        <img
                          src={
                            artwork
                          }
                          alt=""
                        />
                      ) : (
                        <Icon
                          name="music"
                          size={20}
                        />
                      )}

                      <i aria-hidden="true">
                        <Icon
                          name="play"
                          size={15}
                        />
                      </i>
                    </span>

                    <span className="hs-search-track__copy">
                      <strong>
                        {track.title}
                      </strong>

                      <small>
                        {track.artist ||
                          profile.name}

                        {track.album
                          ? ` • ${track.album}`
                          : " • Single"}
                      </small>
                    </span>

                    <span className="hs-search-track__signals">
                      <em>
                        {track.genre ||
                          "Unknown genre"}
                      </em>

                      <small>
                        {track.album ||
                          "Single"}
                        {releaseYear
                          ? ` • ${releaseYear}`
                          : ""}
                        {" • "}
                        {statValue(
                          track.global_play_count,
                        )}
                        {" "}
                        plays
                      </small>
                    </span>

                    <span className="hs-search-track__duration">
                      {formatTrackDuration(
                        track.duration_seconds,
                      )}
                    </span>

                    <span className="hs-search-track__play">
                      <Icon
                        name={
                          isCurrentTrack
                          && !playbackState?.paused
                            ? "pause"
                            : "play"
                        }
                        size={16}
                      />
                    </span>
                  </div>
                );
              },
            )}
          </div>
        ) : (
          <div className="hs-empty-card">
            <strong>
              No songs yet
            </strong>
            <p>
              Uploaded songs for this artist will appear here automatically.
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
                    playArtistTrack(
                      track,
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
                    {[
                      track.genre,
                      track.release_year,
                      track.album ||
                        "Single",
                    ]
                      .filter(Boolean)
                      .join(" • ")}
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
