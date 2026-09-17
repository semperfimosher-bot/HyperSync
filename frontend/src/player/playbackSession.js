let nextSessionId = 0;

let activeSession = null;


export function beginPlaybackSession(
  trackId = null,
) {
  if (activeSession) {
    activeSession.controller.abort();
  }

  const controller =
    new AbortController();

  const session = {
    id:
      ++nextSessionId,

    trackId:
      trackId === null ||
      trackId === undefined
        ? null
        : String(trackId),

    controller,

    signal:
      controller.signal,
  };

  activeSession =
    session;

  return session;
}


export function isPlaybackSessionCurrent(
  session,
) {
  return Boolean(
    session &&
    activeSession &&
    session.id ===
      activeSession.id &&
    !session.signal.aborted,
  );
}


export function cancelActivePlaybackSession() {
  if (!activeSession) {
    return false;
  }

  activeSession.controller.abort();

  activeSession =
    null;

  return true;
}


export function getActivePlaybackSession() {
  return activeSession;
}


export function _resetPlaybackSessionsForTests() {
  if (activeSession) {
    activeSession.controller.abort();
  }

  activeSession =
    null;

  nextSessionId =
    0;
}
