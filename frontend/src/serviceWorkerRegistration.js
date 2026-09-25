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
          "/",
        type:
          "module",
        updateViaCache:
          "none",
      },
    );
}
