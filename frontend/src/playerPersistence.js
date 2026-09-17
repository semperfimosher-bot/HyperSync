const PLAYER_STATE_KEY =
  "hypersync_player_state_v1";


function getStorage() {
  if (
    typeof window ===
    "undefined"
  ) {
    return null;
  }

  return window.localStorage;
}


export function readPersistedPlayerState() {
  const storage =
    getStorage();

  if (!storage) {
    return null;
  }

  try {
    const raw =
      storage.getItem(
        PLAYER_STATE_KEY,
      );

    if (!raw) {
      return null;
    }

    const parsed =
      JSON.parse(raw);

    if (
      !parsed ||
      typeof parsed !==
        "object" ||
      !parsed.trackId
    ) {
      return null;
    }

    return parsed;

  } catch {
    return null;
  }
}


export function writePersistedPlayerState(
  state,
) {
  const storage =
    getStorage();

  if (
    !storage ||
    !state?.trackId
  ) {
    return;
  }

  try {
    storage.setItem(
      PLAYER_STATE_KEY,
      JSON.stringify({
        ...state,

        version:
          1,

        savedAt:
          Date.now(),
      }),
    );

  } catch {
    /*
     * Persistence should never be able
     * to interrupt normal playback.
     */
  }
}


export function clearPersistedPlayerState() {
  const storage =
    getStorage();

  if (!storage) {
    return;
  }

  try {
    storage.removeItem(
      PLAYER_STATE_KEY,
    );
  } catch {
    // Ignore storage failures.
  }
}
