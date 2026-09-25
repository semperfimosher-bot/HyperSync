import {
  getAccessToken,
  saveAuthSession,
} from "./storage.js";

export const API_BASE =
  import.meta.env?.VITE_API_BASE_URL ??
  (import.meta.env?.DEV
    ? "/api"
    : "https://api.hypersynced.app/api");

let refreshInFlight = null;

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

export async function refreshAccessToken() {
  if (refreshInFlight) {
    return refreshInFlight;
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
  const token =
    accessToken ?? getAccessToken();

  // Don't set Content-Type for FormData (file uploads) - let browser set multipart/form-data
  const isFormData = options.body instanceof FormData;
  const headers = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
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

  const isAuthEndpoint =
    path === "/auth/login" ||
    path === "/auth/register" ||
    path === "/auth/refresh";

  if (
    response.status === 401 &&
    !isAuthEndpoint
  ) {
    try {
      const auth =
        await refreshAccessToken();

      const retryHeaders = {
        ...(isFormData ? {} : { "Content-Type": "application/json" }),
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
    } catch {
      /*
       * Do not erase the browser's stored
       * session because one refresh attempt
       * failed. A later request can retry.
       */
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

  return data;
}
