export function mediaSessionIdentity(state, source = null) {
  return state.trackId || source || state.src || null;
}

export function mediaSessionPlaybackState(state, source = null) {
  return mediaSessionIdentity(state, source)
    ? (state.paused ? "paused" : "playing")
    : "none";
}
