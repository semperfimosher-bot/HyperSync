import {
  useEffect,
} from "react";

import Avatar from
  "../profile/Avatar.jsx";

import Icon from
  "./Icon.jsx";


function detailTime(
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

  return date.toLocaleString(
    [],
    {
      dateStyle:
        "medium",
      timeStyle:
        "short",
    },
  );
}


export default function NotificationDetailOverlay({
  notification,
  onClose,
  onOpenMessage,
  onOpenSharedMusic,
}) {
  useEffect(() => {
    if (!notification) {
      return undefined;
    }

    const handleKeyDown =
      (event) => {
        if (
          event.key ===
          "Escape"
        ) {
          onClose?.();
        }
      };

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
    notification,
    onClose,
  ]);

  if (!notification) {
    return null;
  }

  const adminActivity =
    notification.type ===
    "admin_activity";

  const sharedMusic =
    adminActivity
      ? null
      : notification
          .shared_music ??
        null;

  const title =
    adminActivity
      ? notification.title
      : "Message from " +
        (
          notification
            .sender_display_name
          || notification
            .sender_username
          || "HyperSync user"
        );

  const identity =
    adminActivity
      ? (
          notification
            .actor_username
          || "HyperSync"
        )
      : (
          notification
            .sender_display_name
          || notification
            .sender_username
          || "HyperSync user"
        );

  const detailId =
    adminActivity
      ? notification
          .notification_id
      : notification
          .message_id;

  return (
    <div
      className="notification-detail-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="notification-detail-title"
      onMouseDown={(event) => {
        if (
          event.target ===
          event.currentTarget
        ) {
          onClose?.();
        }
      }}
    >
      <section className="notification-detail-panel">
        <button
          className="notification-detail-panel__close"
          type="button"
          onClick={
            onClose
          }
          aria-label="Close notification details"
        >
          <Icon
            name="close"
            size={18}
          />
        </button>

        <div className="notification-detail-panel__heading">
          <Avatar
            src={
              adminActivity
                ? null
                : notification
                    .sender_avatar_url
            }
            name={
              identity
            }
            size="small"
          />

          <div>
            <span className="hs-eyebrow">
              {adminActivity
                ? "ADMIN ACTIVITY"
                : "MESSAGE"}
            </span>

            <h2 id="notification-detail-title">
              {title}
            </h2>

            <p>
              {detailTime(
                notification
                  .created_at,
              )}
            </p>
          </div>
        </div>

        <div className="notification-detail-grid">
          {adminActivity ? (
            <>
              <div>
                <span>Actor</span>
                <strong>
                  {notification
                    .actor_username
                    ? (
                        "@" +
                        notification
                          .actor_username
                      )
                    : "System"}
                </strong>
              </div>

              <div>
                <span>Type</span>
                <strong>
                  {notification.kind
                    || "activity"}
                </strong>
              </div>
            </>
          ) : (
            <>
              <div>
                <span>From</span>
                <strong>
                  @{notification
                    .sender_username}
                </strong>
              </div>

              <div>
                <span>To</span>
                <strong>
                  @{notification
                    .recipient_username}
                </strong>
              </div>
            </>
          )}

          <div className="notification-detail-grid__wide">
            <span>
              {adminActivity
                ? "Activity details"
                : "Message"}
            </span>

            <p className="notification-detail-body">
              {adminActivity
                ? notification.body
                : (
                    notification.body
                    || notification.preview
                    || "Shared music"
                  )}
            </p>
          </div>

          {sharedMusic ? (
            <div className="notification-detail-shared notification-detail-grid__wide">
              {sharedMusic
                .artwork_url ? (
                <img
                  src={
                    sharedMusic
                      .artwork_url
                  }
                  alt=""
                />
              ) : (
                <span className="notification-detail-shared__art">
                  <Icon
                    name="music"
                    size={22}
                  />
                </span>
              )}

              <div>
                <span>
                  Shared {
                    sharedMusic.kind
                  }
                </span>

                <strong>
                  {sharedMusic.title}
                </strong>

                {sharedMusic.subtitle ? (
                  <em>
                    {sharedMusic.subtitle}
                  </em>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="notification-detail-grid__wide notification-detail-meta">
            <span>
              {adminActivity
                ? "Notification ID"
                : "Message ID"}
            </span>
            <code>
              {detailId}
            </code>
          </div>
        </div>

        <div className="notification-detail-actions">
          {!adminActivity ? (
            <button
              type="button"
              className="notification-detail-actions__primary"
              onClick={() => {
                onClose?.();
                onOpenMessage?.(
                  notification
                    .sender_username,
                );
              }}
            >
              OPEN CONVERSATION
            </button>
          ) : null}

          {sharedMusic ? (
            <button
              type="button"
              onClick={() => {
                onClose?.();
                onOpenSharedMusic?.(
                  sharedMusic,
                );
              }}
            >
              OPEN SHARED MUSIC
            </button>
          ) : null}

          <button
            type="button"
            onClick={
              onClose
            }
          >
            CLOSE
          </button>
        </div>
      </section>
    </div>
  );
}
