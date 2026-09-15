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
