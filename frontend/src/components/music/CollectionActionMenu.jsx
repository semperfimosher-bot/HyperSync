import {
  useEffect,
} from "react";

import Icon from
  "../ui/Icon.jsx";

import {
  requestMusicShare,
} from "../../musicShare.js";


export default function CollectionActionMenu({
  menu,
  onClose,
}) {
  useEffect(() => {
    if (!menu) {
      return undefined;
    }

    function handleKeyDown(
      event,
    ) {
      if (
        event.key ===
        "Escape"
      ) {
        onClose();
      }
    }

    window.addEventListener(
      "keydown",
      handleKeyDown,
    );

    return () => {
      window.removeEventListener(
        "keydown",
        handleKeyDown,
      );
    };
  }, [
    menu,
    onClose,
  ]);


  if (!menu) {
    return null;
  }

  const actions =
    (
      Array.isArray(
        menu.actions,
      )
        ? menu.actions
        : []
    ).filter(
      (action) =>
        action &&
        typeof action.onSelect ===
          "function" &&
        action.id !==
          "share",
    );

  const shareItem = {
    kind:
      menu.kind,
    key:
      menu.shareKey ??
      menu.key,
    title:
      menu.title,
    subtitle:
      menu.subtitle ??
      null,
    artwork_url:
      menu.artwork_url ??
      menu.artworkUrl ??
      null,
  };


  return (
    <div
      className={[
        "track-action-layer",

        menu.mode ===
          "mobile"
          ? "is-mobile"
          : "",
      ]
        .filter(Boolean)
        .join(" ")}
      role="presentation"
      onPointerDown={(
        event,
      ) => {
        if (
          event.target ===
          event.currentTarget
        ) {
          onClose();
        }
      }}
    >
      <div
        role="menu"
        className="track-action-menu"
        onPointerDown={(
          event,
        ) => {
          event.stopPropagation();
        }}
      >
        <div className="track-action-menu__track">
          <div>
            <strong>
              {menu.title}
            </strong>

            <small>
              {menu.subtitle ||
                (
                  menu.kind ===
                    "album"
                    ? "ALBUM"
                    : "PLAYLIST"
                )}
            </small>
          </div>

          <button
            type="button"
            aria-label="Close"
            onClick={
              onClose
            }
          >
            <Icon
              name="close"
              size={14}
            />
          </button>
        </div>

        {actions.map(
          (action) => (
            <button
              type="button"
              role="menuitem"
              key={
                action.id
              }
              disabled={
                Boolean(
                  action.disabled,
                )
              }
              onClick={() => {
                onClose();

                void Promise.resolve(
                  action.onSelect(),
                ).catch(
                  () => {},
                );
              }}
            >
              <span className="track-action-icon">
                <Icon
                  name={
                    action.icon ||
                    "chevron"
                  }
                  size={15}
                />
              </span>

              <span>
                {action.label}
              </span>
            </button>
          ),
        )}

        <button
          type="button"
          role="menuitem"
          onClick={() => {
            requestMusicShare(
              shareItem,
            );

            onClose();
          }}
        >
          <span className="track-action-icon">
            <Icon
              name="mail"
              size={15}
            />
          </span>

          <span>
            Share in chat
          </span>
        </button>
      </div>
    </div>
  );
}
