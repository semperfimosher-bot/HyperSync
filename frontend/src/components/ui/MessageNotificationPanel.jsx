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
  onEnablePush,
  pushBusy = false,
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
          NEW MESSAGES
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
            ) => (
              <button
                type="button"
                key={
                  notification.message_id
                }
                onClick={() => {
                  onOpenMessage?.(
                    notification
                      .sender_username,
                  );
                }}
              >
                <Avatar
                  src={
                    notification
                      .sender_avatar_url
                  }
                  name={
                    notification
                      .sender_display_name
                  }
                  size="small"
                />

                <span>
                  <strong>
                    {notification
                      .sender_display_name}
                  </strong>

                  <em>
                    {notification.preview}
                  </em>
                </span>

                <small>
                  {notificationTime(
                    notification
                      .created_at,
                  )}
                </small>
              </button>
            ),
          )}
        </div>
      ) : (
        <div className="message-notification-empty">
          <Icon
            name="mail"
            size={18}
          />

          <span>
            No unread messages
          </span>
        </div>
      )}

      {onEnablePush ? (
        <button
          type="button"
          className="message-push-enable"
          disabled={
            pushBusy
          }
          onClick={
            onEnablePush
          }
        >
          <Icon
            name="bell"
            size={14}
          />

          {pushBusy
            ? "Enabling..."
            : "Enable push notifications"}
        </button>
      ) : null}
    </div>
  );
}
