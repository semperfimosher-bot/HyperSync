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


export async function clearDevelopmentServiceWorkerState(
  navigatorLike =
    globalThis.navigator,
  cachesLike =
    globalThis.caches,
) {
  const registrations =
    typeof navigatorLike
      ?.serviceWorker
      ?.getRegistrations ===
      "function"
      ? await navigatorLike
          .serviceWorker
          .getRegistrations()
      : [];

  await Promise.allSettled(
    registrations.map(
      (registration) =>
        registration
          ?.unregister?.(),
    ),
  );

  const cacheKeys =
    typeof cachesLike
      ?.keys ===
      "function"
      ? await cachesLike.keys()
      : [];

  const appShellKeys =
    cacheKeys.filter(
      (key) =>
        String(key).startsWith(
          "hypersync-app-shell-",
        ),
    );

  await Promise.allSettled(
    appShellKeys.map(
      (key) =>
        cachesLike.delete(
          key,
        ),
    ),
  );

  return {
    registrationsCleared:
      registrations.length,

    appShellCachesCleared:
      appShellKeys.length,
  };
}
