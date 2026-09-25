let deferredInstallPrompt =
  null;

let initialized =
  false;

let installedThisSession =
  false;

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

  if (state.installed) {
    return {
      status:
        "installed",
      state,
    };
  }

  if (!state.secure) {
    return {
      status:
        "insecure",
      state,
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

      emitState();

      return {
        status:
          accepted
            ? "accepted"
            : "dismissed",

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

  return {
    status:
      state.ios
        ? "manual-ios"
        : "manual",

    state,
  };
}
