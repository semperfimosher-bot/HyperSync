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

let activeListeningEvent =
  null;

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

let lastMediaSessionSignature =
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

const AUTOPLAY_REFILL_THRESHOLD =
  2;

const AUTOPLAY_BATCH_SIZE =
  8;

let queueRevision =
  0;

let autoplayFill =
  null;

let playbackPhase =
  "idle";

let playbackError =
  null;

function beginListeningEvent(
  trackId,
) {
  if (!getAccessToken()) {
    activeListeningEvent =
      null;

    return;
  }

  const event = {
    trackId:
      String(trackId),

    eventId:
      null,

    request:
      null,
  };


  event.request =
    apiRequest(
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
    )
      .then(
        (data) =>
          data?.event_id ??
          null,
      )
      .catch(
        () => null,
      );


  activeListeningEvent =
    event;


  void event.request.then(
    (eventId) => {
      if (
        activeListeningEvent
        === event
      ) {
        event.eventId =
          eventId;
      }
    },
  );
}


function finishListeningEvent(
  outcome,
  positionSeconds =
    getSafeCurrentTime(),
) {
  const event =
    activeListeningEvent;

  if (!event) {
    return;
  }

  activeListeningEvent =
    null;


  void (
    async () => {
      const eventId =
        event.eventId ??
        await event.request;

      if (!eventId) {
        return;
      }

      await apiRequest(
        `/users/me/listening/${encodeURIComponent(
          eventId,
        )}`,
        {
          method:
            "PATCH",

          body:
            JSON.stringify({
              outcome,

              position_seconds:
                Math.max(
                  0,
                  Math.round(
                    positionSeconds ||
                    0,
                  ),
                ),
            }),
        },
      );
    }
  )().catch(
    () => {},
  );
}

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

    album:
      meta.album ??
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

  queueRevision +=
    1;
}

function upcomingQueueCount() {
  if (
    currentQueueIndex < 0
  ) {
    return 0;
  }

  return Math.max(
    currentQueue.length -
      currentQueueIndex -
      1,
    0,
  );
}


function ensureCurrentTrackInQueue() {
  if (
    currentQueue.length > 0 ||
    !currentTrackId ||
    !currentTrackMeta
  ) {
    return;
  }

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
  ];

  currentQueueIndex =
    0;
}


function appendAutoplayTracks(
  tracks,
) {
  const incoming =
    buildTrackQueue(
      tracks,
    );

  if (!incoming.length) {
    return 0;
  }

  const existing =
    new Set(
      currentQueue.map(
        (entry) =>
          String(
            entry.id,
          ),
      ),
    );


  const unique =
    incoming.filter(
      (entry) => {
        const id =
          String(
            entry.id,
          );

        if (
          existing.has(
            id,
          )
        ) {
          return false;
        }

        existing.add(
          id,
        );

        return true;
      },
    );


  if (!unique.length) {
    return 0;
  }


  currentQueue = [
    ...currentQueue,
    ...unique,
  ];

  notify();

  return unique.length;
}


