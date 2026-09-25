import Icon from "./Icon.jsx";


export default function AppInstallModal({
  open,
  mode,
  onClose,
}) {
  if (!open) {
    return null;
  }

  const ios =
    mode ===
      "manual-ios";

  return (
    <div
      className="app-install-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="app-install-title"
      onMouseDown={(event) => {
        if (
          event.target ===
            event.currentTarget
        ) {
          onClose?.();
        }
      }}
    >
      <div className="app-install-panel">
        <button
          type="button"
          className="app-install-panel__close"
          onClick={
            onClose
          }
          aria-label="Close install instructions"
        >
          <Icon
            name="close"
            size={17}
          />
        </button>

        <div className="app-install-panel__icon">
          <Icon
            name="download"
            size={26}
          />
        </div>

        <span className="hs-eyebrow">
          INSTALL HYPERSYNCED
        </span>

        <h2 id="app-install-title">
          Add HyperSynced as an app
        </h2>

        <p>
          The installed app opens in its own
          window and keeps your downloaded
          music available when you are offline.
        </p>

        <div className="app-install-steps">
          {ios ? (
            <>
              <span>
                <strong>1</strong>
                Tap the browser Share button.
              </span>

              <span>
                <strong>2</strong>
                Choose Add to Home Screen.
              </span>

              <span>
                <strong>3</strong>
                Tap Add to install HyperSynced.
              </span>
            </>
          ) : (
            <>
              <span>
                <strong>1</strong>
                Open your browser menu.
              </span>

              <span>
                <strong>2</strong>
                Choose Install HyperSynced or
                Install this site as an app.
              </span>

              <span>
                <strong>3</strong>
                Confirm Install.
              </span>
            </>
          )}
        </div>

        <button
          type="button"
          className="app-install-panel__done"
          onClick={
            onClose
          }
        >
          Got it
        </button>
      </div>
    </div>
  );
}
