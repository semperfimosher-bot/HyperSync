import { API_BASE } from "./api/client.js";


const MEDIA_CACHE_NAME =
  "hypersynced-media-v1";


const pendingRequests =
  new Map();


function canUseCache() {
  return (
    typeof window !== "undefined" &&
    "caches" in window
  );
}


function getApiBase() {
  return API_BASE.replace(/\/$/, "");
}


export function resolveMediaUrl(url) {
  if (!url) {
    return null;
  }

  if (
    url.startsWith("http://") ||
    url.startsWith("https://")
  ) {
    return url;
  }

  const base = getApiBase();

  const path =
    url.startsWith("/api/")
      ? url.slice(4)
      : url;

  return `${base}${
    path.startsWith("/")
      ? path
      : `/${path}`
  }`;
}


async function openMediaCache() {
  if (!canUseCache()) {
    return null;
  }

  return caches.open(
    MEDIA_CACHE_NAME,
  );
}


export async function getCachedResponse(
  url,
) {
  const mediaUrl =
    resolveMediaUrl(url);

  if (!mediaUrl) {
    return null;
  }

  const cache =
    await openMediaCache();

  if (!cache) {
    return null;
  }

  const response =
    await cache.match(mediaUrl);

  return response ?? null;
}


export async function getCachedObjectUrl(
  url,
) {
  const response =
    await getCachedResponse(url);

  if (!response) {
    return null;
  }

  const blob =
    await response.blob();

  return URL.createObjectURL(
    blob,
  );
}


export async function warmMedia(
  url,
) {
  const mediaUrl =
    resolveMediaUrl(url);

  if (!mediaUrl) {
    return false;
  }

  if (!canUseCache()) {
    return false;
  }

  const existing =
    pendingRequests.get(
      mediaUrl,
    );

  if (existing) {
    return existing;
  }

  const request =
    (async () => {
      const cache =
        await openMediaCache();

      if (!cache) {
        return false;
      }

      const cached =
        await cache.match(
          mediaUrl,
        );

      if (cached) {
        return true;
      }

      const response =
        await fetch(
          mediaUrl,
          {
            method: "GET",

            credentials: "include",

            cache: "force-cache",
          },
        );

      if (!response.ok) {
        return false;
      }

      await cache.put(
        mediaUrl,
        response.clone(),
      );

      return true;
    })();

  pendingRequests.set(
    mediaUrl,
    request,
  );

  try {
    return await request;
  } finally {
    pendingRequests.delete(
      mediaUrl,
    );
  }
}


export async function clearCachedTrack(
  trackId,
) {
  if (!trackId) {
    return;
  }

  const cache =
    await openMediaCache();

  if (!cache) {
    return;
  }

  const id =
    String(trackId);

  const audioUrl =
    `${getApiBase()}/audio/${id}`;

  const artworkUrl =
    `${getApiBase()}/catalog/tracks/${id}/artwork`;

  await Promise.all([
    cache.delete(audioUrl),
    cache.delete(artworkUrl),
  ]);
}
