import assert from "node:assert/strict";
import test from "node:test";

import {
  emptyNotificationSnapshot,
  notificationIdentity,
  removeNotificationFromSnapshot,
} from "./messageNotifications.js";


test(
  "notification identity distinguishes admin and message ids",
  () => {
    assert.equal(
      notificationIdentity({
        type: "admin_activity",
        notification_id: "admin-1",
      }),
      "admin_activity:admin-1",
    );

    assert.equal(
      notificationIdentity({
        type: "admin_account_notification",
        notification_id: "account-1",
      }),
      "admin_account_notification:account-1",
    );

    assert.equal(
      notificationIdentity({
        type: "message",
        message_id: "message-1",
      }),
      "message:message-1",
    );
  },
);


test(
  "optimistic dismissal removes only the targeted notification",
  () => {
    const snapshot = {
      unread_count: 3,
      notifications: [
        {
          type: "admin_account_notification",
          notification_id: "one",
        },
        {
          type: "admin_account_notification",
          notification_id: "two",
        },
        {
          type: "message",
          message_id: "one",
        },
      ],
    };

    const next =
      removeNotificationFromSnapshot(
        snapshot,
        snapshot.notifications[0],
      );

    assert.equal(
      next.unread_count,
      2,
    );

    assert.deepEqual(
      next.notifications.map(
        notificationIdentity,
      ),
      [
        "admin_account_notification:two",
        "message:one",
      ],
    );
  },
);


test(
  "unknown dismissal does not reduce unread count",
  () => {
    const snapshot = {
      unread_count: 1,
      notifications: [
        {
          type: "message",
          message_id: "kept",
        },
      ],
    };

    const next =
      removeNotificationFromSnapshot(
        snapshot,
        {
          type: "message",
          message_id: "missing",
        },
      );

    assert.equal(
      next.unread_count,
      1,
    );

    assert.deepEqual(
      next.notifications,
      snapshot.notifications,
    );
  },
);


test(
  "empty notification snapshots are fresh objects",
  () => {
    const first =
      emptyNotificationSnapshot();

    const second =
      emptyNotificationSnapshot();

    assert.notEqual(
      first,
      second,
    );

    assert.notEqual(
      first.notifications,
      second.notifications,
    );

    assert.deepEqual(
      first,
      {
        unread_count: 0,
        notifications: [],
      },
    );
  },
);
