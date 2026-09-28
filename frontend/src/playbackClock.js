export function playbackUpdatedAtMs(
  value,
) {
  if (!value) {
    return 0;
  }

  const parsed =
    Date.parse(
      value,
    );

  return Number.isFinite(
    parsed,
  )
    ? parsed
    : 0;
}


export function accountPlaybackPosition(
  snapshot,
) {
  const base =
    Math.max(
      Number(
        snapshot
          ?.position_seconds ??
        0,
      ) || 0,
      0,
    );

  if (
    snapshot?.paused
  ) {
    return base;
  }

  const updatedAt =
    playbackUpdatedAtMs(
      snapshot?.updated_at,
    );

  const ageMs =
    updatedAt > 0
      ? Math.max(
          Date.now() -
            updatedAt,
          0,
        )
      : 0;

  const duration =
    Number(
      snapshot?.track
        ?.duration_seconds,
    );

  const advanced =
    base +
    ageMs / 1000;

  return (
    Number.isFinite(
      duration,
    ) &&
    duration > 0
      ? Math.min(
          advanced,
          duration,
        )
      : advanced
  );
}
