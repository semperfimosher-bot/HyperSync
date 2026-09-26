import {
  clearAuthSession,
  getAccessToken,
  hasStoredSession,
  saveAuthSession,
} from "./storage.js";

export const API_BASE =
  import.meta.env?.VITE_API_BASE_URL ??
  (import.meta.env?.DEV
    ? "/api"
    : "https://api.hypersynced.app/api");

let refreshInFlight = null;

let refreshBlockedUntil = 0;

let refreshBlockedError = null;


function isAuthEndpoint(
  path,
) {
  return (
    path === "/auth/login" ||
    path === "/auth/register" ||
    path === "/auth/refresh" ||
    path.startsWith(
      "/auth/password-recovery/",
    )
  );
}


function pathRequiresAuthentication(
  path,
  method = "GET",
) {
  const normalizedMethod =
    String(
      method ??
      "GET",
    ).toUpperCase();

  if (
    path.startsWith(
      "/users/me",
    ) ||
    path.startsWith(
      "/messages",
    ) ||
    path.startsWith(
      "/admin",
    ) ||
    path.startsWith(
      "/library",
    ) ||
    path ===
      "/search/preferences" ||
    path.startsWith(
      "/playlists/mine",
    ) ||
    path.startsWith(
      "/playlists/saved",
    ) ||
    path.startsWith(
      "/playlists/liked",
    )
  ) {
    return true;
  }

  if (
    path.startsWith(
      "/playlists/",
    ) &&
    normalizedMethod !==
      "GET"
  ) {
    return true;
  }

  return false;
}


function retryAfterMilliseconds(
  response,
) {
  const raw =
    response?.headers
      ?.get?.(
        "Retry-After",
      );

  const seconds =
    Number.parseInt(
      String(
        raw ?? "",
      ),
      10,
    );

  if (
    Number.isFinite(
      seconds,
    ) &&
    seconds > 0
  ) {
    return Math.min(
      seconds * 1000,
      5 * 60 * 1000,
    );
  }

  return 30_000;
}


function rememberRefreshFailure(
  error,
  response,
) {
  const status =
    Number(
      error?.status ??
      0,
    );

  const blockMs =
    status === 429
      ? retryAfterMilliseconds(
          response,
        )
      : (
          status === 401 ||
          status === 403
            ? 60_000
            : 5_000
        );

  refreshBlockedUntil =
    Date.now() +
    blockMs;

  refreshBlockedError =
    error;
}


function clearRefreshFailure() {
  refreshBlockedUntil =
    0;

  refreshBlockedError =
    null;
}


function refreshCooldownError() {
  if (
    Date.now() >=
    refreshBlockedUntil
  ) {
    clearRefreshFailure();

    return null;
  }

  const source =
    refreshBlockedError;

  const error =
    new Error(
      source?.message ??
      "Authentication refresh is temporarily paused.",
    );

  error.status =
    source?.status ??
    429;

  error.detail =
    source?.detail;

  error.retryAfterMs =
    Math.max(
      refreshBlockedUntil -
        Date.now(),
      0,
    );

  return error;
}


export function formatApiError(detail) {
  if (!detail) {
    return "HyperSynced request failed.";
  }

  if (typeof detail === "string") {
    return detail;
  }

  if (Array.isArray(detail)) {
    return detail
      .map((item) => item.msg ?? String(item))
      .join(" ");
  }

  return String(detail);
}


export function isAuthRefreshCoolingDown() {
  return Boolean(
    refreshCooldownError(),
  );
}


export async function refreshAccessToken() {
  if (refreshInFlight) {
    return refreshInFlight;
  }

  const blockedError =
    refreshCooldownError();

  if (blockedError) {
    throw blockedError;
  }

  refreshInFlight = (async () => {
    const response = await fetch(
      `${API_BASE}/auth/refresh`,
      {
        method: "POST",
        credentials: "include",
      },
    );

    if (!response.ok) {
      const errorData =
        await response.json()
          .catch(
            () => null,
          );

      const error =
        new Error(
          formatApiError(
            errorData?.detail ??
              "Authentication refresh failed.",
          ),
        );

      error.status =
        response.status;

      error.detail =
        errorData?.detail;

      if (
        response.status ===
          401 ||
        response.status ===
          403
      ) {
        /*
         * The server has definitively rejected
         * the refresh session. Remove the stale
         * remembered browser session so future
         * reloads do not repeat this failed
         * refresh forever.
         *
         * Temporary failures (429, 5xx, network)
         * continue to preserve the remembered
         * session.
         */
        clearAuthSession();
      }

      rememberRefreshFailure(
        error,
        response,
      );

      throw error;
    }

    const data =
      await response.json();

    const remember =
      localStorage.getItem(
        "hypersync_remember_me",
      ) !== "false";

    saveAuthSession(
      data.access_token,
      { remember },
    );

    clearRefreshFailure();

    return data;
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}


export async function apiRequest(
  path,
  options = {},
  accessToken = null,
) {
  let token =
    accessToken ?? getAccessToken();

  const authEndpoint =
    isAuthEndpoint(
      path,
    );

  const requiresAuthentication =
    pathRequiresAuthentication(
      path,
      options.method,
    );

  /*
   * After a reload access tokens are memory-only.
   * Restore one before sending protected requests
   * instead of first generating a wave of 401s.
   */
  if (
    !token &&
    !authEndpoint &&
    requiresAuthentication
  ) {
    if (
      hasStoredSession()
    ) {
      const auth =
        await refreshAccessToken();

      token =
        auth.access_token;
    } else {
      const error =
        new Error(
          "Authentication required.",
        );

      error.status =
        401;

      error.detail =
        "Authentication required.";

      throw error;
    }
  }

  const isFormData =
    options.body instanceof FormData;

  const headers = {
    ...(isFormData
      ? {}
      : {
          "Content-Type":
            "application/json",
        }),
    ...(options.headers ?? {}),
  };

  if (token) {
    headers.Authorization =
      `Bearer ${token}`;
  }

  let response = await fetch(
    `${API_BASE}${path}`,
    {
      ...options,
      headers,
      credentials: "include",
    },
  );

  if (
    response.status === 401 &&
    !authEndpoint
  ) {
    try {
      const auth =
        await refreshAccessToken();

      const retryHeaders = {
        ...(isFormData
          ? {}
          : {
              "Content-Type":
                "application/json",
            }),
        ...(options.headers ?? {}),
        Authorization:
          `Bearer ${auth.access_token}`,
      };

      response = await fetch(
        `${API_BASE}${path}`,
        {
          ...options,
          headers: retryHeaders,
          credentials: "include",
        },
      );
    } catch (refreshError) {
      /*
       * Preserve remembered session data, but
       * surface the refresh failure so callers
       * stop retrying during its cooldown.
       */
      throw refreshError;
    }
  }

  const data =
    await response.json()
      .catch(() => null);

  if (!response.ok) {
    const error = new Error(
      formatApiError(
        data?.detail,
      ),
    );

    error.status =
      response.status;

    error.detail =
      data?.detail;

    throw error;
  }

  if (
    path === "/auth/login" ||
    path === "/auth/register" ||
    path ===
      "/auth/password-recovery/verify-otp"
  ) {
    clearRefreshFailure();
  }

  return data;
}
