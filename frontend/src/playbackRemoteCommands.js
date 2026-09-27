export function shouldOverlapOutgoingHandoff({
  snapshot = null,
  deviceId = null,
  localState = null,
} = {}) {
  const currentDeviceId =
    String(
      deviceId ??
        "",
    ).trim();

  const nextOwnerId =
    String(
      snapshot?.device_id ??
        "",
    ).trim();

  const localTrackId =
    String(
      localState?.trackId ??
        "",
    ).trim();

  const remoteTrackId =
    String(
      snapshot?.track?.id ??
        "",
    ).trim();

  return Boolean(
    currentDeviceId &&
    nextOwnerId &&
    nextOwnerId !==
      currentDeviceId &&
    localTrackId &&
    remoteTrackId &&
    localTrackId ===
      remoteTrackId &&
    localState?.paused ===
      false &&
    snapshot?.paused ===
      false
  );
}


export function advanceOutgoingHandoffObservation({
  snapshot = null,
  deviceId = null,
  localState = null,
  previousObservation = null,
  updatedAtMs = 0,
} = {}) {
  if (
    !shouldOverlapOutgoingHandoff({
      snapshot,
      deviceId,
      localState,
    })
  ) {
    return {
      phase:
        "none",
      justConfirmed:
        false,
      observation:
        null,
    };
  }

  const targetDeviceId =
    String(
      snapshot?.device_id ??
        "",
    ).trim();

  const trackId =
    String(
      snapshot?.track?.id ??
        "",
    ).trim();

  const normalizedUpdatedAtMs =
    Math.max(
      Number(
        updatedAtMs,
      ) || 0,
      0,
    );

  const sameHandoff =
    previousObservation &&
    String(
      previousObservation
        .targetDeviceId ??
        "",
    ) ===
      targetDeviceId &&
    String(
      previousObservation
        .trackId ??
        "",
    ) ===
      trackId;

  if (!sameHandoff) {
    return {
      phase:
        "waiting",
      justConfirmed:
        false,
      observation: {
        targetDeviceId,
        trackId,
        updatedAtMs:
          normalizedUpdatedAtMs,
        confirmed:
          false,
      },
    };
  }

  if (
    previousObservation
      .confirmed
  ) {
    return {
      phase:
        "confirmed",
      justConfirmed:
        false,
      observation:
        previousObservation,
    };
  }

  const previousUpdatedAtMs =
    Math.max(
      Number(
        previousObservation
          .updatedAtMs,
      ) || 0,
      0,
    );

  if (
    normalizedUpdatedAtMs >
      previousUpdatedAtMs
  ) {
    return {
      phase:
        "confirmed",
      justConfirmed:
        true,
      observation: {
        ...previousObservation,
        updatedAtMs:
          normalizedUpdatedAtMs,
        confirmed:
          true,
      },
    };
  }

  return {
    phase:
      "waiting",
    justConfirmed:
      false,
    observation:
      previousObservation,
  };
}


export function shouldApplyPlaybackRemoteCommand(
  command,
  {
    snapshot = null,
    deviceId = null,
  } = {},
) {
  const action =
    String(
      command?.action ??
        "",
    );

  if (
    action === "transfer" ||
    action === "play_track"
  ) {
    return true;
  }

  if (
    ![
      "play",
      "pause",
      "next",
      "previous",
      "seek",
      "volume",
      "stop",
    ].includes(
      action,
    )
  ) {
    return true;
  }

  const ownerId =
    String(
      snapshot?.device_id ??
        "",
    ).trim();

  const currentId =
    String(
      deviceId ??
        "",
    ).trim();

  return (
    !ownerId ||
    !currentId ||
    ownerId ===
      currentId
  );
}


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

  const execute =
    async () => {
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
        action === "stop"
      ) {
        player.stopTrack();

        return player.getState();
      }

      if (
        action === "play_track"
      ) {
        const remoteQueue =
          Array.isArray(
            command.queue,
          )
            ? command.queue
            : [];

        if (
          remoteQueue.length > 0 &&
          typeof player
            .playTrackQueue ===
            "function"
        ) {
          const requestedIndex =
            Number(
              command.queue_index,
            );

          const safeIndex =
            Number.isInteger(
              requestedIndex,
            )
              ? Math.min(
                  Math.max(
                    requestedIndex,
                    0,
                  ),
                  remoteQueue.length - 1,
                )
              : 0;

          await player.playTrackQueue(
            remoteQueue,
            safeIndex,
          );

          return player.getState();
        }

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
        } else {
          player.stopTrack();
        }

        return player.getState();
      }

      if (
        action === "transfer"
      ) {
        if (
          snapshot?.track?.id
        ) {
          const current =
            player.getState();

          const sameTrack =
            String(
              current?.trackId ??
                "",
            ) ===
            String(
              snapshot.track.id,
            );

          const alreadyMatching =
            sameTrack &&
            Boolean(
              current?.paused,
            ) ===
            Boolean(
              snapshot.paused,
            );

          const remoteQueue =
            Array.isArray(
              snapshot?.queue,
            )
              ? snapshot.queue
              : [];

          const remoteQueueIndex =
            Number(
              snapshot?.queue_index,
            );

          const queueMatches =
            remoteQueue.length ===
              0 ||
            (
              Array.isArray(
                current?.queue,
              ) &&
              current.queue.length ===
                remoteQueue.length &&
              current.queue.every(
                (entry, index) =>
                  String(
                    entry?.id ??
                      "",
                  ) ===
                  String(
                    remoteQueue[
                      index
                    ]?.id ??
                      "",
                  ),
              ) &&
              Number(
                current?.queueIndex,
              ) ===
                remoteQueueIndex
            );

          if (
            !alreadyMatching ||
            !queueMatches
          ) {
            if (
              remoteQueue.length > 0 &&
              typeof player
                .restoreAccountPlaybackQueue ===
                "function"
            ) {
              await player.restoreAccountPlaybackQueue(
                remoteQueue,
                Number.isInteger(
                  remoteQueueIndex,
                )
                  ? remoteQueueIndex
                  : 0,
                snapshotPosition(
                  snapshot,
                ),
              );
            } else {
              await player.restoreAccountPlayback(
                snapshot.track,
                snapshotPosition(
                  snapshot,
                ),
              );
            }

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
        }

        return player.getState();
      }

      return null;
    };

  if (
    typeof player
      .runWithLocalPlaybackControl ===
      "function"
  ) {
    return player
      .runWithLocalPlaybackControl(
        execute,
      );
  }

  return execute();
}
