import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { apiRequest } from "./api/client.js";
import * as player from "./audioPlayer.js";
import {
  cacheUserProfile,
  hasStoredSession,
  logoutSession,
  readCachedUserProfile,
  restoreSession,
  saveAuthSession,
  shouldRestoreSession,
} from "./api/auth.js";
import HexBackdrop from "./components/HexBackdrop.jsx";
import Icon from "./components/ui/Icon.jsx";
import {
  ADMIN_NAV_ITEMS,
  LIBRARY_TABS,
  NAV_ITEMS,
  PAGE_TITLES,
  SEARCH_CATEGORIES,
  SEARCH_SUGGESTIONS,
} from "./constants.js";
import {
  getGreetingName,
  getTimeGreeting,
  getUserInitial,
  isAdminUser,
} from "./utils/user.js";

// -----------------------------------------------
// UI primitives
// -----------------------------------------------

function BrandLogo({
  idPrefix = "brand",
  compact = false,
}) {
  return (
    <div
      className={
        `brand ${compact ? "brand--compact" : ""}`
      }
      aria-label="HyperSync"
    >
      <svg
        className="brand__symbol"
        viewBox="0 0 76 88"
        role="img"
        aria-label="HyperSync logo"
      >
        <defs>
          <linearGradient
            id={`${idPrefix}-metal-left`}
            x1="0"
            y1="0"
            x2="1"
            y2="0"
          >
            <stop
              offset="0"
              stopColor="#252d34"
            />

            <stop
              offset="0.34"
              stopColor="#f2f6f8"
            />

            <stop
              offset="0.63"
              stopColor="#7f8991"
            />

            <stop
              offset="1"
              stopColor="#1b2228"
            />
          </linearGradient>

          <linearGradient
            id={`${idPrefix}-metal-right`}
            x1="0"
            y1="0"
            x2="1"
            y2="0"
          >
            <stop
              offset="0"
              stopColor="#11171c"
            />

            <stop
              offset="0.38"
              stopColor="#d9e1e5"
            />

            <stop
              offset="0.68"
              stopColor="#6e7880"
            />

            <stop
              offset="1"
              stopColor="#f4f7f9"
            />
          </linearGradient>

          <linearGradient
            id={`${idPrefix}-bolt`}
            x1="0"
            y1="0"
            x2="1"
            y2="1"
          >
            <stop
              offset="0"
              stopColor="#c8fbff"
            />

            <stop
              offset="0.25"
              stopColor="#22ddff"
            />

            <stop
              offset="0.58"
              stopColor="#008cef"
            />

            <stop
              offset="1"
              stopColor="#003a8d"
            />
          </linearGradient>

          <filter
            id={`${idPrefix}-glow`}
            x="-80%"
            y="-80%"
            width="260%"
            height="260%"
          >
            <feGaussianBlur
              stdDeviation="3"
              result="blur"
            />

            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <path
          d="M5 8h18v26h20L30 51h-7v29H5z"
          fill={`url(#${idPrefix}-metal-left)`}
          stroke="#f5f8fa"
          strokeOpacity=".42"
        />

        <path
          d="M71 8H53v25H33l13 17h7v30h18z"
          fill={`url(#${idPrefix}-metal-right)`}
          stroke="#f5f8fa"
          strokeOpacity=".38"
        />

        <path
          d="M51 1 17 47h17L20 87l42-52H45z"
          fill={`url(#${idPrefix}-bolt)`}
          filter={`url(#${idPrefix}-glow)`}
        />

        <path
          d="M49 5 22 43h17L26 78l31-39H40z"
          fill="none"
          stroke="#d6f7d3"
          strokeOpacity=".58"
        />
      </svg>

      <span className="brand__wordmark">
        HYPER<span>SYNC</span>
      </span>
    </div>
  );
}

function CoverPlaceholder({
  variant = 1,
  label = "Awaiting catalog",
}) {
  return (
    <div
      className={
        `cover-placeholder ` +
        `cover-placeholder--${variant}`
      }
      role="img"
      aria-label={label}
    >
      <svg
        viewBox="0 0 100 100"
        aria-hidden="true"
      >
        <defs>
          <radialGradient
            id={`cover-glow-${variant}`}
          >
            <stop
              offset="0"
              stopColor="#45e7ff"
              stopOpacity=".85"
            />

            <stop
              offset=".35"
              stopColor="#087bf1"
              stopOpacity=".34"
            />

            <stop
              offset="1"
              stopColor="#02050a"
              stopOpacity="0"
            />
          </radialGradient>
        </defs>

        <circle
          cx="50"
          cy="50"
          r="42"
          fill={`url(#cover-glow-${variant})`}
        />

        <path
          d={
            "M8 64c18-22 34-28 47-17 " +
            "11 10 20 8 37-12"
          }
          fill="none"
          stroke="rgba(123,229,255,.75)"
          strokeWidth="2"
        />

        <circle
          cx="50"
          cy="50"
          r="16"
          fill="none"
          stroke="rgba(255,255,255,.35)"
        />

        <circle
          cx="50"
          cy="50"
          r="4"
          fill="#07121b"
          stroke="#20d6ff"
        />
      </svg>
    </div>
  );
}

function TrackArtwork({
  src,
  alt,
  variant = 1,
}) {
  if (!src) {
    return (
      <CoverPlaceholder
        variant={variant}
        label={alt || "No track artwork"}
      />
    );
  }

  return (
    <div className="track-artwork-shell">
      <img
        className="track-artwork"
        src={src}
        alt={alt || "Track artwork"}
        loading="lazy"
        onError={(event) => {
          event.currentTarget.style.display = "none";
          const fallback = event.currentTarget.nextElementSibling;
          if (fallback) {
            fallback.style.display = "grid";
          }
        }}
      />

      <CoverPlaceholder
        variant={variant}
        label={alt || "No track artwork"}
      />
    </div>
  );
}

// -----------------------------------------------------------------------------
// Layout chrome
// -----------------------------------------------------------------------------

function MobileHeader({
  title,
  onOpenAuth,
}) {
  return (
    <header className="mobile-header">
      <BrandLogo
        idPrefix="mobile-logo"
        compact
      />

      <h1>{title}</h1>

      <button
        className="icon-button"
        type="button"
        onClick={onOpenAuth}
        aria-label="Open account panel"
      >
        <Icon
          name="bell"
          size={18}
        />

        <span
          className="icon-button__dot"
          aria-hidden="true"
        />
      </button>
    </header>
  );
}

function DesktopSidebar({
  activePage,
  currentUser,
  onNavigate,
  onOpenAuth,
}) {
  const isAdmin =
    isAdminUser(currentUser);

  return (
    <aside className="desktop-sidebar">
      <BrandLogo idPrefix="desktop-logo" />

      <nav
        className="desktop-nav"
        aria-label="Desktop navigation"
      >
        <span className="desktop-nav__label">
          Menu
        </span>

        {NAV_ITEMS.map((item) => (
          <button
            className={
              activePage === item.id
                ? "desktop-nav__item is-active"
                : "desktop-nav__item"
            }
            type="button"
            key={item.id}
            onClick={() => onNavigate(item.id)}
          >
            <Icon
              name={item.icon}
              size={20}
            />

            <span>{item.label}</span>
          </button>
        ))}
        {isAdmin ? (
  <>
    <span
      className={
        "desktop-nav__label " +
        "desktop-nav__label--admin"
      }
    >
      Admin
    </span>

    {ADMIN_NAV_ITEMS.map((item) => (
      <button
        className={
          activePage === item.id
            ? "desktop-nav__item is-active"
            : "desktop-nav__item"
        }
        type="button"
        key={item.id}
        onClick={() => {
          onNavigate(item.id);
        }}
      >
        <Icon
          name={item.icon}
          size={20}
        />

        <span>{item.label}</span>
      </button>
    ))}
  </>
) : null}
      </nav>

      <div className="desktop-sidebar__spacer" />

    </aside>
  );
}

