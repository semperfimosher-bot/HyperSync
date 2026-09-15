export async function registerHyperSyncServiceWorker(
  navigatorLike =
    globalThis.navigator,
) {
  if (
    !navigatorLike
      ?.serviceWorker
      ?.register
  ) {
    return null;
  }

  return navigatorLike
    .serviceWorker
    .register(
      "/sw.js",
      {
        scope:
          "/",
        type:
          "module",
        updateViaCache:
          "none",
      },
    );
}
