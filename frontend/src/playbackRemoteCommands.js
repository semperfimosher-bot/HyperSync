export async function applyPlaybackRemoteCommand(
  command,
  {
    player,
    snapshot,
    snapshotPosition,
  },
) {
  if (
    !command ||
    !player
  ) {
    return null;
  }

  const action =
    String(
      command.action ??
      "",
    );

  if (
    action === "play"
  ) {
    if (
      player.getState()
        ?.paused
    ) {
      await player.togglePlay();
    }

    return player.getState();
  }

  if (
    action === "pause"
  ) {
    player.pausePlayback();

    return player.getState();
  }

  if (
    action === "next"
  ) {
    await player.skipToNext();

    return player.getState();
  }

  if (
    action === "previous"
  ) {
    await player.skipToPrevious();

    return player.getState();
  }

  if (
    action === "seek"
  ) {
    const value =
      Number(
        command.value,
      );

    if (
      Number.isFinite(
        value,
      )
    ) {
      player.seekTo(
        Math.max(
          value,
          0,
        ),
      );
    }

    return player.getState();
  }

  if (
    action === "volume"
  ) {
    const value =
      Number(
        command.value,
      );

    if (
      Number.isFinite(
        value,
      )
    ) {
      player.setVolume(
        Math.max(
          0,
          Math.min(
            1,
            value,
          ),
        ),
      );
    }

    return player.getState();
  }

  if (
    action === "transfer"
  ) {
    if (
      snapshot?.track?.id
    ) {
      await player.restoreAccountPlayback(
        snapshot.track,
        snapshotPosition(
          snapshot,
        ),
      );

      if (
        snapshot.paused
      ) {
        player.pausePlayback();
      } else if (
        player.getState()
          ?.paused
      ) {
        await player.togglePlay();
      }
    }

    return player.getState();
  }

  return null;
}
