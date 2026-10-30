import { apiRequest } from "./api/client.js";
import * as player from "./audioPlayer.js";

export function bindAccountPlayback(userId) {
  if (!userId) return () => {};
  let active = true;
  let ready = false;
  let lastTrackId = null;
  let lastSavedKey = "";
  let writeChain = Promise.resolve();
  let lastPhase = null;

  const save = (force = false) => {
    if (!active || !ready) return;
    const state = player.getState();
    if (!state?.id) return;
    const position = Math.max(0, Number(state.currentTime) || 0);
    const key = `${state.id}:${Math.floor(position)}`;
    if (!force && key === lastSavedKey) return;
    lastSavedKey = key;
    const payload = { track_id: state.id, position_seconds: position };
    writeChain = writeChain.catch(() => {}).then(() => {
      if (!active) return;
      return apiRequest("/users/me/playback-state", {
        method: "PUT",
        body: JSON.stringify(payload),
      });
    });
  };

  const unsubscribe = player.subscribe((state) => {
    if (!active || !ready) return;
    const trackId = state?.id ?? null;
    if (trackId && trackId !== lastTrackId) {
      lastTrackId = trackId;
      save(true);
    }
    if (lastPhase === "playing" && state?.phase !== "playing") {
      save(true);
    }
    lastPhase = state?.phase ?? null;
  });

  const interval = window.setInterval(() => save(false), 30_000);
  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") save(true);
  };
  document.addEventListener("visibilitychange", onVisibilityChange);

  apiRequest("/users/me/playback-state").then(async (saved) => {
    if (!active) return;
    if (saved?.track?.id) {
      lastTrackId = saved.track.id;
      lastSavedKey = `${saved.track.id}:${Math.floor(Number(saved.position_seconds) || 0)}`;
      await player.restoreTrackPaused(saved.track, saved.position_seconds);
    }
    if (active) ready = true;
  }).catch(() => {
    if (active) ready = true;
  });

  return () => {
    active = false;
    window.clearInterval(interval);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    unsubscribe();
  };
}
