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

import {
  clearPersistedPlayerState,
  readPersistedPlayerState,
  writePersistedPlayerState,
} from "./playerPersistence.js";


const audio =
  new Audio();

audio.crossOrigin =
  "anonymous";

audio.preload =
  "auto";


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

let currentTrackMeta =
  null;


/*
 * When the application is refreshed,
 * this contains the position that the
 * restored song should return to.
 */
let restoredTimeSeconds =
  0;


/*
 * Prevent multiple callers from trying
 * to rebuild the same audio source at
 * the same time.
 */
let sourcePreparationPromise =
  null;


/*
 * timeupdate can fire many times per
 * second. Do not hammer localStorage.
 */
let lastPersistenceWriteAt =
  0;


let currentQueue =
  [];

let currentQueueIndex =
  -1;


let playbackPhase =
  "idle";

let playbackError =
  null;


function normalizeTrackMeta(
  meta = {},
) {
  return {
    audioUrl:
      meta.audioUrl ??
      meta.audio_url ??
      null,

    artworkUrl:
      meta.artworkUrl ??
      meta.artwork_url ??
      null,

    mimeType:
      meta.mimeType ??
      meta.mime_type ??
      null,

    fileSize:
      meta.fileSize ??
      meta.file_size ??
      null,

    mediaVersion:
      meta.mediaVersion ??
      meta.media_version ??
      null,

    title:
      meta.title ??
      "",

    artist:
      meta.artist ??
      "",
  };
}


function getSafeCurrentTime() {
  return Number.isFinite(
    audio.currentTime,
  )
    ? Math.max(
        audio.currentTime,
        0,
      )
    : 0;
}


function persistPlayerState({
  force = false,
  currentTime =
    getSafeCurrentTime(),
} = {}) {
  if (
    !currentTrackId ||
    !currentTrackMeta
  ) {
    return;
  }

  const now =
    Date.now();

  if (
    !force &&
    now -
      lastPersistenceWriteAt <
      1000
  ) {
    return;
  }

  lastPersistenceWriteAt =
    now;

  writePersistedPlayerState({
    trackId:
      currentTrackId,

    meta:
      currentTrackMeta,

    currentTime:
      Number.isFinite(
        currentTime,
      )
        ? Math.max(
            currentTime,
            0,
          )
        : 0,

    volume:
      audio.volume,

    muted:
      audio.muted,
  });
}