function DesktopTopbar({
  activePage,
  searchQuery,
  onSearchChange,
  currentUser,
  onNavigate,
  onOpenAuth,
}) {
  const greetingName =
    getGreetingName(currentUser);

  const userInitial =
    getUserInitial(currentUser);

  function handleProfileClick() {
    if (currentUser) {
      onNavigate("profile");
      return;
    }

    onOpenAuth();
  }

  return (
    <header className="desktop-topbar">
      <div className="desktop-topbar__title">
        <span>HyperSync</span>
        <h1>{PAGE_TITLES[activePage]}</h1>
      </div>

      <label className="desktop-search">
        <Icon
          name="search"
          size={18}
        />

        <input
          type="search"
          value={searchQuery}
          placeholder="Search songs, artists, or albums"
          onChange={(event) => {
            onSearchChange(event.target.value);
          }}
        />
      </label>

      <button
        className="desktop-profile-button"
        type="button"
        onClick={handleProfileClick}
      >
        <span className="avatar avatar--tiny">
          {userInitial}
        </span>

        <span>
          {currentUser ? greetingName : "Guest"}
        </span>

        <Icon
          name="chevron"
          size={15}
        />
      </button>
    </header>
  );
}

function DesktopRightRail() {
  const [state, setState] = useState(() => ({
    src: null,
    artworkUrl: null,
    title: "",
    artist: "",
    paused: true,
    currentTime: 0,
    duration: 0,
  }));

  useEffect(() => {
    const unsub = player.subscribe((s) => {
      setState(s);
    });

    return unsub;
  }, []);

  const titleText = state.title || "No track selected";
  const hasTrack = Boolean(state.src);

  return (
    <aside className="desktop-right-rail">
      <div className="right-rail-heading">
        <span>Now playing</span>

        <h2>
          {titleText}
        </h2>
      </div>

      <div className="right-rail-art">
        <TrackArtwork
          src={state.artworkUrl}
          alt={state.title || "No track artwork"}
          variant={2}
        />
      </div>

      {!hasTrack ? (
        <div className="right-rail-empty">
          <Icon
            name="music"
            size={28}
          />

          <strong>Playback is waiting</strong>

          <p>
            Choose a track to start listening.
          </p>
        </div>
      ) : (
        <div className="right-rail-empty">
          <strong>
            {state.artist || "Unknown artist"}
          </strong>
        </div>
      )}

      <div
        className="right-rail-tabs"
        role="tablist"
        aria-label="Player details"
      >
        <button
          type="button"
          className="is-active"
        >
          Queue
        </button>

        <button type="button">
          Lyrics
        </button>
      </div>

      <div className="right-rail-list">
        <span>Queue is empty</span>

        <small>
          Add tracks to your queue to see them here.
        </small>
      </div>
    </aside>
  );
}

// -----------------------------------------------------------------------------
// Shared page pieces
// -----------------------------------------------------------------------------

