import {
  registerHyperSyncServiceWorker,
} from "./serviceWorkerRegistration.js";


let deferredInstallPrompt =
  null;

let initialized =
  false;

let installedThisSession =
  false;

let preparingSystem =
  false;

let offlineSystemReady =
  false;

let prepareInFlight =
  null;

const listeners =
  new Set();


function windowLike() {
  return globalThis.window ??
    null;
}


function navigatorLike() {
  return globalThis.navigator ??
    null;
}


export function isStandaloneApp() {
  const win =
    windowLike();

  const nav =
    navigatorLike();

  return Boolean(
    installedThisSession ||
    win?.matchMedia?.(
      "(display-mode: standalone)",
    )?.matches ||
    win?.matchMedia?.(
      "(display-mode: fullscreen)",
    )?.matches ||
    nav?.standalone ===
      true,
  );
}


export function isIosInstallPlatform() {
  const nav =
    navigatorLike();

  const userAgent =
    String(
      nav?.userAgent ??
      "",
    );

  const platform =
    String(
      nav?.platform ??
      "",
    );

  const touchPoints =
    Number(
      nav?.maxTouchPoints ??
      0,
    );

  return (
    /iPad|iPhone|iPod/i.test(
      userAgent,
    ) ||
    (
      platform ===
        "MacIntel" &&
      touchPoints >
        1
    )
  );
}


function isSecureInstallContext() {
  const win =
    windowLike();

  if (!win) {
    return false;
  }

  if (
    globalThis.isSecureContext ===
      true
  ) {
    return true;
  }

  return [
    "localhost",
    "127.0.0.1",
    "::1",
  ].includes(
    win.location
      ?.hostname ??
      "",
  );
}


export function getPwaInstallState() {
  const installed =
    isStandaloneApp();

  return {
    installed,

    canPrompt:
      !installed &&
      Boolean(
        deferredInstallPrompt,
      ),

    ios:
      isIosInstallPlatform(),

    secure:
      isSecureInstallContext(),

    supported:
      Boolean(
        navigatorLike()
          ?.serviceWorker,
      ),

    preparing:
      preparingSystem,

    systemReady:
      offlineSystemReady,
  };
}


async function requestPersistentAppStorage() {
  try {
    if (
      navigatorLike()
        ?.storage
        ?.persist
    ) {
      return await navigatorLike()
        .storage
        .persist();
    }
  } catch {
    // Persistence is best-effort.
  }

  return false;
}


