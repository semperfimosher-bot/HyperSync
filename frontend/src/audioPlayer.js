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
  appendQueueEntry,
  buildTrackQueue,
  catalogTrackIdOrNull,
  filterCatalogTrackIds,
  getNextQueueIndex,
  getQueueTrackAtIndex,
  insertQueueEntryAsNext,
} from "./playerQueue.js";

import {
  prepareTrackAudioSource,
  recordTrackPlayback,
  warmTrackPlayback,
} from "./mediaPlayback.js";

import {
  beginPlaybackSession,
  cancelActivePlaybackSession,
  canReuseLoadedAudioSource,
  isPlaybackSessionCurrent,
} from "./player/playbackSession.js";

import {
  mediaSessionIdentity,
  mediaSessionPlaybackState,
} from "./player/mediaSessionState.js";

import {
  clearPersistedPlayerState,
  readPersistedPlayerState,
  writePersistedPlayerState,
} from "./playerPersistence.js";

import {
  notifyListeningHistoryChanged,
} from "./homeRecentlyPlayed.js";

import {
  isOnDemandTrackId,
  onDemandPollDelay,
} from "./onDemandMusic.js";


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

let activeObjectUrl =
  null;

let loadedAudioTrackId =
  null;

let warmPlaybackTask =
  null;

let warmPlaybackTaskKey =
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

let sourcePreparationTrackId =
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

let recentTrackIds =
  [];

const AUTOPLAY_REFILL_THRESHOLD =
  4;

const AUTOPLAY_BATCH_SIZE =
  12;

const AUTOPLAY_CONTEXT_SIZE =
  12;

let queueRevision =
  0;

let autoplayFill =
  null;

let nextTrackTransitionPromise =
  null;

let playbackPhase =
  "idle";

let playbackError =
  null;

let remotePlaybackController =
  null;

let forceLocalPlaybackDepth =
  0;

const queuedAudioWarmups =
  new Map();


function warmQueuedAudioEntry(
  entry,
) {
  if (
    !entry?.id ||
    !entry?.meta?.audioUrl ||
    (
      !entry.meta.onDemand &&
      !isOnDemandTrackId(
        entry.id,
      )
    ) ||
    typeof globalThis.fetch !==
      "function"
  ) {
    return null;
  }

  const source =
    resolveMediaUrl(
      entry.meta.audioUrl,
    );

  if (!source) {
    return null;
  }

  const key = [
    String(
      entry.id,
    ),
    source,
  ].join(
    "|",
  );

  const existing =
    queuedAudioWarmups.get(
      key,
    );

  if (existing) {
    return existing;
  }

  const task =
    (async () => {
      try {
        const response =
          await globalThis.fetch(
            source,
            {
              method:
                "GET",
              headers: {
                Range:
                  "bytes=0-524287",
              },
              credentials:
                "include",
            },
          );

        if (
          !response?.ok &&
          response?.status !==
            206
        ) {
          return false;
        }

        const reader =
          response.body
            ?.getReader?.();

        if (reader) {
          try {
            await reader.read();
          } finally {
            await reader.cancel()
              .catch(
                () => {},
              );
          }
        }

        return true;
      } catch {
        return false;
      } finally {
        queuedAudioWarmups.delete(
          key,
        );
      }
    })();

  queuedAudioWarmups.set(
    key,
    task,
  );

  return task;
}


export function setRemotePlaybackController(
  controller,
) {
  remotePlaybackController =
    controller &&
    typeof controller ===
      "object"
      ? controller
      : null;
}


export async function runWithLocalPlaybackControl(
  callback,
) {
  forceLocalPlaybackDepth +=
    1;

  try {
    return await callback();
  } finally {
    forceLocalPlaybackDepth =
      Math.max(
        forceLocalPlaybackDepth -
          1,
        0,
      );
  }
}


function shouldRoutePlaybackRemotely() {
  if (
    forceLocalPlaybackDepth >
      0 ||
    !remotePlaybackController
  ) {
    return false;
  }

  try {
    return Boolean(
      remotePlaybackController
        .shouldHandle?.(),
    );
  } catch {
    return false;
  }
}


async function dispatchRemotePlayback(
  action,
  payload = null,
) {
  if (
    !shouldRoutePlaybackRemotely()
  ) {
    return false;
  }

  try {
    await remotePlaybackController
      .dispatch?.(
        action,
        payload,
      );
  } catch {
    /*
     * Never fall through to local audio
     * after a remote-control failure.
     * The selected playback device remains
     * authoritative until the user changes it.
     */
  }

  return true;
}


