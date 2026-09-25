import {
  getPushConfig,
  savePushSubscription,
} from "./messageApi.js";


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


export function pushNotificationsSupported() {
  return Boolean(
    globalThis.navigator
      ?.serviceWorker &&
    globalThis.PushManager &&
    globalThis.Notification,
  );
}


export async function syncExistingPushSubscription() {
  if (
    !pushNotificationsSupported()
  ) {
    return {
      supported:
        false,
      enabled:
        false,
    };
  }

  const config =
    await getPushConfig();

  if (
    !config?.enabled ||
    !config?.public_key
  ) {
    return {
      supported:
        true,
      enabled:
        false,
    };
  }

  const registration =
    await navigator
      .serviceWorker
      .ready;

  const subscription =
    await registration
      .pushManager
      .getSubscription();

  if (!subscription) {
    return {
      supported:
        true,
      enabled:
        false,
      permission:
        Notification.permission,
    };
  }

  await savePushSubscription(
    serializeSubscription(
      subscription,
    ),
  );

  return {
    supported:
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
      enabled:
        false,
    };
  }

  const config =
    await getPushConfig();

  if (
    !config?.enabled ||
    !config?.public_key
  ) {
    return {
      supported:
        true,
      enabled:
        false,
      configured:
        false,
    };
  }

  const permission =
    await Notification
      .requestPermission();

  if (
    permission !==
      "granted"
  ) {
    return {
      supported:
        true,
      enabled:
        false,
      configured:
        true,
      permission,
    };
  }

  const registration =
    await navigator
      .serviceWorker
      .ready;

  let subscription =
    await registration
      .pushManager
      .getSubscription();

  if (!subscription) {
    subscription =
      await registration
        .pushManager
        .subscribe({
          userVisibleOnly:
            true,
          applicationServerKey:
            decodeApplicationServerKey(
              config.public_key,
            ),
        });
  }

  await savePushSubscription(
    serializeSubscription(
      subscription,
    ),
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