function wait(
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


async function waitForActiveRegistration(
  registration,
  timeoutMs =
    8000,
) {
  const nav =
    navigatorLike();

  if (
    registration?.active
  ) {
    return registration;
  }

  const startedAt =
    Date.now();

  while (
    Date.now() -
      startedAt <
    timeoutMs
  ) {
    if (
      registration?.active
    ) {
      return registration;
    }

    await wait(
      100,
    );
  }

  try {
    const ready =
      await Promise.race([
        nav?.serviceWorker
          ?.ready,

        wait(
          1200,
        ).then(
          () => null,
        ),
      ]);

    return ready ??
      registration;
  } catch {
    return registration;
  }
}


async function prepareOfflineSystemInternal() {
  const nav =
    navigatorLike();

  if (
    !nav?.serviceWorker
  ) {
    return {
      ready:
        false,

      reason:
        "unsupported",
    };
  }

  void requestPersistentAppStorage();

  let registration =
    null;

  try {
    registration =
      await registerHyperSyncServiceWorker(
        nav,
      );

    await registration
      ?.update?.()
      .catch?.(
        () => {},
      );

    registration =
      await waitForActiveRegistration(
        registration,
      );
  } catch {
    return {
      ready:
        false,

      reason:
        "registration",
    };
  }

  const worker =
    nav.serviceWorker
      .controller ??
    registration?.active ??
    registration?.waiting ??
    registration?.installing ??
    null;

  if (
    !worker?.postMessage
  ) {
    return {
      ready:
        false,

      reason:
        "worker",
    };
  }

  const requestId =
    globalThis.crypto
      ?.randomUUID?.() ??
    (
      "prepare-" +
      Date.now().toString(36) +
      "-" +
      Math.random()
        .toString(36)
        .slice(
          2,
          10,
        )
    );

  return new Promise(
    (resolve) => {
      let settled =
        false;

      const finish =
        (result) => {
          if (settled) {
            return;
          }

          settled =
            true;

          nav.serviceWorker
            .removeEventListener?.(
              "message",
              handleMessage,
            );

          clearTimeout(
            timeoutId,
          );

          resolve(
            result,
          );
        };

      const handleMessage =
        (event) => {
          if (
            event.data?.type !==
              "HYPERSYNC_PREPARE_OFFLINE_APP_COMPLETE" ||
            event.data?.requestId !==
              requestId
          ) {
            return;
          }

          finish({
            ready:
              event.data?.ok !==
              false,

            reason:
              event.data?.ok ===
                false
                ? "cache"
                : null,
          });
        };

      nav.serviceWorker
        .addEventListener?.(
          "message",
          handleMessage,
        );

      const timeoutId =
        setTimeout(
          () => {
            finish({
              ready:
                false,

              reason:
                "timeout",
            });
          },
          12000,
        );

      worker.postMessage({
        type:
          "HYPERSYNC_PREPARE_OFFLINE_APP",

        requestId,
      });
    },
  );
}


export function prepareOfflineAppSystem() {
  if (offlineSystemReady) {
    return Promise.resolve({
      ready:
        true,

      reason:
        null,
    });
  }

  if (prepareInFlight) {
    return prepareInFlight;
  }

  preparingSystem =
    true;

  emitState();

  prepareInFlight =
    prepareOfflineSystemInternal()
      .then(
        (result) => {
          offlineSystemReady =
            Boolean(
              result?.ready,
            );

          return result;
        },
      )
      .finally(
        () => {
          preparingSystem =
            false;

          prepareInFlight =
            null;

          emitState();
        },
      );

  return prepareInFlight;
}


function emitState() {
  const state =
    getPwaInstallState();

  for (
    const listener
    of listeners
  ) {
    try {
      listener(
        state,
      );
    } catch {
      // A UI listener must never break
      // the install controller.
    }
  }
}


export function initializePwaInstall() {
  if (initialized) {
    return getPwaInstallState();
  }

  initialized =
    true;

  const win =
    windowLike();

  if (!win) {
    return getPwaInstallState();
  }

  win.addEventListener(
    "beforeinstallprompt",
    (event) => {
      event.preventDefault();

      deferredInstallPrompt =
        event;

      emitState();
    },
  );

  win.addEventListener(
    "appinstalled",
    () => {
      deferredInstallPrompt =
        null;

      installedThisSession =
        true;

      void requestPersistentAppStorage();

      emitState();
    },
  );

  const standaloneQuery =
    win.matchMedia?.(
      "(display-mode: standalone)",
    );

  standaloneQuery
    ?.addEventListener?.(
      "change",
      () => {
        emitState();
      },
    );

  return getPwaInstallState();
}


export function subscribePwaInstall(
  listener,
) {
  initializePwaInstall();

  listeners.add(
    listener,
  );

  listener(
    getPwaInstallState(),
  );

  return () => {
    listeners.delete(
      listener,
    );
  };
}


export async function requestPwaInstall() {
  initializePwaInstall();

  const state =
    getPwaInstallState();

  if (!state.secure) {
    return {
      status:
        "insecure",
      state,
    };
  }

  const systemPreparation =
    prepareOfflineAppSystem();

  if (state.installed) {
    const system =
      await systemPreparation;

    return {
      status:
        "installed",

      systemReady:
        Boolean(
          system?.ready,
        ),

      state:
        getPwaInstallState(),
    };
  }

  const prompt =
    deferredInstallPrompt;

  if (prompt) {
    deferredInstallPrompt =
      null;

    emitState();

    try {
      await prompt.prompt();

      const choice =
        await prompt.userChoice;

      const accepted =
        choice?.outcome ===
          "accepted";

      if (accepted) {
        installedThisSession =
          true;

        void requestPersistentAppStorage();
      }

      const system =
        accepted
          ? await systemPreparation
          : null;

      emitState();

      return {
        status:
          accepted
            ? "accepted"
            : "dismissed",

        systemReady:
          accepted
            ? Boolean(
                system?.ready,
              )
            : false,

        state:
          getPwaInstallState(),
      };
    } catch {
      emitState();

      return {
        status:
          "manual",

        state:
          getPwaInstallState(),
      };
    }
  }

  const system =
    await systemPreparation;

  return {
    status:
      state.ios
        ? "manual-ios"
        : "manual",

    systemReady:
      Boolean(
        system?.ready,
      ),

    state:
      getPwaInstallState(),
  };
}
