import assert from "node:assert/strict";
import test from "node:test";

import "fake-indexeddb/auto";

import {
  clearAllHyperSyncClientData,
} from "./clientDataReset.js";


function openDatabase(
  name,
) {
  return new Promise(
    (
      resolve,
      reject,
    ) => {
      const request =
        indexedDB.open(
          name,
          1,
        );

      request.onupgradeneeded =
        () => {
          request.result
            .createObjectStore(
              "items",
            );
        };

      request.onsuccess =
        () => {
          request.result.close();

          resolve();
        };

      request.onerror =
        () => {
          reject(
            request.error,
          );
        };
    },
  );
}


test(
  "full client reset clears persistent browser storage",
  async () => {
    await openDatabase(
      "hypersynced-media-v1",
    );

    await openDatabase(
      "hypersynced-offline-v1",
    );

    await openDatabase(
      "extra-hypersync-test-db",
    );


    const deletedCaches = [];

    const cachesLike = {
      async keys() {
        return [
          "hypersynced-media-v1",
          "hypersync-app-shell-v2",
        ];
      },

      async delete(
        key,
      ) {
        deletedCaches.push(
          key,
        );

        return true;
      },
    };


    let localClears = 0;
    let sessionClears = 0;

    const localStorageLike = {
      clear() {
        localClears += 1;
      },
    };

    const sessionStorageLike = {
      clear() {
        sessionClears += 1;
      },
    };


    const removedFiles = [];

    const directory = {
      async *entries() {
        yield [
          "offline-audio",
          {},
        ];

        yield [
          "cached-artwork",
          {},
        ];
      },

      async removeEntry(
        name,
        options,
      ) {
        assert.equal(
          options.recursive,
          true,
        );

        removedFiles.push(
          name,
        );
      },
    };


    let unregisterCount = 0;

    const navigatorLike = {
      storage: {
        async getDirectory() {
          return directory;
        },
      },

      serviceWorker: {
        controller:
          null,

        async getRegistrations() {
          return [
            {
              async unregister() {
                unregisterCount += 1;

                return true;
              },
            },
            {
              async unregister() {
                unregisterCount += 1;

                return true;
              },
            },
          ];
        },
      },
    };


    const documentLike = {
      cookie:
        "alpha=1; beta=2",
    };


    const result =
      await clearAllHyperSyncClientData({
        indexedDBLike:
          indexedDB,
        cachesLike,
        navigatorLike,
        localStorageLike,
        sessionStorageLike,
        documentLike,
      });


    const remainingDatabases =
      typeof indexedDB.databases ===
        "function"
        ? (
            await indexedDB.databases()
          )
            .map(
              (database) =>
                database.name,
            )
            .filter(Boolean)
        : [];


    assert.deepEqual(
      remainingDatabases,
      [],
    );

    assert.deepEqual(
      deletedCaches,
      [
        "hypersynced-media-v1",
        "hypersync-app-shell-v2",
      ],
    );

    assert.equal(
      localClears,
      1,
    );

    assert.equal(
      sessionClears,
      1,
    );

    assert.deepEqual(
      removedFiles,
      [
        "offline-audio",
        "cached-artwork",
      ],
    );

    assert.equal(
      unregisterCount,
      2,
    );

    assert.deepEqual(
      result.cacheNames,
      [
        "hypersynced-media-v1",
        "hypersync-app-shell-v2",
      ],
    );

    assert.equal(
      result.unregisteredWorkers,
      2,
    );
  },
);
