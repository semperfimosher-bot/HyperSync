import assert from "node:assert/strict";
import test from "node:test";

async function loadRegistrationModule() {
  return import(
    `./serviceWorkerRegistration.js?test=${Date.now()}-${Math.random()}`
  );
}

test(
  "HyperSync registers the root module service worker",
  async () => {
    const registrationModule =
      await loadRegistrationModule();

    assert.equal(
      typeof registrationModule.registerHyperSyncServiceWorker,
      "function",
    );

    let registeredUrl =
      null;

    let registeredOptions =
      null;

    const expectedRegistration = {
      scope:
        "https://example.test/",
    };

    const navigatorLike = {
      serviceWorker: {
        async register(
          url,
          options,
        ) {
          registeredUrl =
            url;

          registeredOptions =
            options;

          return expectedRegistration;
        },
      },
    };

    const registration =
      await registrationModule.registerHyperSyncServiceWorker(
        navigatorLike,
      );

    assert.equal(
      registration,
      expectedRegistration,
    );

    assert.equal(
      registeredUrl,
      "/sw.js",
    );

    assert.deepEqual(
      registeredOptions,
      {
        scope:
          "/",
        type:
          "module",
        updateViaCache:
          "none",
      },
    );
  },
);


test(
  "development cleanup removes stale workers and app-shell caches only",
  async () => {
    const registrationModule =
      await loadRegistrationModule();

    let unregisterCount =
      0;

    const deletedCaches =
      [];

    const navigatorLike = {
      serviceWorker: {
        async getRegistrations() {
          return [
            {
              async unregister() {
                unregisterCount +=
                  1;

                return true;
              },
            },
            {
              async unregister() {
                unregisterCount +=
                  1;

                return true;
              },
            },
          ];
        },
      },
    };

    const cachesLike = {
      async keys() {
        return [
          "hypersync-app-shell-v2",
          "hypersync-app-shell-v3",
          "unrelated-cache",
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

    const result =
      await registrationModule
        .clearDevelopmentServiceWorkerState(
          navigatorLike,
          cachesLike,
        );

    assert.equal(
      unregisterCount,
      2,
    );

    assert.deepEqual(
      deletedCaches.sort(),
      [
        "hypersync-app-shell-v2",
        "hypersync-app-shell-v3",
      ],
    );

    assert.deepEqual(
      result,
      {
        registrationsCleared:
          2,
        appShellCachesCleared:
          2,
      },
    );
  },
);