function hasAudioSource() {
  return Boolean(
    audio.currentSrc ||
    audio.getAttribute(
      "src",
    ),
  );
}

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

    persistPlayerState({
      force:
        true,
    });

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
    "timeupdate",
    () => {
      persistPlayerState();
    },
  );


  audio.addEventListener(
    "volumechange",
    () => {
      persistPlayerState({
        force:
          true,
      });
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
restorePersistedPlayerState();


function loadAudioSource(
  url,
) {
  audio.src =
    url;
}


async function ensureCurrentTrackSource() {
  /*
   * If a restore is already preparing
   * the source, a fast Play click should
   * wait for that same operation.
   */
  if (
    sourcePreparationPromise
  ) {
    return sourcePreparationPromise;
  }

  if (
    hasAudioSource() ||
    !currentTrackId ||
    !currentTrackMeta
  ) {
    return null;
  }


  const requestedTrackId =
    currentTrackId;

  const requestedMeta =
    currentTrackMeta;

  const requestedTime =
    restoredTimeSeconds;


  const session =
    beginPlaybackSession(
      requestedTrackId,
    );


  sourcePreparationPromise =
    (async () => {
      const useStableMediaRoute =
        Boolean(
          globalThis.navigator
            ?.serviceWorker
            ?.controller,
        );


      const audioSource =
        await prepareTrackAudioSource(
          requestedTrackId,
          requestedMeta,
          {
            useStableMediaRoute,
          },
        );


      if (
        !isPlaybackSessionCurrent(
          session,
        ) ||
        currentTrackId !==
          requestedTrackId
      ) {
        return null;
      }


      const url =
        resolveMediaUrl(
          audioSource,
        );


      if (!url) {
        throw new Error(
          "Unable to restore the track audio source.",
        );
      }


      loadAudioSource(
        url,
      );


      /*
       * If we have a saved position,
       * wait until seeking is legal before
       * resolving. That prevents a very
       * quick Play click from briefly
       * starting at 0:00.
       */
      if (
        requestedTime >
        0
      ) {
        await new Promise(
          (
            resolve,
            reject,
          ) => {
            const cleanup =
              () => {
                audio.removeEventListener(
                  "loadedmetadata",
                  handleLoaded,
                );

                audio.removeEventListener(
                  "error",
                  handleError,
                );
              };


            const handleLoaded =
              () => {
                cleanup();

                if (
                  !isPlaybackSessionCurrent(
                    session,
                  )
                ) {
                  resolve();
                  return;
                }

                const maximum =
                  Number.isFinite(
                    audio.duration,
                  )
                    ? audio.duration
                    : requestedTime;

                try {
                  audio.currentTime =
                    Math.max(
                      0,
                      Math.min(
                        requestedTime,
                        maximum,
                      ),
                    );
                } catch {
                  // Some browsers may reject
                  // an early seek. Playback
                  // can still continue.
                }

                resolve();
              };


            const handleError =
              () => {
                cleanup();

                reject(
                  new Error(
                    "Unable to preload the restored track.",
                  ),
                );
              };


            audio.addEventListener(
              "loadedmetadata",
              handleLoaded,
              {
                once:
                  true,
              },
            );

            audio.addEventListener(
              "error",
              handleError,
              {
                once:
                  true,
              },
            );


            audio.load();


            if (
              audio.readyState >=
              1
            ) {
              handleLoaded();
            }
          },
        );

      } else {
        audio.load();
      }


      if (
        !isPlaybackSessionCurrent(
          session,
        ) ||
        currentTrackId !==
          requestedTrackId
      ) {
        return null;
      }


      setPlaybackPhase(
        "paused",
      );

      notify();

      return getState();
    })()
      .finally(() => {
        sourcePreparationPromise =
          null;
      });


  return sourcePreparationPromise;
}


function restorePersistedPlayerState() {
  const saved =
    readPersistedPlayerState();

  if (
    !saved?.trackId
  ) {
    return;
  }


  const meta =
    normalizeTrackMeta(
      saved.meta,
    );


  currentTrackId =
    String(
      saved.trackId,
    );

  currentTrackMeta =
    meta;

  currentArtworkUrl =
    meta.artworkUrl;

  currentTrackTitle =
    meta.title;

  currentTrackArtist =
    meta.artist;


  const savedTime =
    Number(
      saved.currentTime,
    );

  restoredTimeSeconds =
    Number.isFinite(
      savedTime,
    )
      ? Math.max(
          savedTime,
          0,
        )
      : 0;


  const savedVolume =
    Number(
      saved.volume,
    );

  if (
    Number.isFinite(
      savedVolume,
    )
  ) {
    audio.volume =
      Math.max(
        0,
        Math.min(
          1,
          savedVolume,
        ),
      );
  }


  if (
    typeof saved.muted ===
    "boolean"
  ) {
    audio.muted =
      saved.muted;
  }


  /*
   * A restored player is ALWAYS paused.
   * Browsers should never auto-resume
   * music after a refresh.
   */
  setPlaybackPhase(
    "paused",
  );

  notify();


  /*
   * Start rebuilding/loading the media
   * immediately, but do NOT call play().
   */
  void ensureCurrentTrackSource()
    .catch(() => {
      /*
       * Keep the restored bar usable even
       * if preload temporarily fails.
       * togglePlay() will retry.
       */
      if (
        currentTrackId
      ) {
        setPlaybackPhase(
          "paused",
        );

        notify();
      }
    });
}


function applyTrackMetadata(
  trackId,
  meta,
) {
  const normalizedMeta =
    normalizeTrackMeta(
      meta,
    );

  currentTrackId =
    String(
      trackId,
    );

  currentTrackMeta =
    normalizedMeta;

  currentArtworkUrl =
    normalizedMeta.artworkUrl;

  currentTrackTitle =
    normalizedMeta.title;

  currentTrackArtist =
    normalizedMeta.artist;

  restoredTimeSeconds =
    0;

  setPlaybackPhase(
    "loading",
  );

  /*
   * Save the selected track immediately.
   * This means even an immediate refresh
   * still restores the player bar.
   */
  persistPlayerState({
    force:
      true,

    currentTime:
      0,
  });

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

export function addTrackToQueue(
  track,
) {
  const entries =
    buildTrackQueue([
      track,
    ]);

  const entry =
    entries[0];

  if (!entry) {
    return false;
  }

  /*
   * If a song is already playing outside
   * a queue, turn the current song into
   * the first queue item before adding
   * the new song.
   */
  if (
    currentQueue.length === 0 &&
    currentTrackId &&
    currentTrackMeta
  ) {
    currentQueue = [
      {
        id:
          String(
            currentTrackId,
          ),

        meta: {
          ...currentTrackMeta,
        },
      },

      entry,
    ];

    currentQueueIndex = 0;
  } else {
    currentQueue = [
      ...currentQueue,
      entry,
    ];
  }

  notify();

  return true;
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

  currentTrackMeta =
  null;

  restoredTimeSeconds =
  0;

  clearPersistedPlayerState();

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
    /*
     * Normally this has already been
     * preloaded during restoration.
     *
     * If the user clicks extremely fast,
     * or preload previously failed,
     * prepare it now.
     */
    await ensureCurrentTrackSource();


    if (
      !hasAudioSource()
    ) {
      return getState();
    }


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


export function pausePlayback() {
  if (
    !audio.paused
  ) {
    audio.pause();
  }


  if (
    currentTrackId ||
    hasAudioSource()
  ) {
    setPlaybackPhase(
      "paused",
    );
  }


  persistPlayerState({
    force:
      true,
  });


  notify();

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

currentTrackMeta =
  null;

currentArtworkUrl =
  null;

currentTrackTitle =
  "";

currentTrackArtist =
  "";

restoredTimeSeconds =
  0;

clearPersistedPlayerState();


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

  persistPlayerState({
    force:
      true,
  });

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

  persistPlayerState({
    force:
      true,
  });

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
    addTrackToQueue,
    playQueueIndex,
    playUrl,
    pausePlayback,
    togglePlay,
    stopTrack,
    seekTo,
    setVolume,
    getState,
    subscribe,
    _getAudioElement,
  };
}