function SectionHeading({
  title,
  actionLabel,
  onAction,
}) {
  return (
    <div className="section-heading">
      <h2>{title}</h2>

      {actionLabel ? (
        <button
          type="button"
          onClick={onAction}
        >
          {actionLabel}

          <Icon
            name="chevron"
            size={14}
          />
        </button>
      ) : null}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Pages
// -----------------------------------------------------------------------------

function HomePage({
  currentUser,
  onNavigate,
  onOpenAuth,
}) {
  const greetingName =
    getGreetingName(currentUser);

  const timeGreeting =
    getTimeGreeting();

  const [tracks, setTracks] = useState([]);
  const [catalogError, setCatalogError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadTracks() {
      try {
        const data = await apiRequest("/catalog/tracks");
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

  const playTrack = async (trackId, track = null) => {
    if (!trackId) return;
    try {
      await player.playTrack(trackId, {
        artworkUrl: track?.artwork_url ?? null,
        title: track?.title ?? "",
        artist: track?.artist ?? "",
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
      <section className="home-signal">
        <div className="home-signal__content">
          <div className="home-welcome">
            <h2>
              Hello {greetingName},
            </h2>

            <p className="home-welcome__time">
              {timeGreeting}
            </p>

            <div className="home-welcome__tagline">
              <span>your vibe.</span>

              <span>
                your <strong>music.</strong>
              </span>

              <span>
                your <strong>world.</strong>
              </span>
            </div>
          </div>

          <div className="home-signal__status">
            <span>
              <i aria-hidden="true" />

              {currentUser
                ? `Signed in as ${greetingName}`
                : "Sign in to save your music"}
            </span>
          </div>
        </div>

        <div
          className="home-signal__art"
          aria-hidden="true"
        >
          <div className="home-signal__poster">
            <img
              src="/hypersync-home-logo.png"
              alt=""
            />
          </div>
        </div>
      </section>

      <section>
        <SectionHeading
          title="Recently Played"
          actionLabel="View all"
          onAction={() => {
            onNavigate("library");
          }}
        />

        {catalogError ? (
          <div className="empty-content-card">
            <div>
              <strong>Catalog unavailable</strong>
              <p>{catalogError}</p>
            </div>
          </div>
        ) : tracks.length > 0 ? (
          <div className="search-chips">
            {tracks.map((track) => (
              <button
                key={track.id}
                type="button"
                onClick={() => playTrack(track.id, track)}
                title={`Play ${track.title}`}
              >
                {track.title} — {track.artist}
              </button>
            ))}
          </div>
        ) : (
          <div className="empty-content-card">
            <div
              className="empty-content-card__covers"
              aria-hidden="true"
            >
              {[1, 2, 3, 4].map((variant) => (
                <CoverPlaceholder
                  key={variant}
                  variant={variant}
                />
              ))}
            </div>

            <div>
              <strong>
                No listening history yet
              </strong>

              <p>
                Once real playback is connected,
                recently played music will appear
                in this section.
              </p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function SearchPage({
  query,
  onQueryChange,
}) {
  const normalizedQuery = query.trim();
  const [results, setResults] = useState([]);
  const [searchError, setSearchError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadResults() {
      if (!normalizedQuery) {
        setResults([]);
        setSearchError("");
        return;
      }

      try {
        const data = await apiRequest(
          `/catalog/tracks?q=${encodeURIComponent(normalizedQuery)}`,
        );

        if (!cancelled) {
          setResults(data || []);
          setSearchError("");
        }
      } catch (error) {
        if (!cancelled) {
          setResults([]);
          setSearchError(
            error instanceof Error
              ? error.message
              : "Unable to search the catalog.",
          );
        }
      }
    }

    loadResults();

    return () => {
      cancelled = true;
    };
  }, [normalizedQuery]);

  return (
    <div className="page-stack search-page">
      <label className="mobile-search-field">
        <Icon
          name="search"
          size={17}
        />

        <input
          type="search"
          value={query}
          placeholder={
            "Search for songs, artists, or albums"
          }
          onChange={(event) => {
            onQueryChange(event.target.value);
          }}
        />
      </label>

      <section>
        <SectionHeading title="Browse by Category" />

        <div className="category-grid">
          {SEARCH_CATEGORIES.map(
            (category, index) => (
              <button
                className={
                  `category-card ` +
                  `category-card--${index + 1}`
                }
                type="button"
                key={category.id}
                onClick={() => {
                  onQueryChange(category.label);
                }}
              >
                <strong>
                  {category.label}
                </strong>

                <Icon
                  name={category.icon}
                  size={31}
                />
              </button>
            ),
          )}
        </div>
      </section>

      <section>
        <SectionHeading title="Popular Searches" />

        <div className="search-chips">
          {SEARCH_SUGGESTIONS.map(
            (suggestion) => (
              <button
                type="button"
                key={suggestion}
                onClick={() => {
                  onQueryChange(suggestion);
                }}
              >
                {suggestion}
              </button>
            ),
          )}
        </div>
      </section>

      <section>
        <SectionHeading
          title={
            normalizedQuery
              ? `Results for “${normalizedQuery}”`
              : "Suggested for You"
          }
        />

        {normalizedQuery ? (
          searchError ? (
            <div className="empty-content-card">
              <div>
                <strong>Search failed</strong>
                <p>{searchError}</p>
              </div>
            </div>
          ) : results.length > 0 ? (
            <div className="search-chips">
              {results.map((track) => (
                <button
                  key={track.id}
                  type="button"
                  onClick={() => {
                    player.playTrack(track.id, {
                      artworkUrl: track.artwork_url,
                      title: track.title,
                      artist: track.artist,
                    }).catch(() => {});
                  }}
                >
                  {track.title} — {track.artist}
                </button>
              ))}
            </div>
          ) : (
            <div className="search-empty-panel">
              <Icon
                name="search"
                size={30}
              />

              <strong>No songs match this search</strong>

              <p>
                Try another title, artist, or album name.
              </p>
            </div>
          )
        ) : (
          <div className="search-empty-panel">
            <Icon
              name="search"
              size={30}
            />

            <strong>Suggestions are waiting for your catalog</strong>

            <p>
              Real recommendations will be calculated from the catalog once you search for music.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function LibraryPage({ onOpenAuth }) {
  const [activeTab, setActiveTab] =
    useState("Playlists");

  const emptyIcon =
    activeTab === "Playlists"
      ? "playlist"
      : activeTab === "Artists"
        ? "people"
        : activeTab === "Albums"
          ? "disc"
          : "music";

  return (
    <div className="page-stack library-page">
      <div
        className="library-tabs"
        role="tablist"
        aria-label="Library sections"
      >
        {LIBRARY_TABS.map((tab) => (
          <button
            className={
              activeTab === tab
                ? "is-active"
                : ""
            }
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            key={tab}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      <button
        className="create-playlist-button"
        type="button"
        onClick={onOpenAuth}
      >
        <span>
          <Icon
            name="plus"
            size={19}
          />
        </span>

        <strong>Create Playlist</strong>

        <Icon
          name="lock"
          size={16}
        />
      </button>

      <section className="library-list-panel">
        <div className="library-empty-symbol">
          <Icon
            name={emptyIcon}
            size={34}
          />
        </div>

        <h2>
          No {activeTab.toLowerCase()} saved yet
        </h2>

        <p>
          Guest mode can browse and listen, but
          saving library items requires an account
          and the real library API.
        </p>

        <button
          className="primary-button"
          type="button"
          onClick={onOpenAuth}
        >
          Open account options
        </button>
      </section>
    </div>
  );
}

function ProfileStat({
  icon,
  value,
  label,
}) {
  return (
    <div className="profile-stat">
      <span>
        <Icon
          name={icon}
          size={18}
        />
      </span>

      <strong>{value}</strong>
      <small>{label}</small>
    </div>
  );
}

function SettingsRow({
  icon,
  label,
  value,
  onClick,
  disabled = false,
}) {
  return (
    <button
      className="settings-row"
      type="button"
      onClick={onClick}
      disabled={disabled}
    >
      <Icon
        name={icon}
        size={17}
      />

      <span>{label}</span>

      {value ? <small>{value}</small> : null}

      <Icon
        name="chevron"
        size={15}
      />
    </button>
  );
}

function ProfilePage({
  currentUser,
  onOpenAuth,
  onLogout,
  compactMode,
  onToggleCompact,
  statusMessage,
  onStatusMessage,
}) {
  const greetingName =
    getGreetingName(currentUser);

  return (
    <div className="page-stack profile-page">
      <section className="profile-identity">
        <div className="profile-avatar-wrap">
          <div className="profile-avatar">
            <svg
              viewBox="0 0 100 100"
              role="img"
              aria-label={
                currentUser
                  ? `${greetingName} profile avatar`
                  : "Guest profile avatar"
              }
            >
              <defs>
                <radialGradient id="guest-avatar-glow">
                  <stop
                    offset="0"
                    stopColor="#184d70"
                  />

                  <stop
                    offset="1"
                    stopColor="#061018"
                  />
                </radialGradient>
              </defs>

              <circle
                cx="50"
                cy="50"
                r="49"
                fill="url(#guest-avatar-glow)"
              />

              <circle
                cx="50"
                cy="36"
                r="17"
                fill="none"
                stroke="#a9d8e8"
                strokeWidth="4"
              />

              <path
                d={
                  "M20 88c4-24 14-35 30-35" +
                  "s26 11 30 35"
                }
                fill="none"
                stroke="#a9d8e8"
                strokeWidth="4"
              />
            </svg>
          </div>

          <button
            type="button"
            onClick={onOpenAuth}
            aria-label="Open account options"
          >
            <Icon
              name="edit"
              size={13}
            />
          </button>
        </div>

        <div className="profile-identity__copy">
          <h2>
            {currentUser ? greetingName : "Guest"}
          </h2>

          <p>
            {currentUser
              ? currentUser.email
              : "Music synced to your style."}
          </p>

          {currentUser ? (
            <span className="profile-role-badge">
              {currentUser.role === "admin"
                ? "Administrator"
                : "Member"}
            </span>
          ) : (
            <button
              type="button"
              onClick={onOpenAuth}
            >
              Account required
            </button>
          )}
        </div>
      </section>

      <section className="profile-stats bevel-panel">
        <ProfileStat
          icon="music"
          value="—"
          label="Playlists"
        />

        <ProfileStat
          icon="people"
          value="—"
          label="Followers"
        />

        <ProfileStat
          icon="profile"
          value="—"
          label="Following"
        />

        <ProfileStat
          icon="headphones"
          value="—"
          label="Hours Listened"
        />
      </section>

      <section>
        <SectionHeading title="Recently Played" />

        <div className="profile-card-grid">
          {[1, 2, 3, 4].map((variant) => (
            <article
              className="profile-media-card"
              key={variant}
            >
              <CoverPlaceholder
                variant={variant}
              />

              <strong>Empty slot</strong>
              <small>No listening data</small>
            </article>
          ))}
        </div>
      </section>

      <section>
        <SectionHeading title="Favorite Genres" />

        <div className="genre-empty-panel">
          <div
            className="genre-bars"
            aria-hidden="true"
          >
            {[72, 58, 44, 36, 28, 20].map(
              (width, index) => (
                <span
                  key={width}
                  style={{
                    "--bar-width": `${width}%`,
                    "--bar-delay":
                      `${index * 70}ms`,
                  }}
                />
              ),
            )}
          </div>

          <div>
            <strong>
              No genre profile yet
            </strong>

            <p>
              Your real listening history will
              determine these results.
            </p>
          </div>
        </div>
      </section>

      <section>
        <SectionHeading title="Settings" />

        <div
          className={
            "settings-panel " +
            "settings-panel--settings"
          }
        >
          <SettingsRow
            icon="sun"
            label="Appearance"
            value={
              compactMode
                ? "Compact"
                : "Comfortable"
            }
            onClick={onToggleCompact}
          />

          <SettingsRow
            icon="volume"
            label="Audio Quality"
            value="Not connected"
            onClick={() => {
              onStatusMessage(
                "Audio quality settings will " +
                "activate with real playback.",
              );
            }}
          />

          <SettingsRow
            icon="bell"
            label="Notifications"
            value="Not connected"
            onClick={() => {
              onStatusMessage(
                "Notifications are not connected yet.",
              );
            }}
          />

          <SettingsRow
            icon="shield"
            label="Privacy"
            value="Pending"
            onClick={() => {
              onStatusMessage(
                "Privacy controls will be added " +
                "before account launch.",
              );
            }}
          />
        </div>
      </section>

      <section>
        <SectionHeading title="Account" />

        <div
          className={
            "settings-panel " +
            "settings-panel--account"
          }
        >
          {currentUser ? (
            <>
              <SettingsRow
                icon="profile"
                label="Username"
                value={currentUser.username}
              />

              <SettingsRow
                icon="link"
                label="Linked Accounts"
                value="Unavailable"
                onClick={() => {
                  onStatusMessage(
                    "Linked accounts are not " +
                    "implemented yet.",
                  );
                }}
              />

              <SettingsRow
                icon="logout"
                label="Log Out"
                value={greetingName}
                onClick={onLogout}
              />
            </>
          ) : (
            <>
              <SettingsRow
                icon="profile"
                label="Sign in or create account"
                onClick={onOpenAuth}
              />

              <SettingsRow
                icon="link"
                label="Linked Accounts"
                value="Unavailable"
                onClick={() => {
                  onStatusMessage(
                    "Linked accounts are not " +
                    "implemented yet.",
                  );
                }}
              />

              <SettingsRow
                icon="logout"
                label="Log Out"
                value="Guest"
                disabled
              />
            </>
          )}
        </div>
      </section>

      {statusMessage ? (
        <p
          className="inline-status"
          role="status"
        >
          {statusMessage}
        </p>
      ) : null}
    </div>
  );
}

function AdminUploadsPage() {
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [album, setAlbum] = useState("");
  const [duration, setDuration] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  const [uploadedTracks, setUploadedTracks] = useState([]);

  const loadCatalogTracks = useCallback(async () => {
    try {
      const tracks = await apiRequest("/catalog/tracks");
      setUploadedTracks(tracks || []);
    } catch (error) {
      setUploadedTracks([]);
      setUploadStatus(
        error instanceof Error
          ? error.message
          : "Unable to load catalog.",
      );
    }
  }, []);

  useEffect(() => {
    loadCatalogTracks();
  }, [loadCatalogTracks]);

  const handleFileChange = (e) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
    }
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!file || !title || !artist || !album) {
      setUploadStatus("Please fill in all fields.");
      return;
    }

    setIsUploading(true);
    setUploadStatus("Uploading...");

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("title", title);
      formData.append("artist", artist);
      formData.append("album", album);
      formData.append("duration_seconds", String(duration));

      const response = await apiRequest("/admin/tracks/upload", {
        method: "POST",
        body: formData,
      });

      setUploadStatus("Upload successful!");
      setFile(null);
      setTitle("");
      setArtist("");
      setAlbum("");
      setDuration(0);
      const fileInput = document.querySelector("input[type=file]");
      if (fileInput) {
        fileInput.value = "";
      }
      await loadCatalogTracks();
      if (response?.track_id) {
        setUploadedTracks((tracks) => [
          {
            id: response.track_id,
            title: response.title,
            artist: response.artist,
            album: response.album,
            duration_seconds: response.duration_seconds,
          },
          ...tracks,
        ]);
      }
    } catch (error) {
      setUploadStatus(
        error instanceof Error
          ? error.message
          : "Upload failed.",
      );
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteTrack = async (trackId) => {
    try {
      await apiRequest(`/admin/tracks/${trackId}`, {
        method: "DELETE",
      });

      setUploadedTracks((tracks) =>
        tracks.filter((track) => track.id !== trackId),
      );
      setUploadStatus("Track deleted.");
    } catch (error) {
      setUploadStatus(
        error instanceof Error
          ? error.message
          : "Failed to delete track.",
      );
    }
  };

  return (
    <div className="page-stack admin-page">
      <section className="admin-page__header">
        <span>ADMINISTRATION</span>
        <h2>Uploads</h2>
        <p>
          Upload authorized audio files to B2
          and add them to the catalog.
        </p>
      </section>

      <section className="admin-upload-form">
        <h3>Upload New Track</h3>
        <form onSubmit={handleUpload}>
          <div className="form-group">
            <label htmlFor="file-input">
              Audio File
            </label>
            <input
              id="file-input"
              type="file"
              accept="audio/*"
              onChange={handleFileChange}
              disabled={isUploading}
              required
            />
            {file && (
              <small>{file.name}</small>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="title-input">
              Title
            </label>
            <input
              id="title-input"
              type="text"
              value={title}
              onChange={(e) =>
                setTitle(e.target.value)
              }
              disabled={isUploading}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="artist-input">
              Artist
            </label>
            <input
              id="artist-input"
              type="text"
              value={artist}
              onChange={(e) =>
                setArtist(e.target.value)
              }
              disabled={isUploading}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="album-input">
              Album
            </label>
            <input
              id="album-input"
              type="text"
              value={album}
              onChange={(e) =>
                setAlbum(e.target.value)
              }
              disabled={isUploading}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="duration-input">
              Duration (seconds)
            </label>
            <input
              id="duration-input"
              type="number"
              value={duration}
              onChange={(e) =>
                setDuration(
                  parseInt(e.target.value) || 0,
                )
              }
              disabled={isUploading}
              min="0"
            />
          </div>

          <button
            type="submit"
            disabled={isUploading || !file}
            className="primary-button"
          >
            {isUploading ? "Uploading..." : "Upload"}
          </button>
        </form>

        {uploadStatus && (
          <p className="upload-status">
            {uploadStatus}
          </p>
        )}
      </section>

      {uploadedTracks.length > 0 && (
        <section className="admin-upload-list">
          <h3>Catalog Tracks</h3>
          <div className="upload-list">
            {uploadedTracks.map((track) => (
              <div
                key={track.id}
                className="upload-item"
              >
                <div>
                  <strong>{track.title}</strong>
                  <small>
                    {track.artist} - {track.album}
                  </small>
                </div>

                <div className="upload-item__actions">
                  <small>
                    {track.duration_seconds ?? 0}s
                  </small>
                  <button
                    type="button"
                    className="danger-button"
                    onClick={() => handleDeleteTrack(track.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function AdminDashboardPage() {
  const [tracks, setTracks] = useState([]);
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const loadDashboard = useCallback(async () => {
    setLoading(true);

    try {
      const [catalogResult, healthResult] =
        await Promise.all([
          apiRequest("/catalog/tracks"),
          fetch("/health").then(async (response) => {
            if (!response.ok) {
              throw new Error("Health check failed.");
            }

            return response.json();
          }),
        ]);

      setTracks(catalogResult || []);
      setHealth(healthResult);
      setMessage("");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to load admin dashboard.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();

    const interval = window.setInterval(
      loadDashboard,
      30000,
    );

    return () => {
      window.clearInterval(interval);
    };
  }, [loadDashboard]);

  const artistCount = useMemo(() => {
    return new Set(
      tracks
        .map((track) => track.artist)
        .filter(Boolean),
    ).size;
  }, [tracks]);

  const albumCount = useMemo(() => {
    return new Set(
      tracks
        .map((track) => track.album)
        .filter(Boolean),
    ).size;
  }, [tracks]);

  const artworkCount = useMemo(() => {
    return tracks.filter(
      (track) => Boolean(track.artwork_url),
    ).length;
  }, [tracks]);

  const recentTracks = tracks.slice(0, 6);

  return (
    <div className="page-stack admin-dashboard-page">
      <section className="admin-hero-panel">
        <div>
          <span className="admin-eyebrow">
            HYPERSYNC CONTROL CENTER
          </span>

          <h2>Admin Dashboard</h2>

          <p>
            Monitor your catalog, playback services,
            storage pipeline, and automation from one
            place.
          </p>
        </div>

        <button
          type="button"
          className="admin-refresh-button"
          onClick={loadDashboard}
          disabled={loading}
        >
          <Icon
            name="chart"
            size={16}
          />

          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </section>

      {message ? (
        <div className="admin-alert">
          <Icon
            name="shield"
            size={18}
          />

          <span>{message}</span>
        </div>
      ) : null}

      <section className="admin-stat-grid">
        <AdminStatCard
          icon="music"
          label="Published Tracks"
          value={tracks.length}
          detail="Catalog items available"
        />

        <AdminStatCard
          icon="people"
          label="Artists"
          value={artistCount}
          detail="Unique catalog artists"
        />

        <AdminStatCard
          icon="disc"
          label="Albums"
          value={albumCount}
          detail="Unique albums"
        />

        <AdminStatCard
          icon="mountains"
          label="Artwork Coverage"
          value={
            tracks.length
              ? `${Math.round(
                  (artworkCount / tracks.length) *
                    100,
                )}%`
              : "0%"
          }
          detail={`${artworkCount} tracks with artwork`}
        />
      </section>

      <section className="admin-dashboard-grid">
        <article className="admin-panel admin-health-panel">
          <div className="admin-panel__heading">
            <div>
              <span>PLATFORM</span>
              <h3>System Health</h3>
            </div>

            <span
              className={
                health?.database === "healthy"
                  ? "admin-status admin-status--online"
                  : "admin-status admin-status--offline"
              }
            >
              {health?.database === "healthy"
                ? "ONLINE"
                : "CHECK"}
            </span>
          </div>

          <div className="admin-health-list">
            <AdminHealthRow
              label="API"
              value={
                health?.api === "healthy"
                  ? "Healthy"
                  : "Unavailable"
              }
              healthy={
                health?.api === "healthy"
              }
            />

            <AdminHealthRow
              label="Database"
              value={
                health?.database === "healthy"
                  ? "Healthy"
                  : "Unavailable"
              }
              healthy={
                health?.database === "healthy"
              }
            />

            <AdminHealthRow
              label="Application"
              value={
                health?.application ||
                "HyperSync"
              }
              healthy
            />

            <AdminHealthRow
              label="Version"
              value={health?.version || "—"}
              healthy
            />
          </div>
        </article>

        <article className="admin-panel">
          <div className="admin-panel__heading">
            <div>
              <span>AUTOMATION</span>
              <h3>Bot Status</h3>
            </div>

            <span className="admin-status admin-status--offline">
              NOT CONNECTED
            </span>
          </div>

          <div className="bot-status-card">
            <div className="bot-status-icon">
              <Icon
                name="chart"
                size={25}
              />
            </div>

            <div>
              <strong>HyperSync Bot</strong>
              <p>
                Bot backend is not connected yet.
                The control surface is ready for
                the automation service.
              </p>
            </div>
          </div>

          <button
            type="button"
            className="secondary-admin-button"
            onClick={() => {
              window.dispatchEvent(
                new CustomEvent(
                  "hypersync:navigate-admin-bot",
                ),
              );
            }}
          >
            Open Bot Control
            <Icon
              name="chevron"
              size={14}
            />
          </button>
        </article>
      </section>

      <section className="admin-panel">
        <div className="admin-panel__heading">
          <div>
            <span>CATALOG</span>
            <h3>Recent Tracks</h3>
          </div>

          <strong className="admin-panel-count">
            {tracks.length} total
          </strong>
        </div>

        {recentTracks.length > 0 ? (
          <div className="admin-recent-list">
            {recentTracks.map((track) => (
              <div
                className="admin-recent-item"
                key={track.id}
              >
                <TrackArtwork
                  src={track.artwork_url}
                  alt={track.title}
                  variant={1}
                />

                <div className="admin-recent-copy">
                  <strong>{track.title}</strong>

                  <span>
                    {track.artist}
                    {track.album
                      ? ` • ${track.album}`
                      : ""}
                  </span>
                </div>

                <span className="admin-track-duration">
                  {track.duration_seconds
                    ? `${Math.floor(
                        track.duration_seconds / 60,
                      )}:${String(
                        track.duration_seconds % 60,
                      ).padStart(2, "0")}`
                    : "—"}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="admin-empty-state">
            <Icon
              name="music"
              size={28}
            />

            <strong>No published tracks</strong>

            <p>
              Upload your first track to populate
              the catalog.
            </p>
          </div>
        )}
      </section>

      <section className="admin-quick-actions">
        <AdminQuickAction
          icon="plus"
          title="Upload Track"
          description="Add audio and embedded artwork."
          onClick={() => {
            window.dispatchEvent(
              new CustomEvent(
                "hypersync:navigate-admin-uploads",
              ),
            );
          }}
        />

        <AdminQuickAction
          icon="music"
          title="Manage Catalog"
          description="Review and remove catalog items."
          onClick={() => {
            window.dispatchEvent(
              new CustomEvent(
                "hypersync:navigate-admin-catalog",
              ),
            );
          }}
        />

        <AdminQuickAction
          icon="chart"
          title="Bot Control"
          description="Monitor automation and processing."
          onClick={() => {
            window.dispatchEvent(
              new CustomEvent(
                "hypersync:navigate-admin-bot",
              ),
            );
          }}
        />
      </section>
    </div>
  );
}

function AdminStatCard({
  icon,
  label,
  value,
  detail,
}) {
  return (
    <article className="admin-stat-card">
      <div className="admin-stat-card__icon">
        <Icon
          name={icon}
          size={19}
        />
      </div>

      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function AdminHealthRow({
  label,
  value,
  healthy,
}) {
  return (
    <div className="admin-health-row">
      <span>{label}</span>

      <div>
        <i
          className={
            healthy
              ? "admin-health-dot admin-health-dot--ok"
              : "admin-health-dot"
          }
        />

        <strong>{value}</strong>
      </div>
    </div>
  );
}

function AdminQuickAction({
  icon,
  title,
  description,
  onClick,
}) {
  return (
    <button
      type="button"
      className="admin-quick-action"
      onClick={onClick}
    >
      <span className="admin-quick-action__icon">
        <Icon
          name={icon}
          size={20}
        />
      </span>

      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>

      <Icon
        name="chevron"
        size={15}
      />
    </button>
  );
}

// -----------------------------------------------------------------------------
// Routing
// -----------------------------------------------------------------------------

function MainPage({
  activePage,
  currentUser,
  onNavigate,
  onOpenAuth,
  onLogout,
  query,
  onQueryChange,
  compactMode,
  onToggleCompact,
  statusMessage,
  onStatusMessage,
}) {

  const adminPage =
  ADMIN_NAV_ITEMS.some(
    (item) => item.id === activePage,
  );

if (adminPage) {
  if (!isAdminUser(currentUser)) {
    return (
      <div className="page-stack">
        <section className="admin-page__denied">
          <Icon name="lock" size={28} />

          <h2>Admin access required</h2>

          <p>
            This area is available only to
            HyperSync administrators.
          </p>
        </section>
      </div>
   );
}

function AdminDashboardPage() {
  const [tracks, setTracks] = useState([]);
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const loadDashboard = useCallback(async () => {
    setLoading(true);

    try {
      const [catalogData, healthResponse] =
        await Promise.all([
          apiRequest("/catalog/tracks"),
          fetch("/health").then(
            async (response) => {
              if (!response.ok) {
                throw new Error(
                  "Health check failed.",
                );
              }

              return response.json();
            },
          ),
        ]);

      setTracks(catalogData || []);
      setHealth(healthResponse);
      setMessage("");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to load dashboard.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();

    const interval =
      window.setInterval(
        loadDashboard,
        30000,
      );

    return () => {
      window.clearInterval(interval);
    };
  }, [loadDashboard]);

  const artistCount = useMemo(() => {
    return new Set(
      tracks
        .map((track) => track.artist)
        .filter(Boolean),
    ).size;
  }, [tracks]);

  const albumCount = useMemo(() => {
    return new Set(
      tracks
        .map((track) => track.album)
        .filter(Boolean),
    ).size;
  }, [tracks]);

  const artworkCount = tracks.filter(
    (track) => track.artwork_url,
  ).length;

  return (
    <div className="page-stack admin-dashboard-page">
      <section className="admin-hero-panel">
        <div>
          <span className="admin-eyebrow">
            HYPERSYNC CONTROL CENTER
          </span>

          <h2>Admin Dashboard</h2>

          <p>
            Monitor your catalog, database,
            artwork pipeline, and automation.
          </p>
        </div>

        <button
          type="button"
          className="admin-refresh-button"
          onClick={loadDashboard}
          disabled={loading}
        >
          {loading
            ? "Refreshing..."
            : "Refresh"}
        </button>
      </section>

      {message ? (
        <div className="admin-alert">
          <Icon
            name="shield"
            size={18}
          />

          <span>{message}</span>
        </div>
      ) : null}

      <section className="admin-stat-grid">
        <AdminStatCard
          icon="music"
          label="Published Tracks"
          value={tracks.length}
          detail="Available in catalog"
        />

        <AdminStatCard
          icon="people"
          label="Artists"
          value={artistCount}
          detail="Unique artists"
        />

        <AdminStatCard
          icon="disc"
          label="Albums"
          value={albumCount}
          detail="Unique albums"
        />

        <AdminStatCard
          icon="mountains"
          label="Artwork"
          value={
            tracks.length
              ? `${Math.round(
                  (artworkCount /
                    tracks.length) *
                    100,
                )}%`
              : "0%"
          }
          detail={`${artworkCount} with artwork`}
        />
      </section>

      <section className="admin-dashboard-grid">
        <article className="admin-panel">
          <div className="admin-panel__heading">
            <div>
              <span>PLATFORM</span>
              <h3>System Health</h3>
            </div>
          </div>

          <div className="admin-health-list">
            <AdminHealthRow
              label="API"
              value={
                health?.api === "healthy"
                  ? "Healthy"
                  : "Unavailable"
              }
              healthy={
                health?.api === "healthy"
              }
            />

            <AdminHealthRow
              label="Database"
              value={
                health?.database ===
                "healthy"
                  ? "Healthy"
                  : "Unavailable"
              }
              healthy={
                health?.database ===
                "healthy"
              }
            />

            <AdminHealthRow
              label="Application"
              value={
                health?.application ||
                "HyperSync"
              }
              healthy
            />

            <AdminHealthRow
              label="Version"
              value={
                health?.version || "—"
              }
              healthy
            />
          </div>
        </article>

        <article className="admin-panel">
          <div className="admin-panel__heading">
            <div>
              <span>AUTOMATION</span>
              <h3>Bot Status</h3>
            </div>
          </div>

          <div className="bot-status-card">
            <div className="bot-status-icon">
              <Icon
                name="chart"
                size={25}
              />
            </div>

            <div>
              <strong>
                HyperSync Bot
              </strong>

              <p>
                Control catalog scanning and
                automated processing.
              </p>
            </div>
          </div>
        </article>
      </section>
    </div>
  );
}

function AdminStatCard({
  icon,
  label,
  value,
  detail,
}) {
  return (
    <article className="admin-stat-card">
      <div className="admin-stat-card__icon">
        <Icon
          name={icon}
          size={19}
        />
      </div>

      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function AdminHealthRow({
  label,
  value,
  healthy,
}) {
  return (
    <div className="admin-health-row">
      <span>{label}</span>

      <div>
        <i
          className={
            healthy
              ? "admin-health-dot admin-health-dot--ok"
              : "admin-health-dot"
          }
        />

        <strong>{value}</strong>
      </div>
    </div>
  );
}

function AdminCatalogPage() {
  const [tracks, setTracks] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const loadTracks = useCallback(async () => {
    setLoading(true);

    try {
      const suffix = query.trim()
        ? `?q=${encodeURIComponent(
            query.trim(),
          )}`
        : "";

      const data = await apiRequest(
        `/catalog/tracks${suffix}`,
      );

      setTracks(data || []);
      setMessage("");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to load catalog.",
      );
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    loadTracks();
  }, [loadTracks]);

  const deleteTrack = async (trackId) => {
    const confirmed = window.confirm(
      "Delete this track and its stored B2 versions?",
    );

    if (!confirmed) {
      return;
    }

    try {
      await apiRequest(
        `/admin/tracks/${trackId}`,
        {
          method: "DELETE",
        },
      );

      setTracks((current) =>
        current.filter(
          (track) => track.id !== trackId,
        ),
      );

      setMessage("Track deleted successfully.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to delete track.",
      );
    }
  };

  return (
    <div className="page-stack admin-page">
      <section className="admin-hero-panel">
        <div>
          <span className="admin-eyebrow">
            CATALOG
          </span>

          <h2>Media Catalog</h2>

          <p>
            Search, inspect, and manage your
            published HyperSync tracks.
          </p>
        </div>

        <button
          type="button"
          className="admin-refresh-button"
          onClick={loadTracks}
          disabled={loading}
        >
          Refresh
        </button>
      </section>

      {message ? (
        <div className="admin-alert">
          <Icon
            name="shield"
            size={18}
          />

          <span>{message}</span>
        </div>
      ) : null}

      <section className="admin-panel">
        <div className="admin-catalog-toolbar">
          <label className="desktop-search">
            <Icon
              name="search"
              size={17}
            />

            <input
              type="search"
              value={query}
              placeholder="Search tracks, artists, or albums"
              onChange={(event) => {
                setQuery(event.target.value);
              }}
            />
          </label>

          <span className="admin-panel-count">
            {tracks.length} tracks
          </span>
        </div>

        {loading ? (
          <div className="admin-empty-state">
            <strong>
              Loading catalog...
            </strong>
          </div>
        ) : tracks.length === 0 ? (
          <div className="admin-empty-state">
            <Icon
              name="music"
              size={28}
            />

            <strong>
              No tracks found
            </strong>

            <p>
              Upload music or change your search.
            </p>
          </div>
        ) : (
          <div className="admin-catalog-list">
            {tracks.map((track) => (
              <div
                className="admin-catalog-row"
                key={track.id}
              >
                <TrackArtwork
                  src={track.artwork_url}
                  alt={track.title}
                  variant={1}
                />

                <div className="admin-catalog-copy">
                  <strong>
                    {track.title}
                  </strong>

                  <span>
                    {track.artist}
                  </span>

                  <small>
                    {track.album || "No album"}
                  </small>
                </div>

                <span className="admin-catalog-duration">
                  {track.duration_seconds
                    ? `${Math.floor(
                        track.duration_seconds / 60,
                      )}:${String(
                        track.duration_seconds % 60,
                      ).padStart(2, "0")}`
                    : "—"}
                </span>

                <button
                  type="button"
                  className="danger-button"
                  onClick={() => {
                    deleteTrack(track.id);
                  }}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function AdminBotPage() {
  const [bot, setBot] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const loadBotStatus = useCallback(async () => {
    try {
      const data = await apiRequest(
        "/admin/bot/status",
      );

      setBot(data);
      setMessage("");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to load bot status.",
      );
    }
  }, []);

  useEffect(() => {
    loadBotStatus();

    const interval = window.setInterval(
      loadBotStatus,
      3000,
    );

    return () => {
      window.clearInterval(interval);
    };
  }, [loadBotStatus]);

  const runAction = async (action) => {
    setBusy(true);
    setMessage("");

    try {
      const endpoints = {
        start: "/admin/bot/start",
        stop: "/admin/bot/stop",
        scan: "/admin/bot/scan",
        process: "/admin/bot/process",
      };

      const endpoint = endpoints[action];

      if (!endpoint) {
        throw new Error(
          `Unknown bot action: ${action}`,
        );
      }

      await apiRequest(endpoint, {
        method: "POST",
      });

      await loadBotStatus();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Bot command failed.",
      );
    } finally {
      setBusy(false);
    }
  };

  const isRunning =
    bot?.running === true;

  return (
    <div className="page-stack admin-bot-page">
      <section className="admin-hero-panel admin-hero-panel--bot">
        <div>
          <span className="admin-eyebrow">
            AUTOMATION
          </span>

          <h2>Bot Control</h2>

          <p>
            Control HyperSync automation and monitor
            background processing from one place.
          </p>
        </div>

        <div
          className={
            isRunning
              ? "bot-live-indicator is-live"
              : "bot-live-indicator"
          }
        >
          <span />

          {isRunning
            ? "BOT ONLINE"
            : "BOT OFFLINE"}
        </div>
      </section>

      {message ? (
        <div className="admin-alert">
          <Icon
            name="shield"
            size={18}
          />

          <span>{message}</span>
        </div>
      ) : null}

      <section className="admin-bot-grid">
        <article className="admin-panel">
          <div className="admin-panel__heading">
            <div>
              <span>CONTROL</span>
              <h3>Bot Operations</h3>
            </div>

            <span
              className={
                isRunning
                  ? "admin-status admin-status--online"
                  : "admin-status admin-status--offline"
              }
            >
              {isRunning
                ? "RUNNING"
                : "STOPPED"}
            </span>
          </div>

          <div className="bot-command-grid">
            <button
              type="button"
              disabled={busy || isRunning}
              onClick={() => {
                runAction("start");
              }}
            >
              <Icon
                name="play"
                size={20}
              />

              <strong>Start Bot</strong>

              <small>
                Enable automation
              </small>
            </button>

            <button
              type="button"
              disabled={busy || !isRunning}
              onClick={() => {
                runAction("stop");
              }}
            >
              <Icon
                name="close"
                size={20}
              />

              <strong>Stop Bot</strong>

              <small>
                Pause automation
              </small>
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={() => {
                runAction("scan");
              }}
            >
              <Icon
                name="search"
                size={20}
              />

              <strong>Scan Catalog</strong>

              <small>
                Discover new media
              </small>
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={() => {
                runAction("process");
              }}
            >
              <Icon
                name="chart"
                size={20}
              />

              <strong>Process Queue</strong>

              <small>
                Run pending jobs
              </small>
            </button>
          </div>
        </article>

        <article className="admin-panel">
          <div className="admin-panel__heading">
            <div>
              <span>LIVE</span>
              <h3>Bot Metrics</h3>
            </div>
          </div>

          <div className="bot-metric-grid">
            <div>
              <span>Queued</span>
              <strong>
                {bot?.queued_jobs ?? 0}
              </strong>
            </div>

            <div>
              <span>Processing</span>
              <strong>
                {bot?.current_job ? 1 : 0}
              </strong>
            </div>

            <div>
              <span>Completed</span>
              <strong>
                {bot?.completed_jobs ?? 0}
              </strong>
            </div>

            <div>
              <span>Errors</span>
              <strong>
                {bot?.failed_jobs ?? 0}
              </strong>
            </div>
          </div>
        </article>
      </section>

      <section className="admin-panel">
        <div className="admin-panel__heading">
          <div>
            <span>ACTIVITY</span>
            <h3>Bot Event Stream</h3>
          </div>

          <button
            type="button"
            className="admin-refresh-button"
            onClick={loadBotStatus}
            disabled={busy}
          >
            Refresh
          </button>
        </div>

        {bot?.events?.length ? (
          <div className="bot-event-list">
            {bot.events.map((event) => (
              <div
                className="bot-event"
                key={event.id}
              >
                <span
                  className={
                    event.level === "error"
                      ? "admin-health-dot"
                      : "admin-health-dot admin-health-dot--ok"
                  }
                />

                <span>
                  {event.message}
                </span>

                <time>
                  {new Date(
                    event.timestamp,
                  ).toLocaleTimeString()}
                </time>
              </div>
            ))}
          </div>
        ) : (
          <div className="admin-empty-state">
            <Icon
              name="chart"
              size={28}
            />

            <strong>
              No bot activity yet
            </strong>

            <p>
              Start the bot or run a scan to
              create your first activity event.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
}

if (activePage === "admin") {
  return <AdminDashboardPage />;
}

if (activePage === "admin-bot") {
  return <AdminBotPage />;
}

if (activePage === "admin-uploads") {
  return <AdminUploadsPage />;
}

if (activePage === "admin-catalog") {
  return <AdminCatalogPage />;
}

return <AdminDashboardPage />;

  if (activePage === "search") {
    return (
      <SearchPage
        query={query}
        onQueryChange={onQueryChange}
      />
    );
  }

  if (activePage === "library") {
    return (
      <LibraryPage onOpenAuth={onOpenAuth} />
    );
  }

  if (activePage === "profile") {
    return (
      <ProfilePage
        currentUser={currentUser}
        onOpenAuth={onOpenAuth}
        onLogout={onLogout}
        compactMode={compactMode}
        onToggleCompact={onToggleCompact}
        statusMessage={statusMessage}
        onStatusMessage={onStatusMessage}
      />
    );
  }

 return (
  <HomePage
    currentUser={currentUser}
    onNavigate={onNavigate}
    onOpenAuth={onOpenAuth}
  />
);
}

function MobileBottomNav({
  activePage,
  onNavigate,
}) {
  return (
    <nav
      className="mobile-bottom-nav"
      aria-label="Mobile navigation"
    >
      {NAV_ITEMS.map((item) => (
        <button
          className={
            activePage === item.id
              ? "is-active"
              : ""
          }
          type="button"
          key={item.id}
          onClick={() => {
            onNavigate(item.id);
          }}
          aria-current={
            activePage === item.id
              ? "page"
              : undefined
          }
        >
          <Icon
            name={item.icon}
            size={20}
          />

          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

function PlayerBar() {
  // subscribes to the shared audio player state
  const [state, setState] = useState(() => ({
    src: null,
    paused: true,
    currentTime: 0,
    duration: 0,
  }));

  useEffect(() => {
    const unsub = player.subscribe((s) => {
      setState(s);
    });

    return unsub;
  }, []);

  const toggle = useCallback(async () => {
    try {
      await player.togglePlay();
    } catch (e) {
      // ignore play errors (browser may block autoplay)
    }
  }, []);

  const formatTime = (t) => {
    if (!isFinite(t) || t <= 0) return "0:00";
    const mins = Math.floor(t / 60);
    const secs = Math.floor(t % 60).toString().padStart(2, "0");
    return `${mins}:${secs}`;
  };

  const titleText = state.title || (state.src ? decodeURIComponent(state.src.replace(/.*\//, "")) : "Nothing playing");
  const subtitleText = state.artist
    ? state.artist
    : state.src
      ? "Now playing"
      : "Select a real track after catalog integration";

  const canControl = Boolean(state.src);

  return (
    <section
      className="player-bar"
      aria-label="Player status"
    >
      <div className="player-bar__track">
        <TrackArtwork
          src={state.artworkUrl}
          alt={titleText}
          variant={1}
        />

        <span>
          <strong>
            {titleText}
          </strong>

          <small>
            {state.src
              ? `${subtitleText} • ${formatTime(state.currentTime)} / ${formatTime(state.duration)}`
              : subtitleText}
          </small>
        </span>
      </div>

      <button
        className="player-like"
        type="button"
        disabled={!canControl}
        aria-label="Like"
      >
        <Icon name="heart" size={19} />
      </button>

      <div className="desktop-player-controls">
        <button
          type="button"
          onClick={() => player.seekTo(0)}
          disabled={!canControl}
          aria-label="Previous"
        >
          <Icon name="previous" size={17} />
        </button>

        <button
          className={"desktop-player-controls__main"}
          type="button"
          onClick={toggle}
          disabled={!canControl}
          aria-label={state.paused ? "Play" : "Pause"}
        >
          <Icon name={state.paused ? "play" : "pause"} size={21} />
        </button>

        <button
          type="button"
          onClick={() => player.seekTo(state.duration || 0)}
          disabled={!canControl}
          aria-label="Next"
        >
          <Icon name="next" size={17} />
        </button>
      </div>

      <div className="desktop-progress" aria-hidden="true">
        <span>{formatTime(state.currentTime)}</span>
        <i />
        <span>{formatTime(state.duration)}</span>
      </div>

      <button
        className="mobile-player-control"
        type="button"
        onClick={toggle}
        disabled={!canControl}
        aria-label="Playback"
      >
        <Icon name={state.paused ? "play" : "pause"} size={19} />
      </button>
    </section>
  );
}

// -----------------------------------------------------------------------------
// Authentication
// -----------------------------------------------------------------------------

function AuthOverlay({
  open,
  mode,
  onModeChange,
  onClose,
  onGuest,
  onAuthenticated,
}) {
  const [showPassword, setShowPassword] =
    useState(false);

  const [rememberMe, setRememberMe] =
    useState(true);

  const [message, setMessage] =
    useState("");

  if (!open) {
    return null;
  }

  const isCreate = mode === "create";

  async function submit(event) {
  event.preventDefault();

  setMessage("");

  const form =
    new FormData(event.currentTarget);

  const username =
    String(
      form.get("username") ?? "",
    ).trim();

  const password =
    String(
      form.get("password") ?? "",
    );

  try {
    const data = await apiRequest(
      isCreate
        ? "/auth/register"
        : "/auth/login",
      {
        method: "POST",
        body: JSON.stringify(
          isCreate
            ? {
                username,
                email: String(
                  form.get("email") ?? "",
                ).trim(),
                password,
              }
            : {
                username,
                password,
              },
        ),
      },
    );

    saveAuthSession(
      data.access_token,
      { remember: rememberMe },
    );

    cacheUserProfile(
      data.user,
      { remember: rememberMe },
    );

    onAuthenticated(data.user);

    onClose();

    setMessage("");
  } catch (error) {
    setMessage(
      error instanceof Error
        ? error.message
        : "Authentication failed.",
    );
  }
}

  return (
    <div
      className="auth-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-title"
    >
      <HexBackdrop idPrefix="main-app-background" />

      <div className="auth-panel bevel-panel">
        <button
          className="auth-close"
          type="button"
          onClick={onClose}
          aria-label="Close account screen"
        >
          <Icon
            name="close"
            size={20}
          />
        </button>

        <BrandLogo idPrefix="auth-logo" />

        <div className="auth-heading">
          <h2 id="auth-title">
            {isCreate
              ? "Create your HyperSync account"
              : "Welcome to HyperSync"}
          </h2>

          <p>
            {isCreate
              ? (
                "Create a HyperSync account to save " +
                "your library and sync across devices."
              )
              : (
                "Sync your world. Stream your sound. " +
                "Feel the music."
              )}
          </p>
        </div>

        <form
          className="auth-form"
          onSubmit={submit}
        >
          <label>
            <Icon
              name="mail"
              size={22}
            />

            <input
              type="text"
              name="username"
              autoComplete="username"
              placeholder="Username"
              required
            />
          </label>

          {isCreate ? (
            <label>
              <Icon
                name="mail"
                size={22}
              />

              <input
                type="email"
                name="email"
                autoComplete="email"
                placeholder="Email address"
                required
              />
            </label>
          ) : null}

          <label>
            <Icon
              name="lock"
              size={22}
            />

            <input
              type={
                showPassword
                  ? "text"
                  : "password"
              }
              name="password"
              autoComplete={
                isCreate
                  ? "new-password"
                  : "current-password"
              }
              placeholder="Password"
              required
            />

            <button
              type="button"
              onClick={() => {
                setShowPassword(
                  (value) => !value,
                );
              }}
              aria-label={
                showPassword
                  ? "Hide password"
                  : "Show password"
              }
            >
              <Icon
                name={
                  showPassword
                    ? "eyeOff"
                    : "eye"
                }
                size={22}
              />
            </button>
          </label>

          {!isCreate ? (
            <div className="auth-options">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(event) => {
                    setRememberMe(
                      event.target.checked,
                    );
                  }}
                />

                <span>
                  <Icon
                    name="check"
                    size={15}
                  />
                </span>

                Remember me
              </label>

              <button
                type="button"
                onClick={() => {
                  setMessage(
                    "Password recovery is not " +
                    "implemented yet.",
                  );
                }}
              >
                Forgot password?
              </button>
            </div>
          ) : null}

          <button
            className="auth-submit"
            type="submit"
          >
            {isCreate
              ? "CREATE ACCOUNT"
              : "SIGN IN"}
          </button>
        </form>

        <div className="auth-divider">
          <span>OR</span>
        </div>

        <button
          className="auth-secondary"
          type="button"
          onClick={() => {
            onModeChange(
              isCreate
                ? "signin"
                : "create",
            );
          }}
        >
          {isCreate
            ? "BACK TO SIGN IN"
            : "CREATE ACCOUNT"}
        </button>

        <button
          className="auth-guest"
          type="button"
          onClick={onGuest}
        >
          or use without account
        </button>

        {message ? (
          <p
            className="auth-message"
            role="status"
          >
            {message}
          </p>
        ) : null}

        <p className="auth-legal">
          Terms of Service and Privacy Policy
          pages will be linked before launch.
        </p>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// App shell
// -----------------------------------------------------------------------------

export default function App() {
  const [currentUser, setCurrentUser] =
    useState(() => readCachedUserProfile());

  const [activePage, setActivePage] =
    useState("home");

  const [searchQuery, setSearchQuery] =
    useState("");

  const [authOpen, setAuthOpen] =
    useState(
      () => (
        !shouldRestoreSession() &&
        !readCachedUserProfile()
      ),
    );

  const [authMode, setAuthMode] =
    useState("signin");

  const [compactMode, setCompactMode] =
    useState(false);

  const [statusMessage, setStatusMessage] =
    useState("");

  function handleLogout() {
    logoutSession();

    setCurrentUser(null);
    setActivePage("home");
    setAuthMode("signin");
    setAuthOpen(false);
  }

  const pageTitle =
    PAGE_TITLES[activePage] ??
    "HyperSync";

  const appClassName = useMemo(
    () => (
      `app-shell ${
        compactMode
          ? "is-compact"
          : ""
      }`
    ),
    [compactMode],
  );

  useEffect(() => {
    if (!shouldRestoreSession()) {
      if (!readCachedUserProfile()) {
        setAuthOpen(true);
      }

      return undefined;
    }

    let cancelled = false;

    const syncSession = () => {
      restoreSession().then((user) => {
        if (cancelled) {
          return;
        }

        if (user) {
          setCurrentUser(user);
          setAuthOpen(false);
          return;
        }

        if (!readCachedUserProfile()) {
          setCurrentUser(null);
          setAuthOpen(true);
          return;
        }

        setCurrentUser(null);
        setAuthOpen(true);
      });
    };

    if (
      typeof requestIdleCallback ===
      "function"
    ) {
      const idleId =
        requestIdleCallback(syncSession, {
          timeout: 250,
        });

      return () => {
        cancelled = true;
        cancelIdleCallback(idleId);
      };
    }

    const timeoutId =
      window.setTimeout(syncSession, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, []);

  const navigate = useCallback((page) => {
    setActivePage(page);
    setStatusMessage("");
  }, []);

  const updateSearch = useCallback((value) => {
    setSearchQuery(value);
    setActivePage((currentPage) => (
      currentPage === "search"
        ? currentPage
        : "search"
    ));
  }, []);

  const openAuth = useCallback((mode = "signin") => {
    setAuthMode(mode);
    setAuthOpen(true);
  }, []);

  const openSignIn = useCallback(() => {
    openAuth("signin");
  }, [openAuth]);

  const toggleCompact = useCallback(() => {
    setCompactMode((value) => !value);
  }, []);

  const handleAuthenticated = useCallback((user) => {
    cacheUserProfile(user);
    setCurrentUser(user);
    setActivePage("home");
    setAuthOpen(false);
  }, []);

  const closeAuth = useCallback(() => {
    setAuthOpen(false);
  }, []);

  const continueAsGuest = useCallback(() => {
    setAuthOpen(false);
  }, []);

  return (
    <div className={appClassName}>
      <HexBackdrop idPrefix="auth-overlay-background" />

<DesktopSidebar
  activePage={activePage}
  currentUser={currentUser}
  onNavigate={navigate}
  onOpenAuth={() => {
    openAuth("signin");
  }}
/>

      <section className="main-workspace">
        <MobileHeader
          title={pageTitle}
          onOpenAuth={() => {
            openAuth("signin");
          }}
        />

        <DesktopTopbar
          activePage={activePage}
          searchQuery={searchQuery}
          onSearchChange={updateSearch}
          currentUser={currentUser}
          onNavigate={navigate}
          onOpenAuth={() => {
            openAuth("signin");
          }}
        />

        <main className="main-content">
          <MainPage
            activePage={activePage}
            currentUser={currentUser}
            onNavigate={navigate}
            onOpenAuth={() => {
              openAuth("signin");
            }}
            onLogout={handleLogout}
            query={searchQuery}
            onQueryChange={updateSearch}
            compactMode={compactMode}
            onToggleCompact={() => {
              setCompactMode(
                (value) => !value,
              );
            }}
            statusMessage={statusMessage}
            onStatusMessage={setStatusMessage}
          />
        </main>
      </section>

      <DesktopRightRail />

      <PlayerBar />

      <MobileBottomNav
        activePage={activePage}
        onNavigate={navigate}
      />

<AuthOverlay
  open={authOpen}
  mode={authMode}
  onModeChange={setAuthMode}
  onClose={() => {
    setAuthOpen(false);
  }}
  onAuthenticated={(user) => {
    cacheUserProfile(user);
    setCurrentUser(user);
    setActivePage("home");
  }}
  onGuest={() => {
    setAuthOpen(false);
  }}
/>
    </div>
  );
}
