import assert from "node:assert/strict";
import test from "node:test";

import {
  emptyNotificationSnapshot,
} from "./messageNotifications.js";

import {
  getOwnedNotificationSnapshot,
  getOwnedValue,
  updateOwnedNotificationSnapshot,
} from "./ownedNotificationState.js";


test("hides account A notifications synchronously when account B becomes active", () => {
  const state = {
    ownerId: "account-a",
    snapshot: {
      unread_count: 2,
      notifications: [{ type: "message", message_id: "private-a" }],
    },
  };

  assert.deepEqual(
    getOwnedNotificationSnapshot(state, "account-b"),
    emptyNotificationSnapshot(),
  );
  assert.deepEqual(
    getOwnedNotificationSnapshot(state, null),
    emptyNotificationSnapshot(),
  );
  assert.deepEqual(
    getOwnedNotificationSnapshot(state, "account-a"),
    state.snapshot,
  );
});


test("prevents a stale notification callback from mutating another account snapshot", () => {
  const state = {
    ownerId: "account-b",
    snapshot: {
      unread_count: 1,
      notifications: [{ type: "message", message_id: "private-b" }],
    },
  };

  const result = updateOwnedNotificationSnapshot(
    state,
    "account-a",
    () => ({ unread_count: 0, notifications: [] }),
  );

  assert.strictEqual(result, state);
  assert.deepEqual(
    getOwnedNotificationSnapshot(result, "account-b"),
    state.snapshot,
  );
});


test("allows optimistic notification updates for the matching owner", () => {
  const state = {
    ownerId: "account-a",
    snapshot: {
      unread_count: 1,
      notifications: [{ type: "message", message_id: "private-a" }],
    },
  };

  const result = updateOwnedNotificationSnapshot(
    state,
    "account-a",
    (snapshot) => ({
      unread_count: snapshot.unread_count - 1,
      notifications: [],
    }),
  );

  assert.equal(result.ownerId, "account-a");
  assert.equal(result.snapshot.unread_count, 0);
  assert.deepEqual(result.snapshot.notifications, []);
});


test("hides account-owned notification details after an account switch", () => {
  const detail = {
    ownerId: "account-a",
    value: { type: "message", message_id: "private-a" },
  };

  assert.equal(getOwnedValue(detail, "account-b"), null);
  assert.equal(getOwnedValue(detail, null), null);
  assert.equal(getOwnedValue(detail, "account-a"), detail.value);
});
