async function requestApi(
  path,
  options,
) {
  const {
    apiRequest,
  } =
    await import(
      "./api/client.js"
    );

  return apiRequest(
    path,
    options,
  );
}


function browserName(
  userAgent,
) {
  if (
    /Edg\//i.test(
      userAgent,
    )
  ) {
    return "Edge";
  }

  if (
    /Firefox\//i.test(
      userAgent,
    )
  ) {
    return "Firefox";
  }

  if (
    /Chrome\//i.test(
      userAgent,
    )
  ) {
    return "Chrome";
  }

  if (
    /Safari\//i.test(
      userAgent,
    )
  ) {
    return "Safari";
  }

  return "Browser";
}


function platformName(
  userAgent,
  platform,
) {
  const source =
    [
      userAgent,
      platform,
    ]
      .filter(Boolean)
      .join(
        " ",
      );

  if (
    /iPhone/i.test(
      source,
    )
  ) {
    return "iPhone";
  }

  if (
    /iPad/i.test(
      source,
    )
  ) {
    return "iPad";
  }

  if (
    /Android/i.test(
      source,
    )
  ) {
    return "Android";
  }

  if (
    /Windows/i.test(
      source,
    )
  ) {
    return "Windows";
  }

  if (
    /Mac/i.test(
      source,
    )
  ) {
    return "Mac";
  }

  if (
    /Linux/i.test(
      source,
    )
  ) {
    return "Linux";
  }

  return "Device";
}


function playbackLiveUrl(
  apiBase,
) {
  const base =
    new URL(
      apiBase,
      globalThis.location
        ?.origin ??
        "http://localhost",
    );

  const path =
    base.pathname
      .replace(
        /\/+$/,
        "",
      ) +
    "/users/me/playback-devices/live";

  base.pathname =
    path;

  base.search =
    "";

  base.hash =
    "";

  if (
    base.protocol ===
      "https:"
  ) {
    base.protocol =
      "wss:";
  } else {
    base.protocol =
      "ws:";
  }

  return base.toString();
}


async function playbackConnectionAuth() {
  const [
    client,
    storage,
  ] =
    await Promise.all([
      import(
        "./api/client.js"
      ),
      import(
        "./api/storage.js"
      ),
    ]);

  const existing =
    storage.getAccessToken();

  if (existing) {
    return {
      accessToken:
        existing,
      apiBase:
        client.API_BASE,
    };
  }

  if (
    !storage.hasStoredSession()
  ) {
    return null;
  }

  const auth =
    await client
      .refreshAccessToken();

  return {
    accessToken:
      auth?.access_token ??
      null,
    apiBase:
      client.API_BASE,
  };
}


export function getPlaybackDeviceDescriptor(
  navigatorLike =
    globalThis.navigator,
) {
  const userAgent =
    String(
      navigatorLike
        ?.userAgent ??
        "",
    );

  const platform =
    String(
      navigatorLike
        ?.userAgentData
        ?.platform ??
      navigatorLike
        ?.platform ??
      "",
    );

  const deviceType =
    /iPad|Tablet/i.test(
      userAgent,
    ) ||
    (
      /Android/i.test(
        userAgent,
      ) &&
      !/Mobile/i.test(
        userAgent,
      )
    )
      ? "tablet"
      : (
          /iPhone|Android.*Mobile/i.test(
            userAgent,
          )
            ? "mobile"
            : (
                /Windows|Mac|Linux/i.test(
                  userAgent +
                  " " +
                  platform,
                )
                  ? "desktop"
                  : "browser"
              )
        );

  const browser =
    browserName(
      userAgent,
    );

  const device =
    platformName(
      userAgent,
      platform,
    );

  return {
    name:
      browser +
      " on " +
      device,

    deviceType,
  };
}


