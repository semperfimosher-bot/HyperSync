import {
  clearAuthSession,
  getAccessToken,
  hasStoredSession,
  saveAuthSession,
  shouldRememberSession,
} from "./storage.js";

export const API_BASE =
  import.meta.env?.VITE_API_BASE_URL ??
  "/api";

let refreshInFlight = null;

let refreshBlockedUntil = 0;

let refreshBlockedError = null;

// Share identical concurrent GET requests instead of letting multiple components hit the API for the same resource at the same time.
const inFlightGetRequests = new Map();


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
      "/jams",
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


function isTransientOverloadStatus(
  status,
) {
  return (
    status === 429 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}


function retryDelayMilliseconds(
  response,
  attempt,
) {
  const retryAfter =
    retryAfterMilliseconds(
      response,
    );

  const exponential =
    Math.min(
      250 * 2 ** attempt,
      2000,
    );

  return Math.min(
    Math.max(
      retryAfter,
      exponential,
    ),
    5000,
  );
}


function sleep(
  milliseconds,
) {
  return new Promise(
    (resolve) => {
      setTimeout(
        resolve,
        milliseconds,
      );
    },
  );
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
      shouldRememberSession();

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

  const requestMethod =
    String(
      options.method ??
      "GET",
    ).toUpperCase();

  const canShareInFlightGet =
    requestMethod === "GET" &&
    !options.signal &&
    !options.body;

  let inFlightKey = null;

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

  if (canShareInFlightGet) {
    inFlightKey =
      `${API_BASE}${path}|${token ?? ""}`;

    const existing =
      inFlightGetRequests.get(
        inFlightKey,
      );

    if (existing) {
      return existing;
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

  let response = null;

    /*
     * A 429/502/503/504 can be transient (database admission,
     * upstream storage, or an external provider). Automatically
     * retry safe GET/HEAD/OPTIONS requests before surfacing an
     * error to the UI. This keeps brief recoverable blips invisible
     * without risking duplicate POST/PUT/PATCH/DELETE operations.
     */

  const canRetryTransient =
    requestMethod === "GET" ||
    requestMethod === "HEAD" ||
    requestMethod === "OPTIONS";

  const transientRetryLimit =
    canRetryTransient
      ? 3
      : 0;

  const requestPromise = (async () => {
    for (
    let attempt = 0;
    attempt <= transientRetryLimit;
    attempt += 1
  ) {
    response = await fetch(
      `${API_BASE}${path}`,
      {
        ...options,
        headers,
        credentials: "include",
      },
    );

    if (
      !isTransientOverloadStatus(
        response.status,
      ) ||
      attempt >= transientRetryLimit
    ) {
      break;
    }

    await sleep(
      retryDelayMilliseconds(
        response,
        attempt,
      ),
    );
  }

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
  })();

  if (inFlightKey) {
    inFlightGetRequests.set(
      inFlightKey,
      requestPromise,
    );

    try {
      return await requestPromise;
    } finally {
      if (
        inFlightGetRequests.get(
          inFlightKey,
        ) === requestPromise
      ) {
        inFlightGetRequests.delete(
          inFlightKey,
        );
      }
    }
  }

  return requestPromise;
}
