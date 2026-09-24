import { createPortal } from "react-dom";

import Icon from "./Icon.jsx";


function DownloadRemovalConfirm({
  open,
  playlistTitle,
  itemTitle = null,
  itemKind = "playlist",
  busy = false,
  onCancel,
  onConfirm,
}) {
  if (!open) {
    return null;
  }

  return createPortal(
    <div
      className="library-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (
          event.target ===
            event.currentTarget &&
          !busy
        ) {
          onCancel?.();
        }
      }}
    >
      <section
        className="library-modal hs-download-confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="download-remove-title"
      >
        <div className="library-modal__header">
          <div>
            <span>
              OFFLINE DOWNLOAD
            </span>

            <h2 id="download-remove-title">
              Remove download?
            </h2>
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            aria-label="Close"
          >
            <Icon
              name="close"
              size={17}
            />
          </button>
        </div>

        <p className="hs-download-confirm__copy">
          Remove
          {" "}
          <strong>
            {itemTitle ||
              playlistTitle ||
              (
                itemKind === "song"
                  ? "this song"
                  : "this playlist"
              )}
          </strong>
          {" "}
          from downloads?
          {" "}
          {itemKind === "song"
            ? "The song will stay in your Library, but its offline file will be removed from this device."
            : "The playlist will stay in your Library, but its offline files will be removed from this device."}
        </p>

        <div className="library-modal__actions">
          <button
            type="button"
            className="hs-search-playlist-action"
            disabled={busy}
            onClick={onCancel}
          >
            No
          </button>

          <button
            type="button"
            className="hs-search-playlist-primary hs-download-confirm__remove"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy
              ? "Removing..."
              : "Yes, remove"}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}


export default DownloadRemovalConfirm;
