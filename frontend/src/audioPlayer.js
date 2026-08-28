import { API_BASE } from "./api/client.js";

import {
  getCachedObjectUrl,
  resolveMediaUrl,
  warmMedia,
} from "./mediaCache.js";


const audio =
  new Audio();


let subscribers =
  new Set();


let currentArtworkUrl =
  null;


let currentTrackTitle =
  "";


let currentTrackArtist =
  "";


let currentTrackId =
  null;


let currentObjectUrl =
  null;


function revokeCurrentObjectUrl() {
  if (!currentObjectUrl) {
    return;
  }

  URL.revokeObjectURL(
    currentObjectUrl,
  );

  currentObjectUrl =
    null;
}


function notify() {
  const state =
    getState();

  subscribers.forEach(
    (cb) => {
      try {
        cb(state);
      } catch {
        // Ignore subscriber errors.
      }
    },
  );
}


export function subscribe(cb) {
  subscribers.add(cb);

  try {
    cb(getState());
  } catch {
    // Ignore subscriber errors.
  }

  return () => {
    subscribers.delete(cb);
  };
}


export function getState() {
  return {
    trackId:
      currentTrackId,

    src:
      audio.currentSrc ||
      null,

    paused:
      audio.paused,

    currentTime:
      audio.currentTime ||
      0,

    duration:
      Number.isFinite(
        audio.duration,
      )
        ? audio.duration
        : 0,

    volume:
      audio.volume,

    muted:
      audio.muted,

    artworkUrl:
      currentArtworkUrl,

    title:
      currentTrackTitle,

    artist:
      currentTrackArtist,
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
  ].forEach(
    (eventName) => {
      audio.addEventListener(
        eventName,
        notify,
      );
    },
  );
}


attachEvents();


async function loadAudioSource(
  url,
) {
  revokeCurrentObjectUrl();

  const cachedObjectUrl =
    await getCachedObjectUrl(
      url,
    );

  if (cachedObjectUrl) {
    currentObjectUrl =
      cachedObjectUrl;

    audio.src =
      cachedObjectUrl;

    return true;
  }

  audio.src = url;

  /*
   * Do not wait for the entire audio file
   * before playback starts.
   *
   * Start playback normally and cache the
   * complete file in the background.
   */

  void warmMedia(
    url,
  ).catch(() => {});

  return false;
}


export async function playTrack(
  trackId,
  meta = {},
) {
  if (!trackId) {
    return;
  }

  const {
    artworkUrl = null,
    title = "",
    artist = "",
  } = meta;

  currentTrackId =
    String(trackId);

  currentArtworkUrl =
    artworkUrl;

  currentTrackTitle =
    title;

  currentTrackArtist =
    artist;

  const base =
    API_BASE.replace(
      /\/$/,
      "",
    );

  const url =
    `${base}/audio/${trackId}`;

  await loadAudioSource(
    url,
  );

  audio.crossOrigin =
    "anonymous";

  audio.load();

  await audio.play();

  return getState();
}


export async function playUrl(
  url,
  meta = {},
) {
  if (!url) {
    return;
  }

  const {
    artworkUrl = null,
    title = "",
    artist = "",
  } = meta;

  currentTrackId =
    null;

  currentArtworkUrl =
    artworkUrl;

  currentTrackTitle =
    title;

  currentTrackArtist =
    artist;

  const mediaUrl =
    resolveMediaUrl(
      url,
    );

  await loadAudioSource(
    mediaUrl,
  );

  audio.crossOrigin =
    "anonymous";

  audio.load();

  await audio.play();

  return getState();
}


export async function togglePlay() {
  if (audio.paused) {
    await audio.play();
  } else {
    audio.pause();
  }

  return getState();
}


export function stopTrack(
  trackId = null,
) {
  if (
    trackId &&
    String(trackId) !==
      currentTrackId
  ) {
    return false;
  }

  audio.pause();

  audio.removeAttribute(
    "src",
  );

  audio.load();

  revokeCurrentObjectUrl();

  currentTrackId =
    null;

  currentArtworkUrl =
    null;

  currentTrackTitle =
    "";

  currentTrackArtist =
    "";

  notify();

  return true;
}


export function seekTo(
  timeSeconds,
) {
  if (
    typeof timeSeconds ===
      "number" &&
    Number.isFinite(
      timeSeconds,
    )
  ) {
    audio.currentTime =
      Math.max(
        0,
        Math.min(
          timeSeconds,
          audio.duration ||
            timeSeconds,
        ),
      );

    notify();
  }
}


export function setVolume(v) {
  audio.volume =
    Math.max(
      0,
      Math.min(
        1,
        v,
      ),
    );

  notify();
}


export function _getAudioElement() {
  return audio;
}


if (
  typeof window !==
  "undefined"
) {
  if (
    !window.__HYPERSYNC_PLAYER
  ) {
    window.__HYPERSYNC_PLAYER = {
      playTrack,
      playUrl,
      togglePlay,
      stopTrack,
      seekTo,
      setVolume,
      getState,
      subscribe,
      _getAudioElement,
    };
  }
}
