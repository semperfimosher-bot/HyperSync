import {
  registerHyperSyncServiceWorker,
} from "./serviceWorkerRegistration.js";

import {
  deletePushSubscription,
  getPushConfig,
  savePushSubscription,
} from "./messageApi.js";


const SERVICE_WORKER_TIMEOUT_MS =
  6_000;

const PUSH_OPERATION_TIMEOUT_MS =
  10_000;


function decodeApplicationServerKey(
  value,
) {
  const padding =
    "=".repeat(
      (
        4 -
        (
          value.length %
          4
        )
      ) %
        4,
    );

  const normalized =
    (
      value +
      padding
    )
      .replace(
        /-/g,
        "+",
      )
      .replace(
        /_/g,
        "/",
      );

  const raw =
    globalThis.atob(
      normalized,
    );

  return Uint8Array.from(
    raw,
    (character) =>
      character.charCodeAt(
        0,
      ),
  );
}


function encodeApplicationServerKey(
  value,
) {
  if (!value) {
    return "";
  }

  const bytes =
    value instanceof Uint8Array
      ? value
      : new Uint8Array(
          value,
        );

  let binary = "";

  for (
    const byte
    of bytes
  ) {
    binary +=
      String.fromCharCode(
        byte,
      );
  }

  return globalThis
    .btoa(
      binary,
    )
    .replace(
      /\+/g,
      "-",
    )
    .replace(
      /\//g,
      "_",
    )
    .replace(
      /=+$/g,
      "",
    );
}


function serializeSubscription(
  subscription,
) {
  const json =
    subscription.toJSON();

  return {
    endpoint:
      json.endpoint,
    keys: {
      p256dh:
        json.keys?.p256dh,
      auth:
        json.keys?.auth,
    },
  };
}


function wait(
  milliseconds,
) {
  return new Promise(
    (resolve) => {
      globalThis.setTimeout(
        resolve,
        milliseconds,
      );
    },
  );
}


function withTimeout(
  promise,
  milliseconds,
  message,
) {
  let timeoutId = null;

  const timeoutPromise =
    new Promise(
      (
        _resolve,
        reject,
      ) => {
        timeoutId =
          globalThis.setTimeout(
            () => {
              reject(
                new Error(
                  message,
                ),
              );
            },
            milliseconds,
          );
      },
    );

  return Promise.race([
    promise,
    timeoutPromise,
  ]).finally(
    () => {
      if (timeoutId) {
        globalThis.clearTimeout(
          timeoutId,
        );
      }
    },
  );
}


export function pushNotificationsSupported() {
  return Boolean(
    globalThis.navigator
      ?.serviceWorker &&
    globalThis.PushManager &&
    globalThis.Notification,
  );
}


