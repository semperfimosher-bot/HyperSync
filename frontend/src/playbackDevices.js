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

      stopHeartbeat();

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
    close() {
      if (closed) {
        return;
      }

      closed =
        true;

      stopHeartbeat();

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
