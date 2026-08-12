import {
  apiRequest,
  refreshAccessToken,
} from "./client.js";

import { isAccessTokenExpired } from "./token.js";

import {
  cacheUserProfile,
  clearAuthSession,
  getAccessToken,
  hasStoredSession,
  readCachedUserProfile,
  saveAuthSession,
} from "./storage.js";

export {
  cacheUserProfile,
  clearAuthSession,
  hasStoredSession,
  readCachedUserProfile,
  saveAuthSession,
  shouldRestoreSession,
} from "./storage.js";

let restoreInFlight = null;

function rememberSession() {
  return (
    localStorage.getItem(
      "hypersync_remember_me",
    ) !== "false"
  );
}

function persistRestoredSession(
  user,
  accessToken = getAccessToken(),
) {
  const remember = rememberSession();

  if (accessToken) {
    saveAuthSession(
      accessToken,
      { remember },
    );
  }

  cacheUserProfile(
    user,
    { remember },
  );
}

async function restoreSessionInternal() {
  const token = getAccessToken();
  const remember = rememberSession();

  if (
    token &&
    !isAccessTokenExpired(token)
  ) {
    try {
      const user =
        await apiRequest("/users/me");

      persistRestoredSession(user);

      return user;
    } catch {
      // Fall through to refresh.
    }
  }

  try {
    const auth =
      await refreshAccessToken();

    if (auth.user) {
      cacheUserProfile(
        auth.user,
        { remember },
      );

      return auth.user;
    }

    const user = await apiRequest(
      "/users/me",
      {},
      auth.access_token,
    );

    persistRestoredSession(
      user,
      auth.access_token,
    );

    return user;
  } catch {
    if (
      hasStoredSession() ||
      token ||
      readCachedUserProfile()
    ) {
      clearAuthSession();
    }

    return null;
  }
}

export function restoreSession() {
  if (!restoreInFlight) {
    restoreInFlight =
      restoreSessionInternal().finally(() => {
        restoreInFlight = null;
      });
  }

  return restoreInFlight;
}

export function logoutSession() {
  const request = apiRequest(
    "/auth/logout",
    { method: "POST" },
  ).catch(() => {
    // Ignore network failures during logout.
  });

  clearAuthSession();

  return request;
}
