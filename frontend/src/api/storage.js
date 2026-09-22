export const ACCESS_TOKEN_KEY =
  "hypersync_access_token";

export const SESSION_ACTIVE_KEY =
  "hypersync_session_active";

export const REMEMBER_ME_KEY =
  "hypersync_remember_me";

export const CACHED_USER_KEY =
  "hypersync_user_profile";

const STORAGES = [
  localStorage,
  sessionStorage,
];

let accessTokenMemory =
  null;

export function getActiveStorage() {
  for (const storage of STORAGES) {
    if (
      storage.getItem(SESSION_ACTIVE_KEY) ===
      "true"
    ) {
      return storage;
    }
  }

  return null;
}

export function getAccessToken() {
  /*
   * Access JWTs live only in JavaScript memory.
   * A page reload restores authentication through
   * the HttpOnly refresh cookie instead of exposing
   * bearer credentials through Web Storage.
   */
  return accessTokenMemory;
}

export function hasStoredSession() {
  return STORAGES.some(
    (storage) =>
      storage.getItem(SESSION_ACTIVE_KEY) ===
      "true",
  );
}

export function readCachedUserProfile() {
  try {
    const raw =
      localStorage.getItem(CACHED_USER_KEY) ||
      sessionStorage.getItem(CACHED_USER_KEY);

    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function cacheUserProfile(
  user,
  {
    remember =
      localStorage.getItem(
        REMEMBER_ME_KEY,
      ) !== "false",
  } = {},
) {
  if (!user) {
    return;
  }

  const primary = remember
    ? localStorage
    : sessionStorage;

  const secondary = remember
    ? sessionStorage
    : localStorage;

  const serialized =
    JSON.stringify(user);

  primary.setItem(
    CACHED_USER_KEY,
    serialized,
  );

  secondary.removeItem(CACHED_USER_KEY);
}

export function clearCachedUserProfile() {
  sessionStorage.removeItem(CACHED_USER_KEY);
  localStorage.removeItem(CACHED_USER_KEY);
}

export function shouldRestoreSession() {
  return (
    hasStoredSession() ||
    Boolean(getAccessToken()) ||
    Boolean(readCachedUserProfile())
  );
}

export function saveAuthSession(
  accessToken,
  { remember = true } = {},
) {
  accessTokenMemory =
    accessToken || null;

  sessionStorage.setItem(
    SESSION_ACTIVE_KEY,
    "true",
  );

  localStorage.setItem(
    REMEMBER_ME_KEY,
    remember ? "true" : "false",
  );

  if (remember) {
    localStorage.setItem(
      SESSION_ACTIVE_KEY,
      "true",
    );
  } else {
    localStorage.removeItem(
      SESSION_ACTIVE_KEY,
    );
  }

  // Remove legacy Web Storage access tokens.
  localStorage.removeItem(
    ACCESS_TOKEN_KEY,
  );

  sessionStorage.removeItem(
    ACCESS_TOKEN_KEY,
  );
}

export function clearAuthSession() {
  accessTokenMemory =
    null;

  for (const storage of STORAGES) {
    storage.removeItem(ACCESS_TOKEN_KEY);
    storage.removeItem(SESSION_ACTIVE_KEY);
  }

  localStorage.removeItem(REMEMBER_ME_KEY);
  clearCachedUserProfile();
}