async function ensureAutoplayQueue({
  force = false,
} = {}) {
  if (!currentTrackId) {
    return 0;
  }


  ensureCurrentTrackInQueue();


  if (
    !force &&
    upcomingQueueCount() >
      AUTOPLAY_REFILL_THRESHOLD
  ) {
    return 0;
  }


  const revision =
    queueRevision;


  if (
    autoplayFill?.revision ===
    revision
  ) {
    return autoplayFill.promise;
  }


  /*
   * Exclude all upcoming tracks plus
   * roughly the previous 24 songs.
   *
   * We intentionally do not exclude
   * everything forever, otherwise a
   * smaller catalog would eventually
   * run out completely.
   */
  const exclusionStart =
    Math.max(
      0,
      currentQueueIndex -
        24,
    );


  const excludeTrackIds =
    currentQueue
      .slice(
        exclusionStart,
      )
      .map(
        (entry) =>
          String(
            entry.id,
          ),
      )
      .slice(
        -100,
      );


  let requestPromise;


  requestPromise =
    (async () => {
      try {
        const tracks =
          await apiRequest(
            "/recommendations/autoplay",
            {
              method:
                "POST",

              body:
                JSON.stringify({
                  current_track_id:
                    String(
                      currentTrackId,
                    ),

                  exclude_track_ids:
                    excludeTrackIds,

                  limit:
                    AUTOPLAY_BATCH_SIZE,
                }),
            },
          );


        /*
         * The user selected a completely
         * different song/playlist while
         * recommendations were loading.
         */
        if (
          revision !==
          queueRevision
        ) {
          return 0;
        }


        return appendAutoplayTracks(
          Array.isArray(
            tracks,
          )
            ? tracks
            : [],
        );

      } catch {
        /*
         * Autoplay failure should never
         * break ordinary playback.
         */
        return 0;

      } finally {
        if (
          autoplayFill?.promise ===
          requestPromise
        ) {
          autoplayFill =
            null;
        }
      }
    })();


  autoplayFill = {
    revision,
    promise:
      requestPromise,
  };


  return requestPromise;
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


function updateMediaSession(
  state,
) {
  const mediaSession =
    globalThis.navigator
      ?.mediaSession;

  if (!mediaSession) {
    return;
  }

  try {
    if (
      state.trackId &&
      typeof globalThis.MediaMetadata ===
        "function"
    ) {
      const album =
        currentTrackMeta
          ?.album ??
        "";

      let artworkSrc =
        null;

      if (state.artworkUrl) {
        try {
          artworkSrc =
            new URL(
              state.artworkUrl,
              globalThis.location
                ?.href ??
                "https://hypersynced.invalid/",
            ).href;
        } catch {
          artworkSrc =
            null;
        }
      }

      const signature =
        JSON.stringify([
          state.trackId,
          state.title,
          state.artist,
          album,
          artworkSrc,
        ]);

      if (
        signature !==
        lastMediaSessionSignature
      ) {
        mediaSession.metadata =
          new globalThis.MediaMetadata({
            title:
              state.title ||
              "Unknown Track",
            artist:
              state.artist ||
              "Unknown Artist",
            album,
            artwork:
              artworkSrc
                ? [
                    {
                      src:
                        artworkSrc,
                    },
                  ]
                : [],
          });

        lastMediaSessionSignature =
          signature;
      }
    } else if (!state.trackId) {
      mediaSession.metadata =
        null;

      lastMediaSessionSignature =
        null;
    }

    mediaSession.playbackState =
      state.trackId
        ? (
            state.paused
              ? "paused"
              : "playing"
          )
        : "none";

    if (
      typeof mediaSession
        .setPositionState ===
        "function" &&
      Number.isFinite(
        state.duration,
      ) &&
      state.duration > 0 &&
      Number.isFinite(
        state.currentTime,
      )
    ) {
      mediaSession.setPositionState({
        duration:
          state.duration,
        playbackRate:
          audio.playbackRate ||
          1,
        position:
          Math.max(
            0,
            Math.min(
              state.currentTime,
              state.duration,
            ),
          ),
      });
    }
  } catch {
    // Media Session support varies by browser.
  }
}


function notify() {
  const state =
    getState();

  updateMediaSession(
    state,
  );

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
  let nextIndex =
    getNextQueueIndex(
      currentQueue,
      currentQueueIndex,
    );


  /*
   * Safety net.
   *
   * Normally recommendations are already
   * waiting before the final song ends.
   * If they are not, fetch them now.
   */
  if (
    nextIndex === -1
  ) {
    await ensureAutoplayQueue({
      force:
        true,
    });

    nextIndex =
      getNextQueueIndex(
        currentQueue,
        currentQueueIndex,
      );
  }


  if (
    nextIndex === -1
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


    /*
     * Refill BEFORE we hit the end.
     */
    void ensureAutoplayQueue()
      .catch(
        () => {},
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
    finishListeningEvent(
      "completed",
      Number.isFinite(
        audio.duration,
      )
        ? audio.duration
        : getSafeCurrentTime(),
    );

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
 * Start a backend listening session.
 *
 * beginListeningEvent already handles
 * authentication and performs the POST.
 */
beginListeningEvent(
  trackId,
);


return getState();
}

export async function playTrack(
  trackId,
  meta = {},
) {
  finishListeningEvent(
  "skipped",
  getSafeCurrentTime(),
);
  const state =
    await playTrackInternal(
      trackId,
      meta,
      false,
    );


  void ensureAutoplayQueue({
    force:
      true,
  }).catch(
    () => {},
  );


  return state;
}

export async function playQueueIndex(
  index,
) {
  finishListeningEvent(
  "skipped",
  getSafeCurrentTime(),
);
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


    void ensureAutoplayQueue()
      .catch(
        () => {},
      );


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
  finishListeningEvent(
  "skipped",
  getSafeCurrentTime(),
);
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
      queue.length - 1,
    );


  queueRevision +=
    1;


  currentQueue =
    queue;

  currentQueueIndex =
    safeIndex;


  const track =
    currentQueue[
      currentQueueIndex
    ];


  const state =
    await playTrackInternal(
      track.id,
      track.meta,
      true,
    );


  void ensureAutoplayQueue()
    .catch(
      () => {},
    );


  return state;
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
    skipToNext,
    skipToPrevious,
  };
}

export async function skipToNext() {
  if (!currentTrackId) {
    return false;
  }


  finishListeningEvent(
    "skipped",
    getSafeCurrentTime(),
  );


  await ensureAutoplayQueue({
    force:
      true,
  });


  await playNextQueueTrack();

  return true;
}



export async function skipToPrevious() {
  if (!currentTrackId) {
    return false;
  }

  if (
    getSafeCurrentTime() >
      5 ||
    currentQueueIndex <= 0
  ) {
    seekTo(
      0,
    );

    return true;
  }

  finishListeningEvent(
    "skipped",
    getSafeCurrentTime(),
  );

  await playQueueIndex(
    currentQueueIndex - 1,
  );

  return true;
}


function configureMediaSessionActions() {
  const mediaSession =
    globalThis.navigator
      ?.mediaSession;

  if (
    !mediaSession ||
    typeof mediaSession
      .setActionHandler !==
      "function"
  ) {
    return;
  }

  const setHandler =
    (
      action,
      handler,
    ) => {
      try {
        mediaSession.setActionHandler(
          action,
          handler,
        );
      } catch {
        // Some browsers expose only a subset.
      }
    };

  setHandler(
    "play",
    () => {
      if (audio.paused) {
        void togglePlay();
      }
    },
  );

  setHandler(
    "pause",
    () => {
      pausePlayback();
    },
  );

  setHandler(
    "nexttrack",
    () => {
      void skipToNext();
    },
  );

  setHandler(
    "previoustrack",
    () => {
      void skipToPrevious();
    },
  );

  setHandler(
    "seekbackward",
    (details) => {
      seekTo(
        Math.max(
          0,
          getSafeCurrentTime() -
            (
              details?.seekOffset ??
              10
            ),
        ),
      );
    },
  );

  setHandler(
    "seekforward",
    (details) => {
      seekTo(
        getSafeCurrentTime() +
          (
            details?.seekOffset ??
            10
          ),
      );
    },
  );

  setHandler(
    "seekto",
    (details) => {
      if (
        Number.isFinite(
          details?.seekTime,
        )
      ) {
        seekTo(
          details.seekTime,
        );
      }
    },
  );
}


configureMediaSessionActions();
