import {
  useCallback,
  useEffect,
  useState,
} from "react";

import * as player from "../../audioPlayer.js";

import {
  followUser,
  getPublicProfile,
  unfollowUser,
} from "../../profileApi.js";

import Avatar from "../profile/Avatar.jsx";
import SocialModal from "../profile/SocialModal.jsx";
import Icon from "../ui/Icon.jsx";
import TrackArtwork from "../ui/TrackArtwork.jsx";

import TrackActionMenu from
  "../music/TrackActionMenu.jsx";

import CollectionActionMenu from
  "../music/CollectionActionMenu.jsx";

import useTrackActionMenu from
  "../../hooks/useTrackActionMenu.js";

import useCollectionActionMenu from
  "../../hooks/useCollectionActionMenu.js";

import useQuietRefresh from
  "../../hooks/useQuietRefresh.js";

import useOnlineStatus from
  "../../hooks/useOnlineStatus.js";

import OfflineNotice from
  "../ui/OfflineNotice.jsx";


function memberFor(value) {
  if (!value) {
    return "New member";
  }

  const days =
    Math.max(
      0,
      Math.floor(
        (
          Date.now() -
          new Date(value).getTime()
        ) / 86400000,
      ),
    );

  if (days < 30) {
    return `Member for ${
      Math.max(days, 1)
    } day${days === 1 ? "" : "s"}`;
  }

  if (days < 365) {
    const months =
      Math.max(
        1,
        Math.floor(days / 30),
      );

    return `Member for ${months} month${
      months === 1 ? "" : "s"
    }`;
  }

  const years =
    Math.floor(days / 365);

  return `Member for ${years} year${
    years === 1 ? "" : "s"
  }`;
}