export function resolvePlaybackControlTarget({
  devices = [],
  currentDeviceId = null,
  activeDeviceId = null,
  controlledDeviceId = null,
} = {}) {
  const normalizedDevices =
    Array.isArray(devices)
      ? devices
      : [];

  const currentId =
    String(currentDeviceId ?? "").trim();

  const activeId =
    String(activeDeviceId ?? "").trim();

  const controlledId =
    String(controlledDeviceId ?? "").trim();

  const matchingActive =
    activeId
      ? normalizedDevices.find(
          (device) =>
            String(
              device?.device_id ?? "",
            ) === activeId,
        ) ?? null
      : null;

  if (
    activeId &&
    (
      !matchingActive ||
      matchingActive.is_online
    )
  ) {
    return activeId;
  }

  const listedActive =
    normalizedDevices.find(
      (device) =>
        device?.is_active &&
        device?.is_online,
    );

  if (listedActive?.device_id) {
    return String(
      listedActive.device_id,
    );
  }

  const currentDevice =
    currentId
      ? normalizedDevices.find(
          (device) =>
            String(
              device?.device_id ?? "",
            ) === currentId,
        ) ?? null
      : null;

  if (
    currentId &&
    (
      !currentDevice ||
      currentDevice.is_online
    )
  ) {
    return currentId;
  }

  const controlledDevice =
    controlledId
      ? normalizedDevices.find(
          (device) =>
            String(
              device?.device_id ?? "",
            ) === controlledId,
        ) ?? null
      : null;

  if (
    controlledId &&
    controlledDevice?.is_online
  ) {
    return controlledId;
  }

  const firstOnline =
    normalizedDevices.find(
      (device) =>
        device?.is_online,
    );

  return firstOnline?.device_id
    ? String(
        firstOnline.device_id,
      )
    : (
        currentId ||
        controlledId ||
        null
      );
}


export async function pollPlaybackDevice({
  deviceId,
  name,
  deviceType,
}) {
  return requestApi(
    "/users/me/playback-devices/poll",
    {
      method:
        "POST",

      cache:
        "no-store",

      body:
        JSON.stringify({
          device_id:
            deviceId,
          name,
          device_type:
            deviceType,
        }),
    },
  );
}


export async function sendPlaybackDeviceCommand({
  targetDeviceId,
  sourceDeviceId,
  action,
  value = null,
  trackId = null,
  queueTrackIds = [],
  queueIndex = null,
}) {
  const target =
    encodeURIComponent(
      String(
        targetDeviceId ??
        "",
      ),
    );

  return requestApi(
    "/users/me/playback-devices/" +
      target +
      "/commands",
    {
      method:
        "POST",

      cache:
        "no-store",

      body:
        JSON.stringify({
          source_device_id:
            sourceDeviceId,
          action,
          value,
          track_id:
            trackId,
          queue_track_ids:
            Array.isArray(
              queueTrackIds,
            )
              ? queueTrackIds
                  .slice(
                    0,
                    500,
                  )
                  .map(
                    (trackIdValue) =>
                      String(
                        trackIdValue,
                      ),
                  )
              : [],
          queue_index:
            Number.isInteger(
              queueIndex,
            )
              ? queueIndex
              : null,
        }),
    },
  );
}


