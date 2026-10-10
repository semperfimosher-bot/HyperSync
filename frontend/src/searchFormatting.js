export function formatDuration(seconds) {
  const safe = Number(seconds);

  if (
    !Number.isFinite(safe) ||
    safe <= 0
  ) {
    return "--:--";
  }

  const minutes =
    Math.floor(
      safe / 60,
    );

  const remainder =
    Math.floor(
      safe % 60,
    )
      .toString()
      .padStart(
        2,
        "0",
      );

  return (
    `${minutes}:${remainder}`
  );
}

export function memberFor(value) {
  if (!value) {
    return "New member";
  }

  const days = Math.max(
    0,
    Math.floor(
      (
        Date.now() -
        new Date(value).getTime()
      ) /
        86400000,
    ),
  );

  if (days < 30) {
    return `${Math.max(
      days,
      1,
    )}d on HyperSynced`;
  }

  if (days < 365) {
    return `${Math.max(
      1,
      Math.floor(days / 30),
    )}mo on HyperSynced`;
  }

  return `${Math.floor(
    days / 365,
  )}y on HyperSynced`;
}
