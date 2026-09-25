import {
  clearAllMediaDatabases,
} from "./mediaStore.js";


function delay(
  milliseconds,
) {
  return new Promise(
    (resolve) => {
      setTimeout(
        resolve,
        milliseconds,
      );
    },
  );
}


async function askServiceWorkerToClear(
  navigatorLike,
) {
  const container =
    navigatorLike
      ?.serviceWorker;

  const controller =
    container?.controller;

  if (
    !container ||
    !controller
  ) {
    return false;
  }

  return new Promise(
    (resolve) => {
      let settled =
        false;

      const finish =
        (value) => {
          if (settled) {
            return;
          }

          settled = true;

          container.removeEventListener?.(
            "message",
            handleMessage,
          );

          resolve(
            value,
          );
        };

      const handleMessage =
        (event) => {
          if (
            event.data?.type ===
            "HYPERSYNC_CLEAR_ALL_CLIENT_DATA_COMPLETE"
          ) {
            finish(
              true,
            );
          }
        };

      container.addEventListener?.(
        "message",
        handleMessage,
      );

      try {
        controller.postMessage({
          type:
            "HYPERSYNC_CLEAR_ALL_CLIENT_DATA",
        });
      } catch {
        finish(
          false,
        );

        return;
      }

      setTimeout(
        () => {
          finish(
            false,
          );
        },
        1500,
      );
    },
  );
}


function deleteDatabase(
  indexedDBLike,
  name,
) {
  return new Promise(
    (resolve) => {
      if (
        !indexedDBLike ||
        !name
      ) {
        resolve(
          false,
        );

        return;
      }

      let settled =
        false;

      const finish =
        (value) => {
          if (settled) {
            return;
          }

          settled = true;

          resolve(
            value,
          );
        };

      let request;

      try {
        request =
          indexedDBLike
            .deleteDatabase(
              name,
            );
      } catch {
        finish(
          false,
        );

        return;
      }

      request.onsuccess =
        () => {
          finish(
            true,
          );
        };

      request.onerror =
        () => {
          finish(
            false,
          );
        };

      request.onblocked =
        () => {
          setTimeout(
            () => {
              finish(
                false,
              );
            },
            750,
          );
        };
    },
  );
}


async function clearAllOriginIndexedDB(
  indexedDBLike,
) {
  if (!indexedDBLike) {
    return [];
  }

  /*
   * First close/delete the DB handles
   * owned by HyperSync's media module.
   */
  await clearAllMediaDatabases()
    .catch(
      () => [],
    );

  const names =
    new Set([
      "hypersynced-media-v1",
      "hypersynced-offline-v1",
    ]);

  if (
    typeof indexedDBLike.databases ===
    "function"
  ) {
    try {
      const databases =
        await indexedDBLike.databases();

      for (const database of databases) {
        if (database?.name) {
          names.add(
            database.name,
          );
        }
      }
    } catch {
      // Known HyperSync DB names remain.
    }
  }

  const deleted = [];

  for (const name of names) {
    const didDelete =
      await deleteDatabase(
        indexedDBLike,
        name,
      );

    if (didDelete) {
      deleted.push(
        name,
      );
    }
  }

  return deleted;
}


async function clearAllCacheStorage(
  cachesLike,
) {
  if (
    !cachesLike?.keys
  ) {
    return [];
  }

  let keys = [];

  try {
    keys =
      await cachesLike.keys();
  } catch {
    return [];
  }

  await Promise.allSettled(
    keys.map(
      (key) =>
        cachesLike.delete(
          key,
        ),
    ),
  );

  return keys;
}


function clearWebStorage(
  localStorageLike,
  sessionStorageLike,
) {
  try {
    localStorageLike?.clear?.();
  } catch {
    // Ignore unavailable storage.
  }

  try {
    sessionStorageLike?.clear?.();
  } catch {
    // Ignore unavailable storage.
  }
}


function clearAccessibleCookies(
  documentLike,
) {
  if (
    !documentLike ||
    typeof documentLike.cookie !==
      "string"
  ) {
    return;
  }

  const cookies =
    documentLike.cookie
      .split(";")
      .map(
        (entry) =>
          entry
            .split("=")[0]
            ?.trim(),
      )
      .filter(Boolean);

  for (const name of cookies) {
    documentLike.cookie =
      `${name}=; Max-Age=0; path=/; SameSite=Lax`;
  }
}


async function clearOriginPrivateFileSystem(
  navigatorLike,
) {
  const getDirectory =
    navigatorLike
      ?.storage
      ?.getDirectory;

  if (
    typeof getDirectory !==
    "function"
  ) {
    return [];
  }

  try {
    const root =
      await getDirectory.call(
        navigatorLike.storage,
      );

    const removed = [];

    for await (
      const [
        name,
      ]
      of root.entries()
    ) {
      await root.removeEntry(
        name,
        {
          recursive:
            true,
        },
      );

      removed.push(
        name,
      );
    }

    return removed;
  } catch {
    return [];
  }
}


async function unregisterServiceWorkers(
  navigatorLike,
) {
  const container =
    navigatorLike
      ?.serviceWorker;

  if (
    !container
      ?.getRegistrations
  ) {
    return 0;
  }

  try {
    const registrations =
      await container
        .getRegistrations();

    const results =
      await Promise.allSettled(
        registrations.map(
          (registration) =>
            registration.unregister(),
        ),
      );

    return results.filter(
      (result) =>
        result.status ===
        "fulfilled" &&
        result.value ===
          true,
    ).length;
  } catch {
    return 0;
  }
}


export async function clearAllHyperSyncClientData({
  indexedDBLike =
    globalThis.indexedDB,
  cachesLike =
    globalThis.caches,
  navigatorLike =
    globalThis.navigator,
  localStorageLike =
    globalThis.localStorage,
  sessionStorageLike =
    globalThis.sessionStorage,
  documentLike =
    globalThis.document,
} = {}) {
  /*
   * Ask the active worker to close its
   * own IndexedDB connections before the
   * page attempts deletion.
   */
  await askServiceWorkerToClear(
    navigatorLike,
  );

  await delay(
    25,
  );

  const [
    indexedDatabases,
    cacheNames,
    privateFiles,
  ] =
    await Promise.all([
      clearAllOriginIndexedDB(
        indexedDBLike,
      ),
      clearAllCacheStorage(
        cachesLike,
      ),
      clearOriginPrivateFileSystem(
        navigatorLike,
      ),
    ]);

  clearWebStorage(
    localStorageLike,
    sessionStorageLike,
  );

  clearAccessibleCookies(
    documentLike,
  );

  const unregisteredWorkers =
    await unregisterServiceWorkers(
      navigatorLike,
    );

  return {
    indexedDatabases,
    cacheNames,
    privateFiles,
    unregisteredWorkers,
  };
}
