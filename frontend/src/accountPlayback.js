import { apiRequest } from "./api/client.js";
import * as player from "./audioPlayer.js";

let activeFlush = null;

export async function flushAccountPlayback() {
  await activeFlush?.();
}

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

  const save = (force = false, keepalive = false) => {
    if (!active || !ready) return writeChain;
    const state = player.getState();
    if (!state?.trackId) return writeChain;

    const position = Math.max(0, Number(state.currentTime) || 0);
    const key = `${state.trackId}:${Math.floor(position)}`;
    if (!force && (key === lastSavedKey || key === pendingKey)) return writeChain;

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
          keepalive,
        });
        lastSavedKey = key;
      } finally {
        if (pendingKey === key) pendingKey = "";
      }
    }).catch(() => {});
    return writeChain;
  };

  const unsubscribe = player.subscribe((state) => {
    if (!active) return;
    const trackId = state?.trackId ?? null;

    if (!ready) {
      if (
        (trackId && trackId !== observedTrackId) ||
        state?.phase === "playing" ||
        state?.phase === "loading"
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

  let refreshInFlight = false;
  const refreshAccountState = async () => {
    if (!active || refreshInFlight) return;
    refreshInFlight = true;
    try {
      // Live account updates are informational only. Never restore a remote
      // checkpoint into an already-open player: that replaces its audio source
      // and can interrupt a local queue selection or an in-progress load.
      publishAccountState(await apiRequest("/users/me/playback-state"));
    } catch {
      // Keep the last known account snapshot during temporary network errors.
    } finally {
      refreshInFlight = false;
    }
  };

  const flush = async (keepalive = false) => {
    if (!active) return;
    await save(true, keepalive);
    await writeChain.catch(() => {});
  };
  activeFlush = () => flush(false);
  const onPageExit = () => {
    void flush(true);
  };
  window.addEventListener("pagehide", onPageExit);
  const interval = window.setInterval(() => {
    void refreshAccountState().finally(() => {
      save(false);
    });
  }, 5_000);
  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") save(true);
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
    window.removeEventListener("pagehide", onPageExit);
    if (activeFlush) activeFlush = null;
    unsubscribe();
  };
}
