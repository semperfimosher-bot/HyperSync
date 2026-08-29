import {
  useCallback,
  useEffect,
  useState,
} from "react";

import * as player from "../../audioPlayer.js";

import {
  getMyProfile,
} from "../../profileApi.js";

import Avatar from "../profile/Avatar.jsx";
import EditProfileModal from "../profile/EditProfileModal.jsx";
import SocialModal from "../profile/SocialModal.jsx";
import Icon from "../ui/Icon.jsx";
import TrackArtwork from "../ui/TrackArtwork.jsx";


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


function Stat({
  value,
  label,
  icon,
  onClick,
}) {
  const content = (
    <>
      <Icon
        name={icon}
        size={19}
      />

      <strong>{value}</strong>

      <span>{label}</span>
    </>
  );

  if (onClick) {
    return (
      <button
        className="hs-profile-stat"
        type="button"
        onClick={onClick}
      >
        {content}
      </button>
    );
  }

  return (
    <div className="hs-profile-stat">
      {content}
    </div>
  );
}


export default function ProfilePage({
  currentUser,
  onOpenAuth,
  onLogout,
  compactMode,
  onToggleCompact,
  onStatusMessage,
  onSearchArtist,
  onOpenProfile,
  onProfileUpdated,
}) {
  const [profile, setProfile] =
    useState(null);

  const [loading, setLoading] =
    useState(
      Boolean(currentUser),
    );

  const [error, setError] =
    useState("");

  const [editing, setEditing] =
    useState(false);

  const [socialMode, setSocialMode] =
    useState("");

  const [avatarVersion, setAvatarVersion] =
    useState(0);


  const loadProfile =
    useCallback(async () => {
      if (!currentUser) {
        setProfile(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");

      try {
        const data =
          await getMyProfile();

        setProfile(data);

      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load profile.",
        );

      } finally {
        setLoading(false);
      }
    }, [currentUser]);


  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);


  if (!currentUser) {
    return (
      <div className="hs-profile-page">
        <section className="hs-locked-card">
          <Icon
            name="profile"
            size={35}
          />

          <h2>
            Your HyperSync identity
            starts here.
          </h2>

          <p>
            Sign in to create your profile,
            track your listening history,
            and connect with people.
          </p>

          <button
            className="hs-primary-button"
            type="button"
            onClick={onOpenAuth}
          >
            Sign In
          </button>
        </section>
      </div>
    );
  }


  if (
    loading &&
    !profile
  ) {
    return (
      <div className="hs-profile-page">
        <div className="hs-profile-skeleton" />
        <div className="hs-profile-skeleton" />
        <div className="hs-profile-skeleton" />
      </div>
    );
  }


  const name =
    profile?.display_name ||
    currentUser.display_name ||
    currentUser.username;


  return (
    <div className="hs-profile-page">
      <section className="hs-profile-hero">
        <div className="hs-profile-hero__ambient" />

        <div className="hs-profile-hero__avatar">
          <Avatar
            src={profile?.avatar_url}
            name={name}
            size="hero"
            cacheKey={avatarVersion}
          />

          <span className="hs-avatar-orbit hs-avatar-orbit--one" />
          <span className="hs-avatar-orbit hs-avatar-orbit--two" />

          <button
            type="button"
            className="hs-avatar-edit-button"
            onClick={() => {
              setEditing(true);
            }}
          >
            <Icon
              name="edit"
              size={15}
            />

            Edit
          </button>
        </div>


        <div className="hs-profile-hero__identity">
          <span className="hs-eyebrow">
            YOUR HYPERSYNC PROFILE
          </span>

          <h1>{name}</h1>

          <p className="hs-profile-handle">
            @{currentUser.username}
          </p>

          <p className="hs-member-age">
            <Icon
              name="headphones"
              size={15}
            />

            {memberFor(
              profile?.member_since,
            )}
          </p>

          <p className="hs-profile-bio">
            {profile?.bio ||
              "Add a bio and tell everyone what you've been listening to."}
          </p>


          <div className="hs-profile-badges">
            <span>
              {currentUser.role === "admin"
                ? "Administrator"
                : "Member"}
            </span>

            <span>
              <Icon
                name={
                  profile?.music_activity_public
                    ? "people"
                    : "lock"
                }
                size={13}
              />

              {profile?.music_activity_public
                ? "Music Activity Public"
                : "Followers Only"}
            </span>
          </div>


          <div className="hs-profile-actions">

            {profile?.pending_requests_count >
            0 ? (
              <button
                className="hs-request-button"
                type="button"
                onClick={() => {
                  setSocialMode(
                    "requests",
                  );
                }}
              >
                <Icon
                  name="people"
                  size={16}
                />

                Follow Requests

                <strong>
                  {
                    profile.pending_requests_count
                  }
                </strong>
              </button>
            ) : null}
          </div>
        </div>
      </section>


      <section className="hs-profile-stats">
        <Stat
          icon="people"
          value={
            profile?.followers_count ?? 0
          }
          label="Followers"
          onClick={() => {
            setSocialMode(
              "followers",
            );
          }}
        />

        <Stat
          icon="profile"
          value={
            profile?.following_count ?? 0
          }
          label="Following"
          onClick={() => {
            setSocialMode(
              "following",
            );
          }}
        />

        <Stat
          icon="music"
          value={
            profile?.tracks_played ?? 0
          }
          label="Total Plays"
        />

        <Stat
          icon="headphones"
          value={`${
            profile?.hours_listened ?? 0
          }h`}
          label="Listening Time"
        />
      </section>


      <section className="hs-profile-section">
        <header className="hs-section-header">
          <div>
            <span className="hs-eyebrow">
              YOUR ROTATION
            </span>

            <h2>
              Recently Played
            </h2>
          </div>

          <span>
            Grouped by track
          </span>
        </header>


        {profile?.recently_played?.length ? (
          <div className="hs-recent-grid">
            {profile.recently_played.map(
              (track) => (
                <button
                  className="hs-recent-card"
                  type="button"
                  key={track.id}
                  onClick={() => {
                    player.playTrack(
                      track.id,
                      {
                        artworkUrl:
                          track.artwork_url,
                        title:
                          track.title,
                        artist:
                          track.artist,
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
                      ×{track.play_count}
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
            <Icon
              name="music"
              size={30}
            />

            <strong>
              Your rotation is waiting
            </strong>

            <p>
              Start listening and your
              most recent tracks will
              light up here.
            </p>
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


        {profile?.top_artists?.length ? (
          <div className="hs-top-artists">
            {profile.top_artists.map(
              (
                artist,
                index,
              ) => (
                <button
                  type="button"
                  className="hs-artist-row"
                  key={artist.artist}
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

        ) : (
          <div className="hs-empty-card">
            <Icon
              name="headphones"
              size={30}
            />

            <strong>
              Your listening DNA
              is still forming
            </strong>

            <p>
              Listen to more music to
              build your artist rankings.
            </p>
          </div>
        )}
      </section>


      <section className="hs-profile-section">
        <header className="hs-section-header">
          <div>
            <span className="hs-eyebrow">
              ACCOUNT
            </span>

            <h2>
              Quick Controls
            </h2>
          </div>
        </header>

        <div className="hs-account-actions">
          <button
            type="button"
            onClick={() => {
              setEditing(true);
            }}
          >
            <Icon
              name="edit"
              size={18}
            />

            <span>
              <strong>
                Edit Profile
              </strong>

              <small>
                Picture, bio and privacy
              </small>
            </span>

            <Icon
              name="chevron"
              size={15}
            />
          </button>

          <button
            type="button"
            onClick={onLogout}
          >
            <Icon
              name="logout"
              size={18}
            />

            <span>
              <strong>
                Log Out
              </strong>

              <small>
                @{currentUser.username}
              </small>
            </span>

            <Icon
              name="chevron"
              size={15}
            />
          </button>
        </div>
      </section>


      {error ? (
        <p
          className="hs-form-error"
          role="alert"
        >
          {error}
        </p>
      ) : null}


      {editing && profile ? (
        <EditProfileModal
          profile={profile}
          onClose={() => {
            setEditing(false);
          }}
          onSaved={(updated) => {
  setProfile(updated);

  setAvatarVersion(
    Date.now(),
  );

  onProfileUpdated?.(
    updated,
  );

  onStatusMessage?.(
    "Profile updated.",
  );
}}
        />
      ) : null}


      {socialMode ? (
        <SocialModal
          mode={socialMode}
          username={
            currentUser.username
          }
          onClose={() => {
            setSocialMode("");
          }}
          onChanged={
            loadProfile
          }
          onOpenProfile={
            onOpenProfile
          }
        />
      ) : null}
    </div>
  );
}
