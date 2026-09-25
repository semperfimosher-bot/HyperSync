export function selectRightRailPlayerState(
  state = {},
) {
  return {
    src:
      state.src ??
      null,

    artworkUrl:
      state.artworkUrl ??
      null,

    title:
      state.title ??
      "",

    artist:
      state.artist ??
      "",

    queue:
      Array.isArray(
        state.queue,
      )
        ? state.queue
        : [],

    queueIndex:
      Number.isInteger(
        state.queueIndex,
      )
        ? state.queueIndex
        : -1,
  };
}


export function isSameRightRailPlayerState(
  left,
  right,
) {
  return (
    left === right ||
    (
      left?.src ===
        right?.src &&
      left?.artworkUrl ===
        right?.artworkUrl &&
      left?.title ===
        right?.title &&
      left?.artist ===
        right?.artist &&
      left?.queue ===
        right?.queue &&
      left?.queueIndex ===
        right?.queueIndex
    )
  );
}
