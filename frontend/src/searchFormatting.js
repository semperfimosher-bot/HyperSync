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
