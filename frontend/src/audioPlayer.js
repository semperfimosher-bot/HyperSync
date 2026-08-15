import { API_BASE } from "./api/client.js";

const audio = new Audio();
let subscribers = new Set();
let currentArtworkUrl = null;
let currentTrackTitle = "";
let currentTrackArtist = "";

function notify() {
  const state = getState();
  subscribers.forEach((cb) => {
    try {
      cb(state);
    } catch (e) {
      // ignore subscriber errors
    }
  });
}

export function subscribe(cb) {
  subscribers.add(cb);
  // send initial state
  try {
    cb(getState());
  } catch (e) {}

  return () => {
    subscribers.delete(cb);
  };
}

export function getState() {
  return {
    src: audio.currentSrc || null,
    paused: audio.paused,
    currentTime: audio.currentTime || 0,
    duration: isFinite(audio.duration) ? audio.duration : 0,
    volume: audio.volume,
    muted: audio.muted,
    artworkUrl: currentArtworkUrl,
    title: currentTrackTitle,
    artist: currentTrackArtist,
  };
}

function attachEvents() {
  [
    "play",
    "pause",
    "timeupdate",
    "durationchange",
    "volumechange",
    "ended",
    "loadedmetadata",
    "error",
  ].forEach((ev) => {
    audio.addEventListener(ev, notify);
  });
}

attachEvents();

export function playTrack(trackId, meta = {}) {
  if (!trackId) return;

  const {
    artworkUrl = null,
    title = "",
    artist = "",
  } = meta;

  currentArtworkUrl = artworkUrl;
  currentTrackTitle = title;
  currentTrackArtist = artist;

  // Build URL using API_BASE; ensure no double-slash
  const base = API_BASE.replace(/\/$/, "");
  const url = `${base}/audio/${trackId}`;

  // Set src and attempt to play
  audio.src = url;
  audio.crossOrigin = "anonymous";
  audio.load();

  return audio.play().then(() => getState());
}

export function playUrl(url, meta = {}) {
  if (!url) return;

  const {
    artworkUrl = null,
    title = "",
    artist = "",
  } = meta;

  currentArtworkUrl = artworkUrl;
  currentTrackTitle = title;
  currentTrackArtist = artist;

  audio.src = url;
  audio.crossOrigin = "anonymous";
  audio.load();
  return audio.play().then(() => getState());
}

export async function togglePlay() {
  if (audio.paused) {
    await audio.play();
  } else {
    audio.pause();
  }
  return getState();
}

export function seekTo(timeSeconds) {
  if (typeof timeSeconds === "number" && isFinite(timeSeconds)) {
    audio.currentTime = Math.max(0, Math.min(timeSeconds, audio.duration || timeSeconds));
    notify();
  }
}

export function setVolume(v) {
  audio.volume = Math.max(0, Math.min(1, v));
  notify();
}

// Expose the underlying audio element for debug/testing
export function _getAudioElement() {
  return audio;
}

// Convenience: attach to window in dev for manual testing
if (typeof window !== "undefined") {
  // avoid clobbering
  if (!window.__HYPERSYNC_PLAYER) {
    window.__HYPERSYNC_PLAYER = { playTrack, playUrl, togglePlay, seekTo, setVolume, getState, subscribe, _getAudioElement };
  }
}
