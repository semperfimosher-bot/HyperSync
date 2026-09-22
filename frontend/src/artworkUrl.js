import {
  API_BASE,
} from "./api/client.js";


export const OFFLINE_ARTWORK_ROUTE_PREFIX =
  "/__hypersync/artwork/";


function localArtworkRouteFromSource(
  src,
) {
  try {
    let parsed;

    if (
      src.startsWith(
        "/api/",
      )
    ) {
      parsed =
        new URL(
          src,
          globalThis.location
            ?.origin ??
            "https://hypersynced.invalid",
        );
    } else if (
      src.startsWith(
        "http://",
      ) ||
      src.startsWith(
        "https://",
      )
    ) {
      parsed =
        new URL(
          src,
        );
    } else {
      return null;
    }

    const match =
      /\/api\/catalog\/tracks\/([^/]+)\/artwork$/.exec(
        parsed.pathname,
      );

    if (!match) {
      return null;
    }

    const trackId =
      decodeURIComponent(
        match[1],
      );

    const version =
      parsed.searchParams.get(
        "v",
      );

    return (
      OFFLINE_ARTWORK_ROUTE_PREFIX +
      encodeURIComponent(
        trackId,
      ) +
      (
        version
          ? (
              "?v=" +
              encodeURIComponent(
                version,
              )
            )
          : ""
      )
    );
  } catch {
    return null;
  }
}


export function resolveArtworkUrl(
  src,
) {
  if (!src) {
    return null;
  }

  if (
    src.startsWith(
      OFFLINE_ARTWORK_ROUTE_PREFIX,
    )
  ) {
    return src;
  }

  const localArtwork =
    localArtworkRouteFromSource(
      src,
    );

  if (localArtwork) {
    return localArtwork;
  }

  if (
    src.startsWith("blob:") ||
    src.startsWith("data:") ||
    src.startsWith("http://") ||
    src.startsWith("https://")
  ) {
    return src;
  }

  if (
    src.startsWith("/api/")
  ) {
    return (
      API_BASE.replace(
        /\/+$/,
        "",
      ) +
      src.slice(4)
    );
  }

  if (
    API_BASE.startsWith(
      "http",
    )
  ) {
    const apiOrigin =
      new URL(
        API_BASE,
      ).origin;

    return (
      apiOrigin +
      (
        src.startsWith("/")
          ? src
          : "/" + src
      )
    );
  }

  return src;
}
