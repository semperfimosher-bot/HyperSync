import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import * as player from "./audioPlayer.js";

import {
  getGreetingName,
  isAdminUser
} from "./utils/user.js";

import {
  cacheUserProfile,
  hasStoredSession,
  logoutSession,
  readCachedUserProfile,
  restoreSession,
  saveAuthSession,
  shouldRestoreSession,
} from "./api/auth.js";

import { apiRequest } from "./api/client.js";

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

import TrackArtwork from "./components/ui/TrackArtwork.jsx";

import BrandLogo from "./components/ui/BrandLogo.jsx";

import MobileHeader from "./components/layout/MobileHeader.jsx";

import DesktopSidebar from "./components/layout/DesktopSidebar.jsx";

import DesktopTopbar from "./components/layout/DesktopTopbar.jsx";

import DesktopRightRail from "./components/layout/DesktopRightRail.jsx";

import HomePage from "./components/pages/HomePage.jsx";

import LibraryPage from "./components/pages/LibraryPage.jsx";

import SearchPage from "./components/pages/SearchPage.jsx";

import SectionHeading from "./components/ui/SectionHeading.jsx";

// -----------------------------------------------------------------------------
// Pages
// -----------------------------------------------------------------------------

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
      <div
        className={`cover-placeholder cover-placeholder--${variant}`}
        aria-hidden="true"
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

function AdminBotPage() {
  const [status, setStatus] = useState("offline");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const refreshStatus = useCallback(async () => {
    setLoading(true);
    setMessage("");

    try {
      const data = await apiRequest("/admin/bot/status");

      setStatus(
        data?.status ||
          data?.state ||
          "offline",
      );
    } catch (error) {
      setStatus("offline");

      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to load bot status.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const sendBotAction = async (action) => {
    setLoading(true);
    setMessage("");

    try {
      await apiRequest("/admin/bot/control", {
        method: "POST",
        body: JSON.stringify({
          action,
        }),
      });

      setMessage(
        `Bot ${action} command sent successfully.`,
      );

      await refreshStatus();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Bot command failed.",
      );
    } finally {
      setLoading(false);
    }
  };

  const isOnline =
    status === "online" ||
    status === "running" ||
    status === "healthy";

  return (
    <div className="page-stack admin-page">
      <section className="admin-page__header">
        <span>ADMINISTRATION</span>

        <h2>Bot Control</h2>

        <p>
          Monitor and control the HyperSync
          automation service.
        </p>
      </section>

      <section className="admin-panel">
        <div className="admin-panel__heading">
          <div>
            <span>AUTOMATION</span>
            <h3>Bot Status</h3>
          </div>

          <span
            className={
              isOnline
                ? "admin-status admin-status--online"
                : "admin-status admin-status--offline"
            }
          >
            {isOnline ? "ONLINE" : "OFFLINE"}
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
            <strong>
              HyperSync Bot
            </strong>

            <p>
              Current status:{" "}
              {status}
            </p>
          </div>
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

      <section className="admin-panel">
        <div className="admin-panel__heading">
          <div>
            <span>CONTROLS</span>
            <h3>Bot Controls</h3>
          </div>
        </div>

        <div className="admin-quick-actions">
          <button
            type="button"
            className="admin-quick-action"
            disabled={loading}
            onClick={() =>
              sendBotAction("start")
            }
          >
            <span className="admin-quick-action__icon">
              <Icon
                name="play"
                size={20}
              />
            </span>

            <span>
              <strong>Start Bot</strong>
              <small>
                Start the automation service.
              </small>
            </span>
          </button>

          <button
            type="button"
            className="admin-quick-action"
            disabled={loading}
            onClick={() =>
              sendBotAction("stop")
            }
          >
            <span className="admin-quick-action__icon">
              <Icon
                name="close"
                size={20}
              />
            </span>

            <span>
              <strong>Stop Bot</strong>
              <small>
                Stop the automation service.
              </small>
            </span>
          </button>

          <button
            type="button"
            className="admin-quick-action"
            disabled={loading}
            onClick={() =>
              sendBotAction("restart")
            }
          >
            <span className="admin-quick-action__icon">
              <Icon
                name="chart"
                size={20}
              />
            </span>

            <span>
              <strong>Restart Bot</strong>
              <small>
                Restart the automation service.
              </small>
            </span>
          </button>
        </div>

        <button
          type="button"
          className="secondary-admin-button"
          disabled={loading}
          onClick={refreshStatus}
        >
          {loading
            ? "Refreshing..."
            : "Refresh Status"}

          <Icon
            name="chevron"
            size={14}
          />
        </button>
      </section>
    </div>
  );
}

function AdminCatalogPage() {
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const loadTracks = useCallback(async () => {
    setLoading(true);
    setMessage("");

    try {
      const data = await apiRequest(
        "/catalog/tracks",
      );

      setTracks(data || []);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to load catalog.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTracks();
  }, [loadTracks]);

  const deleteTrack = async (trackId) => {
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

      setMessage("Track deleted.");
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
      <section className="admin-page__header">
        <span>ADMINISTRATION</span>

        <h2>Media Catalog</h2>

        <p>
          Review and manage every published
          HyperSync track.
        </p>
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
        <div className="admin-panel__heading">
          <div>
            <span>CATALOG</span>
            <h3>Published Tracks</h3>
          </div>

          <strong className="admin-panel-count">
            {tracks.length} total
          </strong>
        </div>

        {loading ? (
          <div className="admin-empty-state">
            <Icon
              name="chart"
              size={28}
            />

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
              No published tracks
            </strong>

            <p>
              Upload a track to populate
              the catalog.
            </p>
          </div>
        ) : (
          <div className="admin-recent-list">
            {tracks.map((track) => (
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
                  <strong>
                    {track.title}
                  </strong>

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
                        track.duration_seconds /
                          60,
                      )}:${String(
                        track.duration_seconds %
                          60,
                      ).padStart(2, "0")}`
                    : "—"}
                </span>

                <button
                  type="button"
                  className="danger-button"
                  onClick={() =>
                    deleteTrack(track.id)
                  }
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <button
        type="button"
        className="secondary-admin-button"
        onClick={loadTracks}
        disabled={loading}
      >
        {loading
          ? "Refreshing..."
          : "Refresh Catalog"}

        <Icon
          name="chevron"
          size={14}
        />
      </button>
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
  const adminPage = ADMIN_NAV_ITEMS.some(
    (item) => item.id === activePage,
  );

  if (adminPage) {
    if (!isAdminUser(currentUser)) {
      return (
        <div className="page-stack">
          <section className="admin-page__denied">
            <Icon
              name="lock"
              size={28}
            />

            <h2>Admin access required</h2>

            <p>
              This area is available only to
              HyperSync administrators.
            </p>
          </section>
        </div>
      );
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
  }

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
      <LibraryPage
        onOpenAuth={onOpenAuth}
      />
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
