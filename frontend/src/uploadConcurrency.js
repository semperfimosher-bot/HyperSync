export function getUploadConcurrency({
  queuedCount = 1,
  connection =
    globalThis.navigator
      ?.connection,
  hardwareConcurrency =
    globalThis.navigator
      ?.hardwareConcurrency,
} = {}) {
  const count =
    Math.max(
      0,
      Number(
        queuedCount,
      ) || 0,
    );

  if (count <= 1) {
    return count;
  }

  if (
    connection
      ?.saveData
  ) {
    return 1;
  }

  const effectiveType =
    String(
      connection
        ?.effectiveType
        ?? "",
    ).toLowerCase();

  const downlink =
    Number(
      connection
        ?.downlink,
    );

  if (
    effectiveType ===
      "slow-2g" ||
    effectiveType ===
      "2g"
  ) {
    return 1;
  }

  if (
    effectiveType ===
      "3g" ||
    (
      Number.isFinite(
        downlink,
      ) &&
      downlink > 0 &&
      downlink < 3
    )
  ) {
    return Math.min(
      2,
      count,
    );
  }

  const cores =
    Number(
      hardwareConcurrency,
    );

  const fastDesktop =
    effectiveType === "4g" &&
    Number.isFinite(
      downlink,
    ) &&
    downlink >= 10 &&
    (
      !Number.isFinite(
        cores,
      ) ||
      cores >= 6
    );

  return Math.min(
    fastDesktop
      ? 3
      : 2,
    count,
  );
}