export async function connectPlaybackDeviceLive({
  deviceId,
  name,
  deviceType,
  onEvent,
  onClose,
}) {
  if (
    typeof globalThis.WebSocket !==
      "function"
  ) {
    return null;
  }

  const auth =
    await playbackConnectionAuth();

  if (
    !auth?.accessToken
  ) {
    return null;
  }

  const socket =
    new WebSocket(
      playbackLiveUrl(
        auth.apiBase,
      ),
    );

  let heartbeatTimer =
    null;

  let closed =
    false;

  let ready =
    false;

  const pendingRequests =
    new Map();

  const rejectPendingRequests =
    (
      message =
        "Realtime playback connection closed.",
    ) => {
      for (
        const pending
        of pendingRequests.values()
      ) {
        globalThis.clearTimeout(
          pending.timer,
        );

        pending.reject(
          new Error(
            message,
          ),
        );
      }

      pendingRequests.clear();
    };

  const createRequestId =
    () => {
      try {
        if (
          typeof globalThis.crypto
            ?.randomUUID ===
            "function"
        ) {
          return globalThis.crypto
            .randomUUID();
        }
      } catch {
        // Fall through to timestamp id.
      }

      return (
        Date.now().toString(36) +
        "-" +
        Math.random()
          .toString(36)
          .slice(2)
      );
    };

  const isReady =
    () =>
      (
        !closed &&
        ready &&
        socket.readyState ===
          globalThis.WebSocket.OPEN
      );

  const stopHeartbeat =
    () => {
      if (
        heartbeatTimer !==
          null
      ) {
        globalThis.clearInterval(
          heartbeatTimer,
        );

        heartbeatTimer =
          null;
      }
    };

  socket.addEventListener(
    "open",
    () => {
      socket.send(
        JSON.stringify({
          type:
            "authenticate",
          access_token:
            auth.accessToken,
          device_id:
            deviceId,
          name,
          device_type:
            deviceType,
        }),
      );

      heartbeatTimer =
        globalThis.setInterval(
          () => {
            if (
              socket.readyState ===
              globalThis.WebSocket.OPEN
            ) {
              socket.send(
                JSON.stringify({
                  type:
                    "heartbeat",
                }),
              );
            }
          },
          1000,
        );
    },
  );

  socket.addEventListener(
    "message",
    (event) => {
      try {
        const payload =
          JSON.parse(
            String(
              event.data ??
              "",
            ),
          );

        if (
          payload?.type ===
            "ready"
        ) {
          ready =
            true;
        }

        const requestId =
          String(
            payload?.request_id ??
              "",
          );

        if (
          requestId &&
          (
            payload?.type ===
              "command_ack" ||
            payload?.type ===
              "command_error"
          )
        ) {
          const pending =
            pendingRequests.get(
              requestId,
            );

          if (pending) {
            pendingRequests.delete(
              requestId,
            );

            globalThis.clearTimeout(
              pending.timer,
            );

            if (
              payload.type ===
                "command_error"
            ) {
              pending.reject(
                new Error(
                  String(
                    payload.detail ??
                      "Realtime playback command failed.",
                  ),
                ),
              );
            } else {
              pending.resolve(
                payload,
              );
            }
          }
        }

        onEvent?.(
          payload,
        );
      } catch {
        // Ignore malformed realtime frames.
      }
    },
  );

  socket.addEventListener(
    "close",
    (event) => {
      if (closed) {
        return;
      }

      closed =
        true;

      ready =
        false;

      stopHeartbeat();

      rejectPendingRequests();

      onClose?.(
        event,
      );
    },
  );

  socket.addEventListener(
    "error",
    () => {
      /*
       * The close event owns reconnect
       * behavior so errors do not cause
       * duplicate retries.
       */
    },
  );

  return {
    isReady,

    sendCommand({
      targetDeviceId,
      action,
      value = null,
      trackId = null,
      queueTrackIds = [],
      queueIndex = null,
    }) {
      if (!isReady()) {
        return null;
      }

      const requestId =
        createRequestId();

      const promise =
        new Promise(
          (
            resolve,
            reject,
          ) => {
            const timer =
              globalThis.setTimeout(
                () => {
                  pendingRequests.delete(
                    requestId,
                  );

                  reject(
                    new Error(
                      "Realtime playback command timed out.",
                    ),
                  );
                },
                4000,
              );

            pendingRequests.set(
              requestId,
              {
                resolve,
                reject,
                timer,
              },
            );
          },
        );

      try {
        socket.send(
          JSON.stringify({
            type:
              "command",
            request_id:
              requestId,
            target_device_id:
              targetDeviceId,
            action,
            value,
            track_id:
              trackId,
            queue_track_ids:
              Array.isArray(
                queueTrackIds,
              )
                ? queueTrackIds
                    .slice(
                      0,
                      500,
                    )
                    .map(
                      (trackIdValue) =>
                        String(
                          trackIdValue,
                        ),
                    )
                : [],
            queue_index:
              Number.isInteger(
                queueIndex,
              )
                ? queueIndex
                : null,
          }),
        );
      } catch (error) {
        const pending =
          pendingRequests.get(
            requestId,
          );

        if (pending) {
          pendingRequests.delete(
            requestId,
          );

          globalThis.clearTimeout(
            pending.timer,
          );

          pending.reject(
            error,
          );
        }
      }

      return promise;
    },

    sendPlaybackState({
      trackId,
      positionSeconds,
      paused,
    }) {
      if (!isReady()) {
        return false;
      }

      try {
        socket.send(
          JSON.stringify({
            type:
              "playback_state",
            track_id:
              trackId,
            position_seconds:
              positionSeconds,
            paused:
              Boolean(
                paused,
              ),
          }),
        );

        return true;
      } catch {
        return false;
      }
    },

    close() {
      if (closed) {
        return;
      }

      closed =
        true;

      ready =
        false;

      stopHeartbeat();

      rejectPendingRequests();

      try {
        socket.close(
          1000,
          "client shutdown",
        );
      } catch {
        // Socket may already be gone.
      }
    },

    socket,
  };
}
