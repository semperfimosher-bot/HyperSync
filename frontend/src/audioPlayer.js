import {
  API_BASE,
  apiRequest,
} from "./api/client.js";

import {
  getAccessToken,
} from "./api/storage.js";

import {
  getCachedObjectUrl,
  resolveMediaUrl,
  warmMedia,
} from "./mediaCache.js";

import {
  buildTrackQueue,
  getNextQueueIndex,
  getQueueTrackAtIndex,
} from "./playerQueue.js";

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

let currentQueue =
  [];

let currentQueueIndex =
  -1;

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

function clearQueue() {
  currentQueue =
    [];

  currentQueueIndex =
    -1;
}


function audioUrlForTrack(
  trackId,
) {
  const base =
    API_BASE.replace(
      /\/$/,
      "",
    );

  return (
    `${base}/audio/${trackId}`
  );
}


function warmNextQueueTrack() {
  const nextIndex =
    getNextQueueIndex(
      currentQueue,
      currentQueueIndex,
    );

  if (nextIndex === -1) {
    return;
  }

  const nextTrack =
    currentQueue[nextIndex];

  void warmMedia(
    audioUrlForTrack(
      nextTrack.id,
    ),
  ).catch(() => {});
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

    queue:
      currentQueue,

    queueIndex:
      currentQueueIndex,
  };
}


async function playNextQueueTrack() {
  const nextIndex =
    getNextQueueIndex(
      currentQueue,
      currentQueueIndex,
    );

  /*
   * End of the current queue.
   *
   * For now playback ends naturally.
   *
   * Later this is where HyperSync can
   * request suggested tracks and append
   * them to the queue.
   */
  if (nextIndex === -1) {
    notify();
    return;
  }

  currentQueueIndex =
    nextIndex;

  const nextTrack =
    currentQueue[nextIndex];

  try {
    await playTrackInternal(
      nextTrack.id,
      nextTrack.meta,
      true,
    );
  } catch {
    notify();
  }
}


function attachEvents() {
  [
    "play",
    "pause",
    "timeupdate",
    "durationchange",
    "volumechange",
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

  audio.addEventListener(
    "ended",
    () => {
      void playNextQueueTrack();
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


async function playTrackInternal(
  trackId,
  meta = {},
  keepQueue = false,
) {
  if (!trackId) {
    return;
  }

  if (!keepQueue) {
    clearQueue();
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

  const url =
    audioUrlForTrack(
      trackId,
    );

  await loadAudioSource(
    url,
  );

  audio.crossOrigin =
    "anonymous";

  audio.load();

  await audio.play();

  /*
   * Start warming the following track
   * as soon as the current one begins.
   */
  if (keepQueue) {
    warmNextQueueTrack();
  }

  if (
    currentTrackId &&
    getAccessToken()
  ) {
    void apiRequest(
      "/users/me/listening",
      {
        method: "POST",

        body: JSON.stringify({
          track_id:
            currentTrackId,
        }),
      },
    ).catch(() => {});
  }

  return getState();
}


export async function playTrack(
  trackId,
  meta = {},
) {
  return playTrackInternal(
    trackId,
    meta,
    false,
  );
}

export async function playQueueIndex(
  index,
) {
  const track =
    getQueueTrackAtIndex(
      currentQueue,
      index,
    );

  if (!track) {
    return false;
  }

  currentQueueIndex =
    index;

  try {
    await playTrackInternal(
      track.id,
      track.meta,
      true,
    );

    notify();

    return true;
  } catch (error) {
    notify();

    throw error;
  }
}

export async function playTrackQueue(
  tracks,
  startIndex = 0,
) {
  const queue =
    buildTrackQueue(
      tracks,
    );

  if (queue.length === 0) {
    clearQueue();
    return;
  }

  const requestedIndex =
    Number.isInteger(startIndex)
      ? startIndex
      : 0;

  const safeIndex =
    Math.min(
      Math.max(
        requestedIndex,
        0,
      ),
      queue.length - 1,
    );

  currentQueue =
    queue;

  currentQueueIndex =
    safeIndex;

  const track =
    currentQueue[
      currentQueueIndex
    ];

  return playTrackInternal(
    track.id,
    track.meta,
    true,
  );
}

export async function playUrl(
  url,
  meta = {},
) {
  if (!url) {
    return;
  }

  clearQueue();

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

  clearQueue();

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
      playTrackQueue,
      playQueueIndex,
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
