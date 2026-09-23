import {
  API_BASE,
} from "./api/client.js";


export const OFFLINE_ARTWORK_ROUTE_PREFIX =
  "/__hypersync/artwork/";


export function resolveArtworkUrl(
  src,
) {
  if (!src) {
    return null;
  }

  /*
   * Only tracks that were explicitly downloaded
   * receive this route. Normal online artwork keeps
   * using the exact same URL behavior as main, so a
   * first visit does not depend on service-worker
   * activation timing.
   */
  if (
    src.startsWith(
      OFFLINE_ARTWORK_ROUTE_PREFIX,
    ) ||
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
