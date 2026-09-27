export function getHomeRecentlyPlayed(
  profile,
  limit = 12,
) {
  const tracks =
    Array.isArray(
      profile?.recently_played,
    )
      ? profile.recently_played
      : [];

  return tracks.slice(
    0,
    limit,
  );
}


export const LISTENING_HISTORY_CHANGED_EVENT =
  "hypersynced:listening-history-changed";


export function notifyListeningHistoryChanged(
  target =
    globalThis.window,
) {
  if (
    !target?.dispatchEvent
  ) {
    return false;
  }

  target.dispatchEvent(
    new Event(
      LISTENING_HISTORY_CHANGED_EVENT,
    ),
  );

  return true;
}


export function subscribeListeningHistoryChanged(
  listener,
  target =
    globalThis.window,
) {
  if (
    !target?.addEventListener ||
    !target?.removeEventListener
  ) {
    return () => {};
  }

  target.addEventListener(
    LISTENING_HISTORY_CHANGED_EVENT,
    listener,
  );

  return () => {
    target.removeEventListener(
      LISTENING_HISTORY_CHANGED_EVENT,
      listener,
    );
  };
}