export default function PublicProfilePage({
  username,
  currentUser,
  onOpenAuth,
  onOpenProfile,
  onSearchArtist,
}) {
  const online =
    useOnlineStatus();

  const trackActionMenu =
    useTrackActionMenu();

  const collectionActionMenu =
    useCollectionActionMenu();

  const [profile, setProfile] =
    useState(null);

  const [loading, setLoading] =
    useState(true);

  const [acting, setActing] =
    useState(false);

  const [error, setError] =
    useState("");

  const [socialMode, setSocialMode] =
    useState("");


  const load =
    useCallback(
      async ({
        quiet = false,
      } = {}) => {
        if (!username) {
          return;
        }

        if (!online) {
          setLoading(false);
          setError("");
          return;
        }

        if (!quiet) {
          setLoading(true);
          setError("");
        }

        try {
          const data =
            await getPublicProfile(
              username,
            );

          setProfile(data);
          setError("");

        } catch (loadError) {
          if (!quiet) {
            setError(
              loadError instanceof Error
                ? loadError.message
                : "Unable to load profile.",
            );
          }

        } finally {
          if (!quiet) {
            setLoading(false);
          }
        }
      },
      [
        username,
        online,
      ],
    );


  useEffect(() => {
    void load();
  }, [
    load,
  ]);


  useQuietRefresh(
    () =>
      load({
        quiet:
          true,
      }),
    {
      enabled:
        Boolean(
          username
          && online,
        ),
      intervalMs:
        30_000,
    },
  );


  async function followAction() {
    if (!currentUser) {
      onOpenAuth?.();
      return;
    }

    if (!online) {
      return;
    }

    if (!profile) {
      return;
    }

    setActing(true);
    setError("");

    try {
      if (
        profile.follow_status ===
          "pending" ||
        profile.follow_status ===
          "accepted"
      ) {
        await unfollowUser(
          profile.username,
        );

      } else {
        await followUser(
          profile.username,
        );
      }

      await load();

    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Unable to update follow request.",
      );

    } finally {
      setActing(false);
    }
  }


  if (
    !online &&
    !profile
  ) {
    return (
      <div className="hs-profile-page">
        <OfflineNotice
          title="Go back online to see this profile"
          description="Public profiles, follow state, and listening activity sync from HyperSync."
        />
      </div>
    );
  }


  if (loading) {
    return (
      <div className="hs-profile-page">
        <div className="hs-profile-skeleton" />
        <div className="hs-profile-skeleton" />
      </div>
    );
  }


  if (
    error &&
    !profile
  ) {
    return (
      <div className="hs-profile-page">
        <div className="hs-locked-card">
          <Icon
            name="profile"
            size={30}
          />

          <h2>
            Profile unavailable
          </h2>

          <p>{error}</p>
        </div>
      </div>
    );
  }


  if (!profile) {
    return null;
  }


  const followLabel =
    profile.follow_status === "self"
      ? "Your Profile"
      : profile.follow_status ===
          "accepted"
        ? "Following"
        : profile.follow_status ===
            "pending"
          ? "Requested"
          : "Follow";


  return (
    <div className="hs-profile-page">
      {!online ? (
        <OfflineNotice
          compact
          title="You’re offline"
          description="Go back online to refresh this profile and its listening activity."
        />
      ) : null}

      <section className="hs-profile-hero">
        <div className="hs-profile-hero__ambient" />

        <div className="hs-profile-hero__avatar">
          <Avatar
            src={profile.avatar_url}
            name={
              profile.display_name
            }
            size="hero"
          />

          <span className="hs-avatar-orbit hs-avatar-orbit--one" />
          <span className="hs-avatar-orbit hs-avatar-orbit--two" />
        </div>


        <div className="hs-profile-hero__identity">
          <span className="hs-eyebrow">
            HYPERSYNCED MEMBER
          </span>

          <h1>
            {profile.display_name}
          </h1>

          <p className="hs-profile-handle">
            @{profile.username}
          </p>

          <p className="hs-member-age">
            <Icon
              name="headphones"
              size={15}
            />

            {memberFor(
              profile.member_since,
            )}
          </p>

          {profile.bio ? (
            <p className="hs-profile-bio">
              {profile.bio}
            </p>
          ) : null}

          <div className="hs-profile-actions">
            {profile.follow_status !==
            "self" ? (
              <button
                className={
                  profile.follow_status ===
                  "none"
                    ? "hs-primary-button"
                    : "hs-secondary-button"
                }
                type="button"
                disabled={acting}
                onClick={() => {
                  void followAction();
                }}
              >
                <Icon
                  name={
                    profile.follow_status ===
                    "accepted"
                      ? "check"
                      : "people"
                  }
                  size={16}
                />

                {acting
                  ? "Updating..."
                  : followLabel}
              </button>
            ) : null}
          </div>
        </div>
      </section>


      <section className="hs-profile-stats hs-profile-stats--public">
        <button
          className="hs-profile-stat"
          type="button"
          onClick={() => {
            setSocialMode(
              "followers",
            );
          }}
        >
          <Icon
            name="people"
            size={19}
          />

          <strong>
            {profile.followers_count}
          </strong>

          <span>
            Followers
          </span>
        </button>

        <div className="hs-profile-stat">
          <Icon
            name="headphones"
            size={19}
          />

          <strong>
            {memberFor(
              profile.member_since,
            ).replace(
              "Member for ",
              "",
            )}
          </strong>

          <span>
            On HyperSynced
          </span>
        </div>
      </section>


      {!profile.can_view_activity ? (
        <section className="hs-locked-card hs-locked-card--profile">
          <div className="hs-lock-orb">
            <Icon
              name="lock"
              size={28}
            />
          </div>

          <span className="hs-eyebrow">
            MUSIC ACTIVITY PROTECTED
          </span>

          <h2>
            The rest of this profile
            unlocks for followers.
          </h2>

          <p>
            Send a follow request.
            Once {profile.username} accepts
            it, you'll be able
            to see listening stats,
            recently played tracks,
            top artists and more.
          </p>

          {profile.follow_status ===
          "pending" ? (
            <span className="hs-request-pending">
              <Icon
                name="check"
                size={15}
              />

              Follow request sent
            </span>
          ) : null}
        </section>

      ) : (
        <>
          <section className="hs-profile-stats">
            <div className="hs-profile-stat">
              <Icon
                name="music"
                size={19}
              />

              <strong>
                {profile.tracks_played ?? 0}
              </strong>

              <span>
                Total Plays
              </span>
            </div>

            <div className="hs-profile-stat">
              <Icon
                name="headphones"
                size={19}
              />

              <strong>
                {profile.hours_listened ?? 0}h
              </strong>

              <span>
                Listening Time
              </span>
            </div>

            <button
              className="hs-profile-stat"
              type="button"
              onClick={() => {
                setSocialMode(
                  "following",
                );
              }}
            >
              <Icon
                name="profile"
                size={19}
              />

              <strong>
                {profile.following_count ?? 0}
              </strong>

              <span>
                Following
              </span>
            </button>
          </section>


          <section className="hs-profile-section">
            <header className="hs-section-header">
              <div>
                <span className="hs-eyebrow">
                  RECENT ROTATION
                </span>

                <h2>
                  Recently Played
                </h2>
              </div>
            </header>

            {profile.recently_played
              ?.length ? (
              <div className="hs-recent-grid">
                {profile.recently_played.map(
                  (track) => (
                    <button
                      className="hs-recent-card"
                      type="button"
                      key={track.id}
                      {...trackActionMenu.getTriggerProps(
                        track,
                      )}
                      onClick={() => {
                        player.playTrack(
                    track.id,
                     {
  audioUrl:
  track.audio_url,

  artworkUrl:
  track.artwork_url,

  title:
  track.title,

  artist:
  track.artist,

  mimeType:
  track?.mime_type ??
  null,

  fileSize:
  track?.file_size ??
  null,

  mediaVersion:
  track?.media_version ??
  null,

  genre:
  track?.genre ??
  "",

  releaseYear:
  track?.release_year ??
  null,
},
                ).catch(
                          () => {},
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

                        <span className="hs-play-count">
                          ×
                          {
                            track.play_count
                          }
                        </span>

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
                        {track.artist}
                      </span>
                    </button>
                  ),
                )}
              </div>
            ) : (
              <div className="hs-empty-card">
                No recent plays yet.
              </div>
            )}
          </section>


          <section className="hs-profile-section">
            <header className="hs-section-header">
              <div>
                <span className="hs-eyebrow">
                  LISTENING DNA
                </span>

                <h2>
                  Top Artists
                </h2>
              </div>
            </header>

            <div className="hs-top-artists">
              {profile.top_artists
                ?.map(
                  (
                    artist,
                    index,
                  ) => (
                    <button
                      className="hs-artist-row"
                      type="button"
                      key={artist.artist}
                      {...collectionActionMenu.getTriggerProps({
                        key:
                          `artist:${artist.artist}`,
                        kind:
                          "artist",
                        title:
                          artist.artist,
                        subtitle:
                          "Artist",
                        actions: [
                          {
                            id:
                              "open",
                            label:
                              "Open artist",
                            icon:
                              "music",
                            onSelect:
                              () => {
                                onSearchArtist?.(
                                  artist.artist,
                                );
                              },
                          },
                        ],
                      })}
                      onClick={() => {
                        onSearchArtist?.(
                          artist.artist,
                        );
                      }}
                    >
                      <strong>
                        #{index + 1}
                      </strong>

                      <span>
                        {artist.artist}
                      </span>

                      <em>
                        {artist.plays}
                        {" "}
                        plays
                      </em>

                      <Icon
                        name="chevron"
                        size={15}
                      />
                    </button>
                  ),
                )}
            </div>
          </section>
        </>
      )}


      {error ? (
        <p className="hs-form-error">
          {error}
        </p>
      ) : null}


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

      <CollectionActionMenu
        menu={
          collectionActionMenu.menu
        }
        onClose={
          collectionActionMenu.closeMenu
        }
      />


      {socialMode ? (
        <SocialModal
          mode={socialMode}
          username={
            profile.username
          }
          onClose={() => {
            setSocialMode("");
          }}
          onOpenProfile={
            onOpenProfile
          }
        />
      ) : null}
    </div>
  );
}
