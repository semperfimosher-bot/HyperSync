import Avatar from
  "../profile/Avatar.jsx";

import Icon from
  "./Icon.jsx";


function notificationTime(
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

  return date.toLocaleTimeString(
    [],
    {
      hour:
        "numeric",
      minute:
        "2-digit",
    },
  );
}


export default function MessageNotificationPanel({
  data,
  onOpenMessage,
  onReadAdminNotification,
  onEnablePush,
  pushBusy = false,
  pushEnabled = false,
}) {
  const notifications =
    Array.isArray(
      data?.notifications,
    )
      ? data.notifications
      : [];

  const unreadCount =
    Number(
      data?.unread_count ??
      0,
    ) || 0;

  return (
    <div className="message-notification-block">
      <div className="message-notification-block__heading">
        <span>
          NOTIFICATIONS
        </span>

        <strong>
          {unreadCount}
        </strong>
      </div>

      {notifications.length > 0 ? (
        <div className="message-notification-list">
          {notifications.map(
            (
              notification,
            ) => {
              const adminActivity =
                notification.type ===
                "admin_activity";

              return (
                <button
                  type="button"
                  key={
                    adminActivity
                      ? notification
                          .notification_id
                      : notification
                          .message_id
                  }
                  onClick={() => {
                    if (adminActivity) {
                      onReadAdminNotification?.(
                        notification
                          .notification_id,
                      );
                      return;
                    }

                    onOpenMessage?.(
                      notification
                        .sender_username,
                    );
                  }}
                >
                  <Avatar
                    src={
                      adminActivity
                        ? null
                        : notification
                            .sender_avatar_url
                    }
                    name={
                      adminActivity
                        ? (
                            notification
                              .actor_username
                            || "HyperSync"
                          )
                        : notification
                            .sender_display_name
                    }
                    size="small"
                  />

                  <span>
                    <strong>
                      {adminActivity
                        ? notification.title
                        : notification
                            .sender_display_name}
                    </strong>

                    <em>
                      {adminActivity
                        ? notification.body
                        : notification.preview}
                    </em>
                  </span>

                  <small>
                    {notificationTime(
                      notification
                        .created_at,
                    )}
                  </small>
                </button>
              );
            },
          )}
        </div>
      ) : (
        <div className="message-notification-empty">
          <Icon
            name="mail"
            size={18}
          />

          <span>
            No unread notifications
          </span>
        </div>
      )}

      {onEnablePush ? (
        <>
          <button
            type="button"
            className={
              pushEnabled
                ? "message-push-enable is-enabled"
                : "message-push-enable"
            }
            disabled={
              pushBusy ||
              pushEnabled
            }
            onClick={
              onEnablePush
            }
          >
            <Icon
              name="bell"
              size={14}
            />

            {pushEnabled
              ? "Push notifications on"
              : pushBusy
                ? "Turning on..."
                : "Enable push notifications"}
          </button>

        </>
      ) : null}
    </div>
  );
}
