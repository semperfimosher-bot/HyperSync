import {
  apiRequest,
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
      claims?.role ??
      profile?.role ??
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

  const remember =
    rememberSession();


  if (
    token &&
    !isAccessTokenExpired(token)
  ) {
    try {
      const profile =
        await apiRequest(
          "/users/me",
        );

      const user =
        buildRestoredUser(
          profile,
          token,
        );

      persistRestoredSession(
        user,
        token,
      );

      return user;

    } catch {
      // Access token may have expired or
      // the session may need refreshing.
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

      cacheUserProfile(
        user,
        {
          remember,
        },
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
