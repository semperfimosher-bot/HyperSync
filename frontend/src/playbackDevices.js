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
        }),
    },
  );
}
