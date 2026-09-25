export function getHyperSyncServiceWorkerScope() {
  return import.meta.env?.DEV
    ? "/src/"
    : "/";
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
      ? "/src/serviceWorker.js"
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
