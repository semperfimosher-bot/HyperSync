export function getHyperSyncServiceWorkerScope() {
  return "/";
}

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

  const scriptUrl =
    import.meta.env?.DEV
      ? "/sw-dev.js"
      : "/sw.js";

  return navigatorLike
    .serviceWorker
    .register(
      scriptUrl,
      {
        scope:
          getHyperSyncServiceWorkerScope(),
        type:
          "module",
        updateViaCache:
          "none",
      },
    );
}