function dispatchRemotePlaybackInBackground(
  action,
  payload = null,
) {
  if (
    !shouldRoutePlaybackRemotely()
  ) {
    return false;
  }

  try {
    void Promise.resolve(
      remotePlaybackController
        .dispatch?.(
          action,
          payload,
        ),
    ).catch(
      () => {},
    );
  } catch {
    // Keep the local speaker silent.
  }

  return true;
}


function promoteOnDemandPlayback(
  provisionId,
  trackId,
) {
  const permanentTrackId =
    String(
      trackId ?? "",
    ).trim();

  if (
    !permanentTrackId ||
    !provisionId ||
    currentTrackMeta
      ?.provisionId !==
      provisionId
  ) {
    return false;
  }

  const previousTrackId =
    currentTrackId;

  const catalogAudioUrl =
    "/api/audio/" +
    encodeURIComponent(
      permanentTrackId,
    );

  currentTrackId =
    permanentTrackId;

  currentTrackMeta =
    normalizeTrackMeta({
      ...currentTrackMeta,
      audioUrl:
        catalogAudioUrl,
      onDemand:
        false,
      catalogTrackId:
        permanentTrackId,
    });

  if (
    loadedAudioTrackId ===
      previousTrackId
  ) {
    loadedAudioTrackId =
      permanentTrackId;
  }

  let queueChanged =
    false;

  currentQueue =
    currentQueue.map(
      (entry) => {
        if (
          String(
            entry?.id ?? "",
          ) !==
            String(
              previousTrackId ?? "",
            )
        ) {
          return entry;
        }

        queueChanged =
          true;

        return {
          id:
            permanentTrackId,
          meta:
            normalizeTrackMeta({
              ...(entry?.meta ?? {}),
              ...currentTrackMeta,
              audioUrl:
                catalogAudioUrl,
              onDemand:
                false,
              catalogTrackId:
                permanentTrackId,
            }),
        };
      },
    );

  if (queueChanged) {
    queueRevision +=
      1;
  }

  rememberAutoplayTrack(
    permanentTrackId,
  );

  persistPlayerState({
    force:
      true,
  });

  notify();

  void ensureAutoplayQueue({
    force:
      true,
  }).catch(
    () => {},
  );

  return true;
}


function waitForOnDemandHistory(
  provisionId,
  attempts = 0,
  consecutiveFailures = 0,
) {
  if (
    !provisionId ||
    attempts >= 80
  ) {
    return;
  }

  globalThis.setTimeout?.(
    async () => {
      let nextFailures =
        consecutiveFailures;

      try {
        const status =
          await apiRequest(
            `/on-demand/${encodeURIComponent(
              provisionId,
            )}/status`,
          );

        if (
          status?.state ===
            "ready"
        ) {
          if (
            status?.track_id
          ) {
            promoteOnDemandPlayback(
              provisionId,
              status.track_id,
            );
          }

          notifyListeningHistoryChanged();
          return;
        }

        if (
          status?.state ===
            "failed"
        ) {
          return;
        }

        nextFailures = 0;
      } catch (error) {
        const statusCode =
          Number(
            error?.status ??
            0,
          );

        if (
          statusCode === 404 ||
          statusCode === 410
        ) {
          return;
        }

        nextFailures =
          Math.min(
            consecutiveFailures + 1,
            5,
          );
      }

      waitForOnDemandHistory(
        provisionId,
        attempts + 1,
        nextFailures,
      );
    },
    onDemandPollDelay(
      consecutiveFailures,
    ),
  );
}

