import {
  apiRequest,
  AuthSessionExpiredError,
  refreshAccessToken,
} from "./client.js";

import {
  isAccessTokenExpired,
} from "./token.js";

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


function decodeAccessTokenPayload(
  token,
) {
  if (!token) {
    return null;
  }

  try {
    const segment =
      token.split(".")[1];

    if (!segment) {
      return null;
    }

    const normalized =
      segment
        .replace(/-/g, "+")
        .replace(/_/g, "/");

    const padded =
      normalized.padEnd(
        Math.ceil(
          normalized.length / 4,
        ) * 4,
        "=",
      );

    return JSON.parse(
      atob(padded),
    );

  } catch {
    return null;
  }
}


function buildRestoredUser(
  profile,
  accessToken,
) {
  const cached =
    readCachedUserProfile();

  const claims =
    decodeAccessTokenPayload(
      accessToken,
    );

  return {
    ...(cached || {}),
    ...(profile || {}),

  role:
    profile?.role ??
    claims?.role ??
    "user",

    username:
      profile?.username ??
      cached?.username ??
      "",

    display_name:
      profile?.display_name ??
      cached?.display_name ??
      profile?.username ??
      cached?.username ??
      "",
  };
}


function persistRestoredSession(
  user,
  accessToken = getAccessToken(),
) {
  const remember =
    rememberSession();

  if (accessToken) {
    saveAuthSession(
      accessToken,
      {
        remember,
      },
    );
  }

  cacheUserProfile(
    user,
    {
      remember,
    },
  );
}


async function restoreSessionInternal() {
  const token =
    getAccessToken();

  const cachedProfile =
    readCachedUserProfile();

  const isOffline =
    typeof navigator !==
      "undefined" &&
    navigator.onLine ===
      false;

  /*
   * Cold offline start: trust only the cached UI profile.
   * Server-side authorization remains authoritative once
   * connectivity returns.
   */
  if (
    isOffline &&
    cachedProfile
  ) {
    return buildRestoredUser(
      cachedProfile,
      token,
    );
  }

  if (
    token &&
    !isAccessTokenExpired(
      token,
    )
  ) {
    try {
      const profile =
        await apiRequest(
          "/users/me",
        );

      const activeToken =
        getAccessToken() ??
        token;

      const user =
        buildRestoredUser(
          profile,
          activeToken,
        );

      persistRestoredSession(
        user,
        activeToken,
      );

      return user;
    } catch (error) {
      if (
        error instanceof
          AuthSessionExpiredError
      ) {
        return null;
      }

      /*
       * A valid cached profile is better than logging a
       * user out because DNS/Wi-Fi/API connectivity is
       * temporarily broken.
       */
      if (cachedProfile) {
        return buildRestoredUser(
          cachedProfile,
          token,
        );
      }
    }
  }

  try {
    const auth =
      await refreshAccessToken();

    if (auth.user) {
      const user =
        buildRestoredUser(
          auth.user,
          auth.access_token,
        );

      persistRestoredSession(
        user,
        auth.access_token,
      );

      return user;
    }

    const profile =
      await apiRequest(
        "/users/me",
        {},
        auth.access_token,
      );

    const user =
      buildRestoredUser(
        profile,
        auth.access_token,
      );

    persistRestoredSession(
      user,
      auth.access_token,
    );

    return user;
  } catch (error) {
    if (
      error instanceof
        AuthSessionExpiredError
    ) {
      clearAuthSession();
      return null;
    }

    if (cachedProfile) {
      return buildRestoredUser(
        cachedProfile,
        token,
      );
    }

    return null;
  }
}

export function restoreSession() {
  if (!restoreInFlight) {
    restoreInFlight =
      restoreSessionInternal()
        .finally(() => {
          restoreInFlight =
            null;
        });
  }

  return restoreInFlight;
}


export function logoutSession() {
  const request =
    apiRequest(
      "/auth/logout",
      {
        method: "POST",
      },
    ).catch(() => {
      // Ignore network failures
      // during logout.
    });

  clearAuthSession();

  return request;
}
