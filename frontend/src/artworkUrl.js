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

  if (
    src.startsWith(
      OFFLINE_ARTWORK_ROUTE_PREFIX,
    )
  ) {
    return src;
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