function beginListeningEvent(
  trackId,
  meta = {},
) {
  if (!getAccessToken()) {
    activeListeningEvent =
      null;

    return;
  }

  const provisional =
    isOnDemandTrackId(
      trackId,
    )
    || Boolean(
      meta?.onDemand ??
      meta?.on_demand ??
      false,
    );

  if (provisional) {
    activeListeningEvent =
      null;

    const provisionId =
      meta?.provisionId ??
      meta?.provision_id ??
      null;

    if (!provisionId) {
      return;
    }

    void apiRequest(
      `/on-demand/${encodeURIComponent(
        provisionId,
      )}/played`,
      {
        method:
          "POST",
      },
    )
      .then(
        (data) => {
          if (
            data?.recorded
          ) {
            if (
              data?.track_id
            ) {
              promoteOnDemandPlayback(
                provisionId,
                data.track_id,
              );
            }

            notifyListeningHistoryChanged();
            return;
          }

          if (
            data?.pending
          ) {
            waitForOnDemandHistory(
              provisionId,
            );
          }
        },
      )
      .catch(
        () => {},
      );

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
        (data) => {
          const eventId =
            data?.event_id ??
            null;

          if (eventId) {
            notifyListeningHistoryChanged();
          }

          return eventId;
        },
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

    artworkVersion:
      meta.artworkVersion ??
      meta.artwork_version ??
      null,

    durationSeconds:
      meta.durationSeconds ??
      meta.duration_seconds ??
      null,

    onDemand:
      Boolean(
        meta.onDemand ??
        meta.on_demand ??
        false,
      ),

    provisionKey:
      meta.provisionKey ??
      meta.provision_key ??
      null,

    provisionId:
      meta.provisionId ??
      meta.provision_id ??
      null,

    catalogTrackId:
      meta.catalogTrackId ??
      meta.catalog_track_id ??
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


function applyRemoteSelectionShadow(
  trackId,
  meta = {},
  queue = null,
  queueIndex = 0,
) {
  if (!trackId) {
    return;
  }

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

  if (
    Array.isArray(
      queue,
    ) &&
    queue.length > 0
  ) {
    currentQueue =
      queue.map(
        (entry) => ({
          id:
            String(
              entry.id,
            ),
          meta: {
            ...entry.meta,
          },
        }),
      );

    currentQueueIndex =
      Math.min(
        Math.max(
          Number.isInteger(
            queueIndex,
          )
            ? queueIndex
            : 0,
          0,
        ),
        currentQueue.length - 1,
      );
  } else {
    currentQueue = [
      {
        id:
          String(
            trackId,
          ),
        meta:
          normalizedMeta,
      },
    ];

    currentQueueIndex =
      0;
  }

  queueRevision +=
    1;

  rememberAutoplayTrack(
    currentTrackId,
  );

  notify();
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

  if (
    isOnDemandTrackId(
      currentTrackId,
    )
    || currentTrackMeta
      ?.onDemand
  ) {
    clearPersistedPlayerState();

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

    recentTrackIds: [
      ...recentTrackIds,
    ],
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


function appendRecentContextId(
  ids,
  value,
) {
  const id =
    String(
      value ?? "",
    ).trim();

  if (!id) {
    return;
  }

  const existingIndex =
    ids.indexOf(
      id,
    );

  if (
    existingIndex >= 0
  ) {
    ids.splice(
      existingIndex,
      1,
    );
  }

  ids.push(
    id,
  );
}


function rememberAutoplayTrack(
  trackId,
) {
  const next = [
    ...recentTrackIds,
  ];

  appendRecentContextId(
    next,
    trackId,
  );

  recentTrackIds =
    next.slice(
      -AUTOPLAY_CONTEXT_SIZE,
    );
}


function getAutoplayContextTrackIds() {
  const ids = [];

  for (
    const id
    of recentTrackIds
  ) {
    appendRecentContextId(
      ids,
      id,
    );
  }

  if (
    currentQueue.length >
      0 &&
    currentQueueIndex >= 0
  ) {
    const startIndex =
      Math.max(
        0,
        currentQueueIndex -
          (
            AUTOPLAY_CONTEXT_SIZE -
            1
          ),
      );

    for (
      const entry
      of currentQueue.slice(
        startIndex,
        currentQueueIndex + 1,
      )
    ) {
      appendRecentContextId(
        ids,
        entry?.id,
      );
    }
  }

  if (currentTrackId) {
    appendRecentContextId(
      ids,
      currentTrackId,
    );
  }

  return ids.slice(
    -AUTOPLAY_CONTEXT_SIZE,
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
  if (
    !currentTrackId ||
    isOnDemandTrackId(
      currentTrackId,
    ) ||
    currentTrackMeta
      ?.onDemand
  ) {
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
    [];

  for (
    const id
    of recentTrackIds
  ) {
    appendRecentContextId(
      excludeTrackIds,
      id,
    );
  }

  for (
    const entry
    of currentQueue.slice(
      exclusionStart,
    )
  ) {
    appendRecentContextId(
      excludeTrackIds,
      entry?.id,
    );
  }

  excludeTrackIds.splice(
    0,
    Math.max(
      excludeTrackIds.length -
        100,
      0,
    ),
  );

  const autoplayCurrentTrackId =
    catalogTrackIdOrNull(
      currentTrackMeta
        ?.catalogTrackId,
    ) ??
    catalogTrackIdOrNull(
      currentTrackId,
    );

  const autoplayExcludeTrackIds =
    filterCatalogTrackIds(
      excludeTrackIds,
      100,
    );

  const autoplayContextTrackIds =
    filterCatalogTrackIds(
      getAutoplayContextTrackIds(),
      AUTOPLAY_CONTEXT_SIZE,
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
                    autoplayCurrentTrackId,

                  exclude_track_ids:
                    autoplayExcludeTrackIds,

                  context_track_ids:
                    autoplayContextTrackIds,

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

function isExpectedPlayInterruption(
  error,
) {
  if (!error) {
    return false;
  }

  if (
    error.name ===
      "AbortError"
  ) {
    return true;
  }

  const message =
    String(
      error.message ??
        error,
    ).toLowerCase();

  return (
    message.includes(
      "play() request was interrupted",
    ) ||
    message.includes(
      "interrupted by a new load request",
    )
  );
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

  const identity = mediaSessionIdentity(
    state,
    audio.getAttribute("src"),
  );

  try {
    if (
      identity &&
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
          identity,
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
    } else if (!identity) {
      mediaSession.metadata =
        null;

      lastMediaSessionSignature =
        null;
    }

    mediaSession.playbackState =
      mediaSessionPlaybackState(
        state,
        audio.getAttribute("src"),
      );

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

    album:
      currentTrackMeta?.album ??
      "",

    mimeType:
      currentTrackMeta?.mimeType ??
      null,

    fileSize:
      currentTrackMeta?.fileSize ??
      null,

    mediaVersion:
      currentTrackMeta?.mediaVersion ??
      null,

    artworkVersion:
      currentTrackMeta?.artworkVersion ??
      null,

    durationSeconds:
      currentTrackMeta?.durationSeconds ??
      null,

    catalogTrackId:
      currentTrackMeta?.catalogTrackId ??
      null,

    queue:
      currentQueue,

    queueIndex:
      currentQueueIndex,
  };
}


async function playNextQueueTrack() {
  if (
    nextTrackTransitionPromise
  ) {
    return nextTrackTransitionPromise;
  }

  let transitionPromise;

  transitionPromise =
    (async () => {
      let nextIndex =
        getNextQueueIndex(
          currentQueue,
          currentQueueIndex,
        );


      /*
       * Autoplay is normally filled while
       * the current song is still playing.
       * This forced refill is only the
       * final safety net for a brand-new
       * single-track playback context.
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

        return false;
      }


      currentQueueIndex =
        nextIndex;


      const nextTrack =
        currentQueue[
          nextIndex
        ];


      try {
        const state =
          await playTrackInternal(
            nextTrack.id,
            nextTrack.meta,
            true,
          );

        /*
         * Keep several songs ready ahead of
         * the active one. That makes the
         * natural ended -> next transition
         * immediate regardless of which page
         * originally started playback.
         */
        void ensureAutoplayQueue()
          .catch(
            () => {},
          );

        return Boolean(
          state,
        );

      } catch (error) {
        if (
          !isExpectedPlayInterruption(
            error,
          )
        ) {
          notify();
        }

        return false;
      }
    })()
      .finally(
        () => {
          if (
            nextTrackTransitionPromise ===
              transitionPromise
          ) {
            nextTrackTransitionPromise =
              null;
          }
        },
      );

  nextTrackTransitionPromise =
    transitionPromise;

  return transitionPromise;
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

    void playNextQueueTrack()
      .catch(
        () => {},
      );
  },
);
}


attachEvents();
restorePersistedPlayerState();


function handleBackgroundPlaybackLifecycle() {
  const hidden =
    globalThis.document
      ?.visibilityState ===
      "hidden";

  persistPlayerState({
    force:
      true,
  });

  updateMediaSession(
    getState(),
  );

  if (
    currentTrackId &&
    !audio.paused
  ) {
    void ensureAutoplayQueue()
      .catch(
        () => {},
      );

    if (hidden) {
      void Promise.resolve(
        warmCurrentTrackForResume(),
      ).catch(
        () => {},
      );
    }
  }

  if (!hidden) {
    notify();
  }
}


if (
  globalThis.document
    ?.addEventListener
) {
  globalThis.document.addEventListener(
    "visibilitychange",
    handleBackgroundPlaybackLifecycle,
  );
}

if (
  globalThis.addEventListener
) {
  globalThis.addEventListener(
    "pagehide",
    handleBackgroundPlaybackLifecycle,
  );

  globalThis.addEventListener(
    "pageshow",
    handleBackgroundPlaybackLifecycle,
  );
}


function warmCurrentTrackForResume() {
  if (
    !currentTrackId ||
    !currentTrackMeta
  ) {
    return null;
  }

  const mediaVersion =
    currentTrackMeta
      .mediaVersion ??
    currentTrackMeta
      .media_version ??
    null;

  if (!mediaVersion) {
    return null;
  }

  const position =
    getSafeCurrentTime();

  const duration =
    Number.isFinite(
      audio.duration,
    ) &&
    audio.duration > 0
      ? audio.duration
      : Number(
          currentTrackMeta
            .durationSeconds ??
          currentTrackMeta
            .duration_seconds ??
          0,
        );

  const taskKey = [
    currentTrackId,
    mediaVersion,
    Math.floor(
      position /
      20,
    ),
  ].join(
    ":",
  );

  if (
    warmPlaybackTask &&
    warmPlaybackTaskKey ===
      taskKey
  ) {
    return warmPlaybackTask;
  }

  const useStableMediaRoute =
    Boolean(
      globalThis.navigator
        ?.serviceWorker
        ?.controller,
    );

  warmPlaybackTaskKey =
    taskKey;

  warmPlaybackTask =
    warmTrackPlayback(
      currentTrackId,
      currentTrackMeta,
      {
        positionSeconds:
          position,

        durationSeconds:
          duration,

        useStableMediaRoute,
      },
    )
      .catch(
        () => null,
      )
      .finally(
        () => {
          if (
            warmPlaybackTaskKey ===
              taskKey
          ) {
            warmPlaybackTask =
              null;

            warmPlaybackTaskKey =
              null;
          }
        },
      );

  return warmPlaybackTask;
}


function loadAudioSource(
  url,
  trackId =
    currentTrackId,
) {
  if (
    activeObjectUrl &&
    activeObjectUrl !==
      url &&
    typeof globalThis.URL
      ?.revokeObjectURL ===
      "function"
  ) {
    globalThis.URL
      .revokeObjectURL(
        activeObjectUrl,
      );
  }

  activeObjectUrl =
    typeof url ===
      "string" &&
    url.startsWith(
      "blob:",
    )
      ? url
      : null;

  loadedAudioTrackId =
    trackId === null ||
    trackId === undefined
      ? null
      : (
          String(
            trackId,
          ).trim()
          || null
        );

  audio.src =
    url;
}


async function ensureCurrentTrackSource() {
  /*
   * If a restore is already preparing
   * the source, a fast Play click should
   * wait for that same operation.
   */
  const currentId =
    currentTrackId === null ||
    currentTrackId === undefined
      ? null
      : String(
          currentTrackId,
        );

  if (
    sourcePreparationPromise &&
    sourcePreparationTrackId ===
      currentId
  ) {
    return sourcePreparationPromise;
  }

  if (
    sourcePreparationPromise &&
    sourcePreparationTrackId !==
      currentId
  ) {
    cancelActivePlaybackSession();

    sourcePreparationPromise =
      null;

    sourcePreparationTrackId =
      null;
  }

  if (
    canReuseLoadedAudioSource({
      logicalTrackId:
        currentTrackId,
      loadedTrackId:
        loadedAudioTrackId,
      hasSource:
        hasAudioSource(),
    }) ||
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
            preferCachedBlob:
              !useStableMediaRoute &&
              globalThis.navigator
                ?.onLine ===
                false,
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
        requestedTrackId,
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
    })();

  sourcePreparationTrackId =
    requestedTrackId;

  const trackedPromise =
    sourcePreparationPromise;

  sourcePreparationPromise =
    trackedPromise.finally(
      () => {
        if (
          sourcePreparationTrackId ===
            requestedTrackId
        ) {
          sourcePreparationPromise =
            null;

          sourcePreparationTrackId =
            null;
        }
      },
    );


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


  recentTrackIds =
    [];

  for (
    const trackId
    of (
      Array.isArray(
        saved.recentTrackIds,
      )
        ? saved.recentTrackIds
        : []
    )
  ) {
    rememberAutoplayTrack(
      trackId,
    );
  }


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

  rememberAutoplayTrack(
    currentTrackId,
  );


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


  void ensureAutoplayQueue({
    force:
      true,
  }).catch(
    () => {},
  );


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


async function resolveOnDemandPlaybackMeta(
  trackId,
  meta = {},
) {
  const normalized =
    normalizeTrackMeta(
      meta,
    );

  const provisional =
    isOnDemandTrackId(
      trackId,
    )
    || normalized.onDemand;

  if (
    !provisional ||
    normalized.audioUrl
  ) {
    return normalized;
  }

  const candidateKey =
    normalized.provisionKey;

  if (!candidateKey) {
    throw new Error(
      "This on-demand track is missing its metadata key.",
    );
  }

  const prepared =
    await apiRequest(
      "/on-demand/prepare",
      {
        method:
          "POST",

        body:
          JSON.stringify({
            candidate_key:
              candidateKey,
          }),
      },
    );

  const permanentTrackId =
    prepared?.track_id ??
    null;

  const streamPath =
    permanentTrackId
      ? (
          "/api/audio/" +
          encodeURIComponent(
            permanentTrackId,
          )
        )
      : prepared?.stream_url;

  const audioUrl =
    resolveMediaUrl(
      streamPath,
    );

  if (!audioUrl) {
    throw new Error(
      "Audio is still preparing. Try again in a moment.",
    );
  }

  return normalizeTrackMeta({
    ...meta,
    audioUrl,
    onDemand:
      true,
    provisionKey:
      candidateKey,
    provisionId:
      prepared?.provision_id ??
      null,
    catalogTrackId:
      permanentTrackId,
  });
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

  let playbackMeta =
    normalizeTrackMeta(
      meta,
    );

  if (
    isOnDemandTrackId(
      trackId,
    )
    || playbackMeta.onDemand
  ) {
    try {
      playbackMeta =
        await resolveOnDemandPlaybackMeta(
          trackId,
          playbackMeta,
        );

      if (
        !isPlaybackSessionCurrent(
          session,
        )
      ) {
        return null;
      }

      currentTrackMeta =
        playbackMeta;

      currentArtworkUrl =
        playbackMeta.artworkUrl;

      currentTrackTitle =
        playbackMeta.title;

      currentTrackArtist =
        playbackMeta.artist;

      notify();

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
          : "Unable to prepare on-demand playback.",
      );

      notify();

      throw error;
    }
  }


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
        playbackMeta,
        {
          useStableMediaRoute,
          preferCachedBlob:
            !useStableMediaRoute &&
            globalThis.navigator
              ?.onLine ===
              false,
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
    trackId,
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
      ) ||
      isExpectedPlayInterruption(
        error,
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

rememberAutoplayTrack(
  trackId,
);

persistPlayerState({
  force:
    true,
});


/*
 * Cache-retention bookkeeping must not
 * block or break successful playback.
 */
void recordTrackPlayback(
  trackId,
  playbackMeta,
).catch(
  () => {},
);


/*
 * Start a backend listening session.
 *
 * Catalog tracks write directly to the
 * listening endpoint. On-demand tracks
 * mark their provision as played so the
 * event can be attached after lazy ingest.
 */
beginListeningEvent(
  trackId,
  playbackMeta,
);


return getState();
}

export async function restoreAccountPlayback(
  track,
  positionSeconds = 0,
) {
  const trackId =
    String(
      track?.id ??
      "",
    ).trim();

  if (!trackId) {
    stopTrack();

    return getState();
  }

  const meta =
    normalizeTrackMeta(
      track,
    );

  const requestedTime =
    Number.isFinite(
      Number(
        positionSeconds,
      ),
    )
      ? Math.max(
          Number(
            positionSeconds,
          ),
          0,
        )
      : 0;

  /*
   * Account sync never auto-starts audio.
   * A user gesture on this device is still
   * required before it takes playback over.
   */
  audio.pause();

  if (
    currentTrackId ===
      trackId &&
    currentTrackMeta
  ) {
    currentTrackMeta =
      meta;

    currentArtworkUrl =
      meta.artworkUrl;

    currentTrackTitle =
      meta.title;

    currentTrackArtist =
      meta.artist;

    restoredTimeSeconds =
      requestedTime;

    const canReuseSource =
      canReuseLoadedAudioSource({
        logicalTrackId:
          trackId,
        loadedTrackId:
          loadedAudioTrackId,
        hasSource:
          hasAudioSource(),
      });

    if (
      canReuseSource
    ) {
      const duration =
        Number.isFinite(
          audio.duration,
        ) &&
        audio.duration > 0
          ? audio.duration
          : requestedTime;

      try {
        audio.currentTime =
          Math.max(
            0,
            Math.min(
              requestedTime,
              duration,
            ),
          );
      } catch {
        // The source may still be loading.
      }
    }

    setPlaybackPhase(
      "paused",
    );

    rememberAutoplayTrack(
      trackId,
    );

    persistPlayerState({
      force:
        true,
      currentTime:
        requestedTime,
    });

    clearQueue();

    ensureCurrentTrackInQueue();

    notify();

    if (!canReuseSource) {
      cancelActivePlaybackSession();

      audio.removeAttribute(
        "src",
      );

      loadedAudioTrackId =
        null;

      audio.load();

      try {
        await ensureCurrentTrackSource();
      } catch {
        setPlaybackPhase(
          "paused",
        );

        notify();
      }
    }

    void ensureAutoplayQueue({
      force:
        true,
    }).catch(
      () => {},
    );

    return getState();
  }

  cancelActivePlaybackSession();

  clearQueue();

  audio.removeAttribute(
    "src",
  );

  loadedAudioTrackId =
    null;

  audio.load();

  currentTrackId =
    trackId;

  currentTrackMeta =
    meta;

  currentArtworkUrl =
    meta.artworkUrl;

  currentTrackTitle =
    meta.title;

  currentTrackArtist =
    meta.artist;

  rememberAutoplayTrack(
    trackId,
  );

  restoredTimeSeconds =
    requestedTime;

  setPlaybackPhase(
    "paused",
  );

  persistPlayerState({
    force:
      true,
    currentTime:
      requestedTime,
  });

  notify();

  void ensureAutoplayQueue({
    force:
      true,
  }).catch(
    () => {},
  );

  try {
    await ensureCurrentTrackSource();
  } catch {
    if (
      currentTrackId ===
        trackId
    ) {
      setPlaybackPhase(
        "paused",
      );

      notify();
    }
  }

  return getState();
}


export async function playTrack(
  trackId,
  meta = {},
) {
  const provisional =
    isOnDemandTrackId(
      trackId,
    )
    || Boolean(
      meta?.onDemand ??
      meta?.on_demand ??
      false,
    );

  const remoteQueue = [
    {
      id:
        String(
          trackId,
        ),
      meta:
        normalizeTrackMeta(
          meta,
        ),
    },
  ];

  if (
    !provisional &&
    await dispatchRemotePlayback(
      "play_track",
      {
        trackId,
        meta,
        queue:
          remoteQueue,
        queueIndex:
          0,
      },
    )
  ) {
    applyRemoteSelectionShadow(
      trackId,
      meta,
      remoteQueue,
      0,
    );

    return getState();
  }

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
  const track =
    getQueueTrackAtIndex(
      currentQueue,
      index,
    );

  if (!track) {
    return false;
  }

  const provisional =
    isOnDemandTrackId(
      track.id,
    )
    || Boolean(
      track.meta?.onDemand ??
      track.meta?.on_demand ??
      false,
    );

  if (
    !provisional &&
    await dispatchRemotePlayback(
      "play_track",
      {
        trackId:
          track.id,
        meta:
          track.meta,
        queue:
          currentQueue,
        queueIndex:
          index,
      },
    )
  ) {
    applyRemoteSelectionShadow(
      track.id,
      track.meta,
      currentQueue,
      index,
    );

    return getState();
  }

  finishListeningEvent(
  "skipped",
  getSafeCurrentTime(),
);


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

  const provisional =
    isOnDemandTrackId(
      track.id,
    )
    || Boolean(
      track.meta?.onDemand ??
      track.meta?.on_demand ??
      false,
    );

  if (
    !provisional &&
    await dispatchRemotePlayback(
      "play_track",
      {
        trackId:
          track.id,
        meta:
          track.meta,
        queue:
          currentQueue,
        queueIndex:
          currentQueueIndex,
      },
    )
  ) {
    applyRemoteSelectionShadow(
      track.id,
      track.meta,
      currentQueue,
      currentQueueIndex,
    );

    return getState();
  }

  finishListeningEvent(
    "skipped",
    getSafeCurrentTime(),
  );


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

export function playTrackNext(
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
   * Manual queue choices always win over
   * autoplay. If the current song started
   * outside a queue, materialize it first
   * so "Play next" has a stable insertion
   * point.
   */
  ensureCurrentTrackInQueue();

  currentQueue =
    insertQueueEntryAsNext(
      currentQueue,
      currentQueueIndex,
      entry,
    );

  /*
   * Any recommendation request that began
   * before this manual edit is stale. Its
   * response will be ignored by the
   * revision guard in ensureAutoplayQueue.
   */
  queueRevision +=
    1;

  notify();

  void Promise.resolve(
    warmQueuedAudioEntry(
      entry,
    ),
  ).catch(
    () => {},
  );

  return true;
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

  ensureCurrentTrackInQueue();

  currentQueue =
    appendQueueEntry(
      currentQueue,
      currentQueueIndex,
      entry,
    );

  queueRevision +=
    1;

  notify();

  void Promise.resolve(
    warmQueuedAudioEntry(
      entry,
    ),
  ).catch(
    () => {},
  );

  return true;
}

export async function playUrl(
  url,
  meta = {},
) {
  if (
    await dispatchRemotePlayback(
      "play_url",
      {
        url,
        meta,
      },
    )
  ) {
    return getState();
  }

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
    null,
  );

  audio.load();


  try {
    await audio.play();
  } catch (error) {
    if (
      !isPlaybackSessionCurrent(
        session,
      ) ||
      isExpectedPlayInterruption(
        error,
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
  if (
    await dispatchRemotePlayback(
      "toggle",
    )
  ) {
    return getState();
  }

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

    try {
      await audio.play();
    } catch (error) {
      if (
        !isExpectedPlayInterruption(
          error,
        )
      ) {
        throw error;
      }

      return getState();
    }

  } else {
    audio.pause();

    /*
     * Do not make pause wait on network.
     * Warm the resume window in the
     * background for the next Play tap.
     */
    void warmCurrentTrackForResume();
  }


  return getState();
}


export async function restoreAccountPlaybackQueue(
  queue,
  queueIndex = 0,
  positionSeconds = 0,
) {
  const builtQueue =
    buildTrackQueue(
      Array.isArray(
        queue,
      )
        ? queue
        : [],
    );

  if (!builtQueue.length) {
    return getState();
  }

  const safeIndex =
    Math.min(
      Math.max(
        Number.isInteger(
          queueIndex,
        )
          ? queueIndex
          : 0,
        0,
      ),
      builtQueue.length - 1,
    );

  const selected =
    builtQueue[
      safeIndex
    ];

  await restoreAccountPlayback(
    {
      id:
        selected.id,
      ...selected.meta,
    },
    positionSeconds,
  );

  queueRevision +=
    1;

  currentQueue =
    builtQueue;

  currentQueueIndex =
    safeIndex;

  notify();

  return getState();
}


export function syncAccountPlaybackShadow(
  snapshot,
) {
  const queue =
    buildTrackQueue(
      Array.isArray(
        snapshot?.queue,
      )
        ? snapshot.queue
        : [],
    );

  if (!queue.length) {
    queueRevision +=
      1;

    currentQueue =
      [];

    currentQueueIndex =
      -1;

    if (!snapshot?.track?.id) {
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
    }

    notify();

    return getState();
  }

  const requestedIndex =
    Number(
      snapshot?.queue_index,
    );

  let safeIndex =
    Number.isInteger(
      requestedIndex,
    )
      ? Math.min(
          Math.max(
            requestedIndex,
            0,
          ),
          queue.length - 1,
        )
      : 0;

  const trackId =
    String(
      snapshot?.track?.id ??
        "",
    );

  const matchingIndex =
    trackId
      ? queue.findIndex(
          (entry) =>
            String(
              entry.id,
            ) === trackId,
        )
      : -1;

  if (matchingIndex >= 0) {
    safeIndex =
      matchingIndex;
  }

  const selected =
    queue[
      safeIndex
    ];

  queueRevision +=
    1;

  currentQueue =
    queue;

  currentQueueIndex =
    safeIndex;

  currentTrackId =
    String(
      selected.id,
    );

  currentTrackMeta =
    normalizeTrackMeta(
      selected.meta,
    );

  currentArtworkUrl =
    currentTrackMeta.artworkUrl;

  currentTrackTitle =
    currentTrackMeta.title;

  currentTrackArtist =
    currentTrackMeta.artist;

  notify();

  return getState();
}


export function pausePlayback() {
  if (
    dispatchRemotePlaybackInBackground(
      "pause",
    )
  ) {
    return getState();
  }

  return silenceLocalPlayback();
}


export function silenceLocalPlayback() {
  if (
    !audio.paused
  ) {
    audio.pause();
  }

  /*
   * Keep this exact pause point hot for
   * two hours. The Audio element remains
   * attached, and the nearby media bytes
   * are also persisted through the
   * service worker cache.
   */
  void warmCurrentTrackForResume();


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
    dispatchRemotePlaybackInBackground(
      "stop",
      {
        trackId,
      },
    )
  ) {
    return true;
  }

  if (
    trackId &&
    String(trackId) !==
      currentTrackId
  ) {
    return false;
  }


  cancelActivePlaybackSession();

  warmPlaybackTask =
    null;

  warmPlaybackTaskKey =
    null;


  audio.pause();


  clearQueue();


  audio.removeAttribute(
    "src",
  );

  loadedAudioTrackId =
    null;

  sourcePreparationPromise =
    null;

  sourcePreparationTrackId =
    null;

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

  if (
    dispatchRemotePlaybackInBackground(
      "seek",
      {
        value:
          timeSeconds,
      },
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
  if (
    dispatchRemotePlaybackInBackground(
      "volume",
      {
        value,
      },
    )
  ) {
    return;
  }

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
    restoreAccountPlayback,
    restoreAccountPlaybackQueue,
    syncAccountPlaybackShadow,
    runWithLocalPlaybackControl,
    setRemotePlaybackController,
    silenceLocalPlayback,
    playTrackQueue,
    playTrackNext,
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
  if (
    await dispatchRemotePlayback(
      "next",
    )
  ) {
    return true;
  }

  if (!currentTrackId) {
    return false;
  }


  finishListeningEvent(
    "skipped",
    getSafeCurrentTime(),
  );


  await ensureAutoplayQueue();


  await playNextQueueTrack();

  return true;
}



export async function skipToPrevious() {
  if (
    await dispatchRemotePlayback(
      "previous",
    )
  ) {
    return true;
  }

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
