import { apiRequest } from "./api/client.js";
import * as player from "./audioPlayer.js";

export function bindAccountPlayback(userId) {
  if (!userId) return () => {};

  let active = true;
  let ready = false;
  let userInteractedBeforeRestore = false;
  let lastTrackId = null;
  let lastSavedKey = "";
  let pendingKey = "";
  let writeChain = Promise.resolve();
  let lastPhase = player.getState()?.phase ?? null;
  let observedTrackId = player.getState()?.trackId ?? null;

  const save = (force = false) => {
    if (!active || !ready) return;
    const state = player.getState();
    if (!state?.trackId) return;

    const position = Math.max(0, Number(state.currentTime) || 0);
    const key = `${state.trackId}:${Math.floor(position)}`;
    if (!force && (key === lastSavedKey || key === pendingKey)) return;

    pendingKey = key;
    const payload = {
      track_id: state.trackId,
      position_seconds: position,
    };

    writeChain = writeChain.catch(() => {}).then(async () => {
      if (!active) return;
      try {
        await apiRequest("/users/me/playback-state", {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        lastSavedKey = key;
      } finally {
        if (pendingKey === key) pendingKey = "";
      }
    });
  };

  const unsubscribe = player.subscribe((state) => {
    if (!active) return;
    const trackId = state?.trackId ?? null;

    if (!ready) {
      if (
        (trackId && trackId !== observedTrackId) ||
        state?.phase === "playing"
      ) {
        userInteractedBeforeRestore = true;
      }
      observedTrackId = trackId;
      lastPhase = state?.phase ?? null;
      return;
    }

    if (trackId && trackId !== lastTrackId) {
      lastTrackId = trackId;
      save(true);
    }

    if (lastPhase === "playing" && state?.phase !== "playing") {
      save(true);
    }

    lastPhase = state?.phase ?? null;
  });

  const publishAccountState = (snapshot) => {
    if (!active) return;
    window.dispatchEvent(new CustomEvent("hypersynced:account-playback", {
      detail: snapshot?.track?.id ? snapshot : null,
    }));
  };

  const refreshAccountState = async () => {
    try {
      publishAccountState(await apiRequest("/users/me/playback-state"));
    } catch {
      // Keep the last known account snapshot during temporary network errors.
    }
  };

  const interval = window.setInterval(() => {
    if (!accountUpdateWaitingForLocalPlayback) save(false);
    void refreshAccountState();
  }, 5_000);
  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden" && !accountUpdateWaitingForLocalPlayback) save(true);
  };
  document.addEventListener("visibilitychange", onVisibilityChange);

  apiRequest("/users/me/playback-state").then(async (saved) => {
    if (!active) return;
    publishAccountState(saved);

    if (saved?.track?.id && !userInteractedBeforeRestore) {
      lastTrackId = saved.track.id;
      lastSavedKey = `${saved.track.id}:${Math.floor(Number(saved.position_seconds) || 0)}`;
      await player.restoreTrackPaused(saved.track, saved.position_seconds);
    } else {
      lastTrackId = player.getState()?.trackId ?? null;
    }

    if (active) ready = true;
  }).catch(() => {
    if (active) {
      lastTrackId = player.getState()?.trackId ?? null;
      ready = true;
    }
  });

  return () => {
    active = false;
    window.clearInterval(interval);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    unsubscribe();
  };
}
