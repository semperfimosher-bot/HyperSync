import {
  emptyNotificationSnapshot,
} from "./messageNotifications.js";


function normalizeOwner(owner) {
  return owner == null ? null : String(owner);
}


/** Return account-owned notification data only for the currently active account. */
export function getOwnedNotificationSnapshot(state, activeOwner) {
  const ownerId = normalizeOwner(activeOwner);

  if (ownerId === null || state?.ownerId !== ownerId) {
    return emptyNotificationSnapshot();
  }

  return state.snapshot ?? emptyNotificationSnapshot();
}


/** Read an account-owned detail value only for the currently active account. */
export function getOwnedValue(state, activeOwner) {
  const ownerId = normalizeOwner(activeOwner);

  if (ownerId === null || state?.ownerId !== ownerId) {
    return null;
  }

  return state.value ?? null;
}


/** Ignore queued optimistic changes from a stale account callback. */
export function updateOwnedNotificationSnapshot(state, owner, update) {
  const ownerId = normalizeOwner(owner);

  if (ownerId === null || state?.ownerId !== ownerId) {
    return state;
  }

  return {
    ...state,
    snapshot: update(
      state.snapshot ?? emptyNotificationSnapshot(),
    ),
  };
}