async function waitForActiveRegistration(
  registration,
) {
  if (
    registration?.active
  ) {
    return registration;
  }

  const serviceWorker =
    globalThis.navigator
      ?.serviceWorker;

  const startedAt =
    Date.now();

  while (
    Date.now() -
      startedAt <
      SERVICE_WORKER_TIMEOUT_MS
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

  if (
    serviceWorker?.ready
  ) {
    try {
      const ready =
        await withTimeout(
          serviceWorker.ready,
          1_500,
          "Push service worker activation timed out.",
        );

      if (ready?.active) {
        return ready;
      }
    } catch {
      // Fall through to the clear error below.
    }
  }

  throw new Error(
    "Push service worker could not activate. Reload the app and try again.",
  );
}


async function getPushRegistration() {
  const serviceWorker =
    globalThis.navigator
      ?.serviceWorker;

  if (!serviceWorker) {
    return null;
  }

  let registration = null;

  if (
    typeof serviceWorker
      .getRegistration ===
      "function"
  ) {
    registration =
      await withTimeout(
        serviceWorker
          .getRegistration(
            "/",
          ),
        PUSH_OPERATION_TIMEOUT_MS,
        "Unable to read the push service worker registration.",
      );
  }

  if (!registration) {
    registration =
      await withTimeout(
        registerHyperSyncServiceWorker(),
        PUSH_OPERATION_TIMEOUT_MS,
        "Unable to register the push service worker.",
      );
  }

  if (!registration) {
    return null;
  }

  return waitForActiveRegistration(
    registration,
  );
}


function subscriptionUsesKey(
  subscription,
  publicKey,
) {
  const currentKey =
    subscription
      ?.options
      ?.applicationServerKey;

  if (!currentKey) {
    return false;
  }

  return (
    encodeApplicationServerKey(
      currentKey,
    ) ===
    String(
      publicKey ??
      "",
    ).replace(
      /=+$/g,
      "",
    )
  );
}


async function saveSubscriptionReliably(
  subscription,
) {
  const payload =
    serializeSubscription(
      subscription,
    );

  let lastError = null;

  for (
    let attempt = 0;
    attempt < 2;
    attempt += 1
  ) {
    try {
      await withTimeout(
        savePushSubscription(
          payload,
        ),
        PUSH_OPERATION_TIMEOUT_MS,
        "Saving the push subscription timed out.",
      );

      return;
    } catch (error) {
      lastError =
        error;

      if (
        attempt === 0
      ) {
        await wait(
          250,
        );
      }
    }
  }

  throw (
    lastError ??
    new Error(
      "Unable to save the push subscription.",
    )
  );
}


async function replaceStaleSubscription(
  subscription,
) {
  const endpoint =
    subscription?.endpoint;

  if (endpoint) {
    void deletePushSubscription(
      endpoint,
    ).catch(
      () => {},
    );
  }

  try {
    await withTimeout(
      subscription.unsubscribe(),
      PUSH_OPERATION_TIMEOUT_MS,
      "Removing the old push subscription timed out.",
    );
  } catch {
    // Browser cleanup is best effort; subscribe
    // below will surface any real blocking error.
  }
}


async function ensurePushSubscription(
  registration,
  publicKey,
) {
  let subscription =
    await withTimeout(
      registration
        .pushManager
        .getSubscription(),
      PUSH_OPERATION_TIMEOUT_MS,
      "Reading the browser push subscription timed out.",
    );

  if (
    subscription &&
    !subscriptionUsesKey(
      subscription,
      publicKey,
    )
  ) {
    await replaceStaleSubscription(
      subscription,
    );

    subscription =
      null;
  }

  if (!subscription) {
    subscription =
      await withTimeout(
        registration
          .pushManager
          .subscribe({
            userVisibleOnly:
              true,
            applicationServerKey:
              decodeApplicationServerKey(
                publicKey,
              ),
          }),
        PUSH_OPERATION_TIMEOUT_MS,
        "Creating the browser push subscription timed out.",
      );
  }

  await saveSubscriptionReliably(
    subscription,
  );

  return subscription;
}


export async function syncExistingPushSubscription() {
  if (
    !pushNotificationsSupported()
  ) {
    return {
      supported:
        false,
      configured:
        false,
      enabled:
        false,
    };
  }

  const config =
    await withTimeout(
      getPushConfig(),
      PUSH_OPERATION_TIMEOUT_MS,
      "Loading push notification settings timed out.",
    );

  if (
    !config?.enabled ||
    !config?.public_key
  ) {
    return {
      supported:
        true,
      configured:
        false,
      enabled:
        false,
      permission:
        Notification.permission,
    };
  }

  if (
    Notification.permission !==
      "granted"
  ) {
    return {
      supported:
        true,
      configured:
        true,
      enabled:
        false,
      permission:
        Notification.permission,
    };
  }

  const registration =
    await getPushRegistration();

  if (!registration) {
    return {
      supported:
        true,
      configured:
        true,
      enabled:
        false,
      permission:
        Notification.permission,
    };
  }

  await ensurePushSubscription(
    registration,
    config.public_key,
  );

  return {
    supported:
      true,
    configured:
      true,
    enabled:
      true,
    permission:
      Notification.permission,
  };
}


export async function enablePushNotifications() {
  if (
    !pushNotificationsSupported()
  ) {
    return {
      supported:
        false,
      configured:
        false,
      enabled:
        false,
    };
  }

  const config =
    await withTimeout(
      getPushConfig(),
      PUSH_OPERATION_TIMEOUT_MS,
      "Loading push notification settings timed out.",
    );

  if (
    !config?.enabled ||
    !config?.public_key
  ) {
    return {
      supported:
        true,
      configured:
        false,
      enabled:
        false,
      permission:
        Notification.permission,
    };
  }

  const permission =
    Notification.permission ===
      "granted"
      ? "granted"
      : await Notification
          .requestPermission();

  if (
    permission !==
      "granted"
  ) {
    return {
      supported:
        true,
      configured:
        true,
      enabled:
        false,
      permission,
    };
  }

  const registration =
    await getPushRegistration();

  if (!registration) {
    throw new Error(
      "Push service worker registration is unavailable.",
    );
  }

  await ensurePushSubscription(
    registration,
    config.public_key,
  );

  return {
    supported:
      true,
    configured:
      true,
    enabled:
      true,
    permission,
  };
}
