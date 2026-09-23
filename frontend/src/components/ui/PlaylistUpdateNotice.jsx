import Icon from "./Icon.jsx";


function PlaylistUpdateNotice({
  update,
  variant = "mobile",
  onDownload,
  onDismiss,
}) {
  if (!update) {
    return null;
  }

  const count =
    update.missingTracks?.length ??
    0;

  const busy =
    update.status ===
    "downloading";

  const progress =
    Math.round(
      Math.max(
        0,
        Math.min(
          1,
          Number(
            update.progress ??
            0,
          ),
        ),
      ) * 100,
    );

  return (
    <aside
      className={
        "playlist-update-notice " +
        `playlist-update-notice--${variant}`
      }
      role="status"
      aria-live="polite"
    >
      <span className="playlist-update-notice__icon">
        <Icon
          name="download"
          size={16}
        />
      </span>

      <span className="playlist-update-notice__copy">
        <strong>
          {count}
          {" "}
          {count === 1
            ? "new song"
            : "new songs"}
        </strong>

        <small>
          {update.playlist?.title ??
            "Generated playlist"}
        </small>
      </span>

      <button
        type="button"
        className="playlist-update-notice__download"
        disabled={busy}
        onClick={onDownload}
      >
        {busy
          ? `${progress}%`
          : "Download"}
      </button>

      <button
        type="button"
        className="playlist-update-notice__dismiss"
        aria-label="Dismiss playlist update"
        disabled={busy}
        onClick={onDismiss}
      >
        <Icon
          name="close"
          size={13}
        />
      </button>
    </aside>
  );
}


export default PlaylistUpdateNotice;
