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

          if (!alreadyMatching) {
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
