export function notificationIdentity(
  notification,
) {
  const type =
    String(
      notification?.type ??
        "",
    );

  const adminNotification =
    type === "admin_activity" ||
    type ===
      "admin_account_notification";

  const rawId =
    adminNotification
      ? notification
          ?.notification_id
      : notification
          ?.message_id;

  return (
    type +
    ":" +
    String(
      rawId ??
        "",
    )
  );
}


export function emptyNotificationSnapshot() {
  return {
    unread_count:
      0,
    notifications:
      [],
  };
}


export function removeNotificationFromSnapshot(
  snapshot,
  notification,
) {
  if (!notification) {
    return (
      snapshot ??
      emptyNotificationSnapshot()
    );
  }

  const currentItems =
    Array.isArray(
      snapshot?.notifications,
    )
      ? snapshot.notifications
      : [];

  const targetIdentity =
    notificationIdentity(
      notification,
    );

  const nextItems =
    currentItems.filter(
      (item) =>
        notificationIdentity(
          item,
        ) !==
        targetIdentity,
    );

  const removed =
    nextItems.length <
    currentItems.length;

  return {
    unread_count:
      Math.max(
        (
          Number(
            snapshot
              ?.unread_count ??
              currentItems.length,
          ) || 0
        ) -
        (
          removed
            ? 1
            : 0
        ),
        0,
      ),
    notifications:
      nextItems,
  };
}
