import {
  apiRequest,
} from "./api/client.js";

import {
  getAccessToken,
} from "./api/storage.js";

import {
  resolveMediaUrl,
} from "./mediaCache.js";

import {
  buildTrackQueue,
  getNextQueueIndex,
  getQueueTrackAtIndex,
} from "./playerQueue.js";

import {
  prepareTrackAudioSource,
  recordTrackPlayback,
} from "./mediaPlayback.js";

import {
  beginPlaybackSession,
  cancelActivePlaybackSession,
  isPlaybackSessionCurrent,
} from "./player/playbackSession.js";


const audio =
  new Audio();

audio.crossOrigin =
  "anonymous";


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


let currentQueue =
  [];

let currentQueueIndex =
  -1;


let playbackPhase =
  "idle";

let playbackError =
  null;


function clearQueue() {
  currentQueue =
    [];

  currentQueueIndex =
    -1;
}


function setPlaybackPhase(
  phase,
  error = null,
) {
  playbackPhase =
    phase;

  playbackError =
    error;
}


function notify() {
  const state =
    getState();

  subscribers.forEach(
    (cb) => {
      try {
        cb(state);
      } catch {
        // Subscriber failures must never
        // interrupt playback.
      }
    },
  );
}


export function subscribe(
  cb,
) {
  subscribers.add(
    cb,
  );

  try {
    cb(
      getState(),
    );
  } catch {
    // Ignore subscriber errors.
  }

  return () => {
    subscribers.delete(
      cb,
    );
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

    phase:
      playbackPhase,

    error:
      playbackError,

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

  if (
    nextIndex ===
    -1
  ) {
    notify();
    return;
  }

  currentQueueIndex =
    nextIndex;

  const nextTrack =
    currentQueue[
      nextIndex
    ];

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
  audio.addEventListener(
    "loadstart",
    () => {
      if (currentTrackId) {
        setPlaybackPhase(
          "loading",
        );
      }

      notify();
    },
  );


  audio.addEventListener(
    "playing",
    () => {
      setPlaybackPhase(
        "playing",
      );

      notify();
    },
  );


  audio.addEventListener(
    "play",
    () => {
      if (
        playbackPhase !==
        "playing"
      ) {
        setPlaybackPhase(
          "loading",
        );
      }

      notify();
    },
  );


  audio.addEventListener(
    "pause",
    () => {
      if (
        currentTrackId ||
        audio.currentSrc
      ) {
        setPlaybackPhase(
          "paused",
        );
      }

      notify();
    },
  );


  audio.addEventListener(
    "waiting",
    () => {
      if (!audio.paused) {
        setPlaybackPhase(
          "buffering",
        );
      }

      notify();
    },
  );


  audio.addEventListener(
    "stalled",
    () => {
      if (!audio.paused) {
        setPlaybackPhase(
          "buffering",
        );
      }

      notify();
    },
  );


  audio.addEventListener(
    "seeking",
    () => {
      setPlaybackPhase(
        "buffering",
      );

      notify();
    },
  );


  audio.addEventListener(
    "seeked",
    () => {
      setPlaybackPhase(
        audio.paused
          ? "paused"
          : "playing",
      );

      notify();
    },
  );


  [
    "timeupdate",
    "durationchange",
    "volumechange",
    "loadedmetadata",
  ].forEach(
    (eventName) => {
      audio.addEventListener(
        eventName,
        notify,
      );
    },
  );


  audio.addEventListener(
    "error",
    () => {
      setPlaybackPhase(
        "error",
        audio.error?.message ??
          "Audio playback failed.",
      );

      notify();
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


function loadAudioSource(
  url,
) {
  audio.src =
    url;
}


function applyTrackMetadata(
  trackId,
  meta,
) {
  const {
    artworkUrl = null,
    title = "",
    artist = "",
  } = meta;

  currentTrackId =
    String(
      trackId,
    );

  currentArtworkUrl =
    artworkUrl;

  currentTrackTitle =
    title;

  currentTrackArtist =
    artist;

  setPlaybackPhase(
    "loading",
  );

  notify();
}


async function playTrackInternal(
  trackId,
  meta = {},
  keepQueue = false,
) {
  if (!trackId) {
    return null;
  }


  const session =
    beginPlaybackSession(
      trackId,
    );


  if (!keepQueue) {
    clearQueue();
  }


  /*
   * Updating the metadata immediately
   * gives the UI instant feedback after
   * the user selects a song.
   *
   * The playback session prevents an
   * older async request from later
   * taking ownership of the player.
   */
  applyTrackMetadata(
    trackId,
    meta,
  );


  const useStableMediaRoute =
    Boolean(
      globalThis.navigator
        ?.serviceWorker
        ?.controller,
    );


  let audioSource;

  try {
    audioSource =
      await prepareTrackAudioSource(
        trackId,
        meta,
        {
          useStableMediaRoute,
        },
      );
  } catch (error) {
    if (
      !isPlaybackSessionCurrent(
        session,
      )
    ) {
      return null;
    }

    setPlaybackPhase(
      "error",
      error instanceof Error
        ? error.message
        : "Unable to prepare playback.",
    );

    notify();

    throw error;
  }


  /*
   * A newer song was selected while
   * this one was preparing.
   *
   * From this point onward the stale
   * request is not allowed to touch the
   * shared Audio element.
   */
  if (
    !isPlaybackSessionCurrent(
      session,
    )
  ) {
    return null;
  }


  const url =
    resolveMediaUrl(
      audioSource,
    );


  if (!url) {
    const error =
      new Error(
        "Unable to resolve the track audio source.",
      );

    setPlaybackPhase(
      "error",
      error.message,
    );

    notify();

    throw error;
  }


  loadAudioSource(
    url,
  );

  audio.load();


  try {
    await audio.play();
  } catch (error) {
    /*
     * Changing audio.src for a newer
     * playback request may reject the
     * previous play() promise.
     *
     * That is expected. A stale request
     * must quietly disappear rather than
     * turning into a visible player error.
     */
    if (
      !isPlaybackSessionCurrent(
        session,
      )
    ) {
      return null;
    }

    setPlaybackPhase(
      "error",
      error instanceof Error
        ? error.message
        : "Unable to start playback.",
    );

    notify();

    throw error;
  }


  if (
    !isPlaybackSessionCurrent(
      session,
    )
  ) {
    return null;
  }


  /*
   * Cache-retention bookkeeping must not
   * block or break successful playback.
   */
  void recordTrackPlayback(
    trackId,
    meta,
  ).catch(
    () => {},
  );


  /*
   * IMPORTANT:
   *
   * Use this playback request's immutable
   * trackId, never the mutable global
   * currentTrackId.
   *
   * Otherwise a rapid A → B selection
   * could record B for A's old request.
   */
  if (
    getAccessToken()
  ) {
    void apiRequest(
      "/users/me/listening",
      {
        method:
          "POST",

        body:
          JSON.stringify({
            track_id:
              String(
                trackId,
              ),
          }),
      },
    ).catch(
      () => {},
    );
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
    const state =
      await playTrackInternal(
        track.id,
        track.meta,
        true,
      );

    notify();

    return state ??
      false;
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


  if (
    queue.length ===
    0
  ) {
    cancelActivePlaybackSession();

    clearQueue();

    return null;
  }


  const requestedIndex =
    Number.isInteger(
      startIndex,
    )
      ? startIndex
      : 0;


  const safeIndex =
    Math.min(
      Math.max(
        requestedIndex,
        0,
      ),
      queue.length -
        1,
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
    return null;
  }


  const session =
    beginPlaybackSession(
      null,
    );


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


  setPlaybackPhase(
    "loading",
  );

  notify();


  const mediaUrl =
    resolveMediaUrl(
      url,
    );


  if (
    !isPlaybackSessionCurrent(
      session,
    )
  ) {
    return null;
  }


  loadAudioSource(
    mediaUrl,
  );

  audio.load();


  try {
    await audio.play();
  } catch (error) {
    if (
      !isPlaybackSessionCurrent(
        session,
      )
    ) {
      return null;
    }

    setPlaybackPhase(
      "error",
      error instanceof Error
        ? error.message
        : "Unable to start playback.",
    );

    notify();

    throw error;
  }


  if (
    !isPlaybackSessionCurrent(
      session,
    )
  ) {
    return null;
  }


  return getState();
}


export async function togglePlay() {
  if (audio.paused) {
    setPlaybackPhase(
      "loading",
    );

    notify();

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


  cancelActivePlaybackSession();


  audio.pause();


  clearQueue();


  audio.removeAttribute(
    "src",
  );

  audio.load();


  currentTrackId =
    null;

  currentArtworkUrl =
    null;

  currentTrackTitle =
    "";

  currentTrackArtist =
    "";


  setPlaybackPhase(
    "idle",
  );


  notify();


  return true;
}


export function seekTo(
  timeSeconds,
) {
  if (
    typeof timeSeconds !==
      "number" ||
    !Number.isFinite(
      timeSeconds,
    )
  ) {
    return;
  }


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


export function setVolume(
  value,
) {
  audio.volume =
    Math.max(
      0,
      Math.min(
        1,
        value,
      ),
    );


  notify();
}


export function _getAudioElement() {
  return audio;
}


if (
  typeof window !==
  "undefined" &&
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
