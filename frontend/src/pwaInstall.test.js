import assert from "node:assert/strict";
import test from "node:test";


function replaceGlobal(
  name,
  value,
) {
  const descriptor =
    Object.getOwnPropertyDescriptor(
      globalThis,
      name,
    );

  Object.defineProperty(
    globalThis,
    name,
    {
      configurable:
        true,
      writable:
        true,
      value,
    },
  );

  return () => {
    if (descriptor) {
      Object.defineProperty(
        globalThis,
        name,
        descriptor,
      );
    } else {
      delete globalThis[
        name
      ];
    }
  };
}


async function loadInstallModule() {
  return import(
    `./pwaInstall.js?test=${Date.now()}-${Math.random()}`
  );
}


test(
  "captures and runs the native install prompt",
  async () => {
    const windowListeners =
      new Map();

    const restoreWindow =
      replaceGlobal(
        "window",
        {
          location: {
            hostname:
              "example.test",
          },

          addEventListener(
            type,
            listener,
          ) {
            windowListeners.set(
              type,
              listener,
            );
          },

          matchMedia() {
            return {
              matches:
                false,

              addEventListener() {},
            };
          },
        },
      );

    const restoreNavigator =
      replaceGlobal(
        "navigator",
        {
          serviceWorker:
            {},

          storage: {
            async persist() {
              return true;
            },
          },

          userAgent:
            "Mozilla/5.0",

          platform:
            "Win32",

          maxTouchPoints:
            0,
        },
      );

    const restoreSecure =
      replaceGlobal(
        "isSecureContext",
        true,
      );

    try {
      const module =
        await loadInstallModule();

      module
        .initializePwaInstall();

      const beforeInstall =
        windowListeners.get(
          "beforeinstallprompt",
        );

      assert.equal(
        typeof beforeInstall,
        "function",
      );

      let prevented =
        false;

      let prompted =
        false;

      beforeInstall({
        preventDefault() {
          prevented =
            true;
        },

        async prompt() {
          prompted =
            true;
        },

        userChoice:
          Promise.resolve({
            outcome:
              "accepted",
          }),
      });

      assert.equal(
        prevented,
        true,
      );

      assert.equal(
        module
          .getPwaInstallState()
          .canPrompt,
        true,
      );

      const result =
        await module
          .requestPwaInstall();

      assert.equal(
        prompted,
        true,
      );

      assert.equal(
        result.status,
        "accepted",
      );
    } finally {
      restoreSecure();
      restoreNavigator();
      restoreWindow();
    }
  },
);


test(
  "detects an installed standalone app",
  async () => {
    const restoreWindow =
      replaceGlobal(
        "window",
        {
          location: {
            hostname:
              "example.test",
          },

          addEventListener() {},

          matchMedia(
            query,
          ) {
            return {
              matches:
                query ===
                "(display-mode: standalone)",

              addEventListener() {},
            };
          },
        },
      );

    const restoreNavigator =
      replaceGlobal(
        "navigator",
        {
          serviceWorker:
            {},

          userAgent:
            "Mozilla/5.0",

          platform:
            "Win32",

          maxTouchPoints:
            0,
        },
      );

    const restoreSecure =
      replaceGlobal(
        "isSecureContext",
        true,
      );

    try {
      const module =
        await loadInstallModule();

      const state =
        module
          .getPwaInstallState();

      assert.equal(
        state.installed,
        true,
      );

      const result =
        await module
          .requestPwaInstall();

      assert.equal(
        result.status,
        "installed",
      );
    } finally {
      restoreSecure();
      restoreNavigator();
      restoreWindow();
    }
  },
);


test(
  "uses manual iOS instructions when no native prompt exists",
  async () => {
    const restoreWindow =
      replaceGlobal(
        "window",
        {
          location: {
            hostname:
              "example.test",
          },

          addEventListener() {},

          matchMedia() {
            return {
              matches:
                false,

              addEventListener() {},
            };
          },
        },
      );

    const restoreNavigator =
      replaceGlobal(
        "navigator",
        {
          serviceWorker:
            {},

          userAgent:
            "Mozilla/5.0 (iPhone)",

          platform:
            "iPhone",

          maxTouchPoints:
            5,
        },
      );

    const restoreSecure =
      replaceGlobal(
        "isSecureContext",
        true,
      );

    try {
      const module =
        await loadInstallModule();

      const result =
        await module
          .requestPwaInstall();

      assert.equal(
        result.status,
        "manual-ios",
      );
    } finally {
      restoreSecure();
      restoreNavigator();
      restoreWindow();
    }
  },
);


test(
  "download button prepares the offline app system",
  async () => {
    const windowListeners =
      new Map();

    const workerListeners =
      new Map();

    let persisted =
      false;

    const worker = {
      postMessage(
        message,
      ) {
        setTimeout(
          () => {
            workerListeners
              .get(
                "message",
              )
              ?.({
                data: {
                  type:
                    "HYPERSYNC_PREPARE_OFFLINE_APP_COMPLETE",

                  requestId:
                    message.requestId,

                  ok:
                    true,
                },
              });
          },
          0,
        );
      },
    };

    const registration = {
      active:
        worker,

      async update() {},
    };

    const restoreWindow =
      replaceGlobal(
        "window",
        {
          location: {
            hostname:
              "example.test",
          },

          addEventListener(
            type,
            listener,
          ) {
            windowListeners.set(
              type,
              listener,
            );
          },

          matchMedia() {
            return {
              matches:
                false,

              addEventListener() {},
            };
          },
        },
      );

    const restoreNavigator =
      replaceGlobal(
        "navigator",
        {
          serviceWorker: {
            controller:
              worker,

            ready:
              Promise.resolve(
                registration,
              ),

            async register() {
              return registration;
            },

            addEventListener(
              type,
              listener,
            ) {
              workerListeners.set(
                type,
                listener,
              );
            },

            removeEventListener(
              type,
              listener,
            ) {
              if (
                workerListeners.get(
                  type,
                ) ===
                listener
              ) {
                workerListeners.delete(
                  type,
                );
              }
            },
          },

          storage: {
            async persist() {
              persisted =
                true;

              return true;
            },
          },

          userAgent:
            "Mozilla/5.0",

          platform:
            "Android",

          maxTouchPoints:
            5,
        },
      );

    const restoreSecure =
      replaceGlobal(
        "isSecureContext",
        true,
      );

    try {
      const module =
        await loadInstallModule();

      const result =
        await module
          .prepareOfflineAppSystem();

      assert.equal(
        result.ready,
        true,
      );

      assert.equal(
        module
          .getPwaInstallState()
          .systemReady,
        true,
      );

      assert.equal(
        persisted,
        true,
      );
    } finally {
      restoreSecure();
      restoreNavigator();
      restoreWindow();
    }
  },
);
