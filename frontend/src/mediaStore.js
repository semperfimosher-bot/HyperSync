const MEDIA_CACHE_STATES =
  new Set([
    "NONE",
    "PARTIAL",
    "COMPLETE",
    "PINNED",
  ]);


export const MEDIA_CHUNK_SIZE =
  256 * 1024;

const MEDIA_DATABASE_NAME =
  "hypersynced-media-v1";

const MEDIA_DATABASE_VERSION =
  5;

const MEDIA_RECORD_STORE =
  "media";

const MEDIA_CHUNK_STORE =
  "chunks";

const MEDIA_ARTWORK_STORE =
  "artwork";

const MEDIA_DOWNLOAD_JOB_STORE =
  "downloadJobs";

const MEDIA_LYRICS_STORE =
  "lyrics";


let databasePromise = null;


export function buildMediaCacheKey(
  trackId,
  mediaVersion,
) {
  if (
    trackId === null ||
    trackId === undefined ||
    mediaVersion === null ||
    mediaVersion === undefined
  ) {
    return null;
  }

  const normalizedTrackId =
    String(trackId).trim();

  const normalizedMediaVersion =
    String(mediaVersion).trim();

  if (
    !normalizedTrackId ||
    !normalizedMediaVersion
  ) {
    return null;
  }

  return (
    `${normalizedTrackId}:` +
    normalizedMediaVersion
  );
}

export function createMediaRecord({
  trackId,
  mediaVersion,
  mimeType = null,
  fileSize = null,
  state = "NONE",
} = {}) {
  const key =
    buildMediaCacheKey(
      trackId,
      mediaVersion,
    );

  if (
    !MEDIA_CACHE_STATES.has(
      state,
    )
  ) {
    throw new RangeError(
      `Invalid media cache state: ${state}`,
    );
  }

  return {
    key,
    trackId:
      trackId === null ||
      trackId === undefined
        ? null
        : String(trackId).trim(),
    mediaVersion:
      mediaVersion === null ||
      mediaVersion === undefined
        ? null
        : String(
            mediaVersion,
          ).trim(),
    mimeType,
    fileSize,
    state,
    cachedBytes: 0,
    lastPlayedAt: null,
    expiresAt: null,
  };
}

function openMediaDatabase() {
  if (
    typeof indexedDB ===
    "undefined"
  ) {
    return Promise.reject(
      new Error(
        "IndexedDB is unavailable.",
      ),
    );
  }

  if (databasePromise) {
    return databasePromise;
  }

  databasePromise =
    new Promise(
      (
        resolve,
        reject,
      ) => {
        const request =
          indexedDB.open(
            MEDIA_DATABASE_NAME,
            MEDIA_DATABASE_VERSION,
          );

        request.onupgradeneeded =
          () => {
            const database =
              request.result;

            if (
              !database.objectStoreNames
                .contains(
                  MEDIA_RECORD_STORE,
                )
            ) {
              database.createObjectStore(
                MEDIA_RECORD_STORE,
                {
                  keyPath: "key",
                },
              );
            }
                if (
              !database.objectStoreNames
                .contains(
                  MEDIA_CHUNK_STORE,
                )
            ) {
              const chunkStore =
                database.createObjectStore(
                  MEDIA_CHUNK_STORE,
                  {
                    keyPath: "key",
                  },
                );

              chunkStore.createIndex(
                "mediaKey",
                "mediaKey",
                {
                  unique: false,
                },
              );
            }

            if (
              !database.objectStoreNames
                .contains(
                  MEDIA_ARTWORK_STORE,
                )
            ) {
              database.createObjectStore(
                MEDIA_ARTWORK_STORE,
                {
                  keyPath: "trackId",
                },
              );
            }

            if (
              !database.objectStoreNames
                .contains(
                  MEDIA_DOWNLOAD_JOB_STORE,
                )
            ) {
              database.createObjectStore(
                MEDIA_DOWNLOAD_JOB_STORE,
                {
                  keyPath: "id",
                },
              );
            }

            if (
              !database.objectStoreNames
                .contains(
                  MEDIA_LYRICS_STORE,
                )
            ) {
              database.createObjectStore(
                MEDIA_LYRICS_STORE,
                {
                  keyPath: "trackId",
                },
              );
            }
          };

        request.onsuccess =
          () => {
            resolve(
              request.result,
            );
          };

        request.onerror =
          () => {
            databasePromise =
              null;

            reject(
              request.error ??
                new Error(
                  "Unable to open media database.",
                ),
            );
          };
      },
    );

  return databasePromise;
}


export async function saveMediaRecord(
  record,
) {
  const database =
    await openMediaDatabase();

  await new Promise(
    (
      resolve,
      reject,
    ) => {
      const transaction =
        database.transaction(
          MEDIA_RECORD_STORE,
          "readwrite",
        );

      transaction
        .objectStore(
          MEDIA_RECORD_STORE,
        )
        .put(
          record,
        );

      transaction.oncomplete =
        () => {
          resolve();
        };

      transaction.onerror =
        () => {
          reject(
            transaction.error ??
              new Error(
                "Unable to save media record.",
              ),
          );
        };

      transaction.onabort =
        () => {
          reject(
            transaction.error ??
              new Error(
                "Media record save was aborted.",
              ),
          );
        };
    },
  );

  return record;
}


export async function getMediaRecord(
  trackId,
  mediaVersion,
) {
  const key =
    buildMediaCacheKey(
      trackId,
      mediaVersion,
    );

  if (!key) {
    return null;
  }

  const database =
    await openMediaDatabase();

  return new Promise(
    (
      resolve,
      reject,
    ) => {
      const transaction =
        database.transaction(
          MEDIA_RECORD_STORE,
          "readonly",
        );

      const request =
        transaction
          .objectStore(
            MEDIA_RECORD_STORE,
          )
          .get(
            key,
          );

      request.onsuccess =
        () => {
          resolve(
            request.result ??
              null,
          );
        };

      request.onerror =
        () => {
          reject(
            request.error ??
              new Error(
                "Unable to read media record.",
              ),
          );
        };
    },
  );
}

export async function ensureMediaRecord({
  trackId,
  mediaVersion,
  mimeType = null,
  fileSize = null,
}) {
  const existing =
    await getMediaRecord(
      trackId,
      mediaVersion,
    );

  if (existing) {
    const updated = {
      ...existing,

      mimeType:
        mimeType ??
        existing.mimeType ??
        null,

      fileSize:
        fileSize ??
        existing.fileSize ??
        null,
    };

    await saveMediaRecord(
      updated,
    );

    return updated;
  }

  const record =
    createMediaRecord({
      trackId,
      mediaVersion,
      mimeType,
      fileSize,
      state:
        "NONE",
    });

  await saveMediaRecord(
    record,
  );

  return record;
}

export const MEDIA_EXPIRY_MS =
  14 *
  24 *
  60 *
  60 *
  1000;

export async function markMediaPlayed(
  trackId,
  mediaVersion,
  playedAt =
    Date.now(),
) {
  if (
    !Number.isSafeInteger(
      playedAt,
    ) ||
    playedAt < 0
  ) {
    throw new RangeError(
      "Media playback time must be a non-negative safe integer.",
    );
  }

  const expiresAt =
    playedAt +
    MEDIA_EXPIRY_MS;

  if (
    !Number.isSafeInteger(
      expiresAt,
    )
  ) {
    throw new RangeError(
      "Media expiry time must be a safe integer.",
    );
  }

  const mediaKey =
    buildMediaCacheKey(
      trackId,
      mediaVersion,
    );

  if (!mediaKey) {
    return null;
  }

  const database =
    await openMediaDatabase();

  return new Promise(
    (
      resolve,
      reject,
    ) => {
      const transaction =
        database.transaction(
          MEDIA_RECORD_STORE,
          "readwrite",
        );

      const mediaStore =
        transaction.objectStore(
          MEDIA_RECORD_STORE,
        );

      let updatedRecord =
        null;

      const request =
        mediaStore.get(
          mediaKey,
        );

      request.onsuccess =
        () => {
          const existing =
            request.result ??
            null;

          if (!existing) {
            return;
          }

          updatedRecord = {
            ...existing,
            lastPlayedAt:
              playedAt,
            expiresAt,
          };

          mediaStore.put(
            updatedRecord,
          );
        };

      request.onerror =
        () => {
          transaction.abort();
        };

      transaction.oncomplete =
        () => {
          resolve(
            updatedRecord,
          );
        };

      transaction.onerror =
        () => {
          reject(
            transaction.error ??
              new Error(
                "Unable to update media playback time.",
              ),
          );
        };

      transaction.onabort =
        () => {
          reject(
            transaction.error ??
              new Error(
                "Media playback update was aborted.",
              ),
          );
        };
    },
  );
}

export async function saveMediaChunk({
  trackId,
  mediaVersion,
  chunkIndex,
  byteStart,
  data,
} = {}) {
  const mediaKey =
    buildMediaCacheKey(
      trackId,
      mediaVersion,
    );

  if (!mediaKey) {
    throw new TypeError(
      "Media chunk requires a valid media key.",
    );
  }

  if (
    !Number.isInteger(
      chunkIndex,
    ) ||
    chunkIndex < 0
  ) {
    throw new RangeError(
      "Media chunk index must be a non-negative integer.",
    );
  }

  if (
    !Number.isInteger(
      byteStart,
    ) ||
    byteStart < 0
  ) {
    throw new RangeError(
      "Media chunk byte start must be a non-negative integer.",
    );
  }

  const expectedByteStart =
    chunkIndex *
    MEDIA_CHUNK_SIZE;

  if (
    byteStart !==
    expectedByteStart
  ) {
    throw new RangeError(
      "Media chunk byte start does not match chunk index.",
    );
  }

  if (
    !(data instanceof ArrayBuffer)
  ) {
    throw new TypeError(
      "Media chunk data must be an ArrayBuffer.",
    );
  }

  const byteLength =
    data.byteLength;

  if (
    byteLength >
    MEDIA_CHUNK_SIZE
  ) {
    throw new RangeError(
      "Media chunk exceeds maximum chunk size.",
    );
  }

  const record = {
    key:
      `${mediaKey}:${chunkIndex}`,
    mediaKey,
    chunkIndex,
    byteStart,
    byteEnd:
      byteStart +
      byteLength -
      1,
    byteLength,
    data,
  };

  const database =
    await openMediaDatabase();

  await new Promise(
    (
      resolve,
      reject,
    ) => {
      const transaction =
        database.transaction(
          [
            MEDIA_CHUNK_STORE,
            MEDIA_RECORD_STORE,
          ],
          "readwrite",
        );

      const chunkStore =
        transaction.objectStore(
          MEDIA_CHUNK_STORE,
        );

      const mediaStore =
        transaction.objectStore(
          MEDIA_RECORD_STORE,
        );

      const existingChunkRequest =
        chunkStore.get(
          record.key,
        );

      existingChunkRequest.onsuccess =
        () => {
          const existingChunk =
            existingChunkRequest.result ??
            null;

          const mediaRequest =
            mediaStore.get(
              mediaKey,
            );

          mediaRequest.onsuccess =
            () => {
              chunkStore.put(
                record,
              );

              const mediaRecord =
                mediaRequest.result ??
                null;

              if (!mediaRecord) {
                return;
              }

              const previousByteLength =
                existingChunk?.byteLength ??
                0;

              const cachedBytes =
                Math.max(
                  0,
                  (
                    mediaRecord.cachedBytes ??
                    0
                  ) -
                    previousByteLength +
                    byteLength,
                );

              let state =
                mediaRecord.state;

              if (
                state !== "PINNED"
              ) {
                if (
                  cachedBytes === 0
                ) {
                  state = "NONE";
                } else if (
                  Number.isFinite(
                    mediaRecord.fileSize,
                  ) &&
                  cachedBytes >=
                    mediaRecord.fileSize
                ) {
                  state = "COMPLETE";
                } else {
                  state = "PARTIAL";
                }
              }

              mediaStore.put({
                ...mediaRecord,
                cachedBytes,
                state,
              });
            };
        };

      transaction.oncomplete =
        () => {
          resolve();
        };

      transaction.onerror =
        () => {
          reject(
            transaction.error ??
              new Error(
                "Unable to save media chunk.",
              ),
          );
        };

      transaction.onabort =
        () => {
          reject(
            transaction.error ??
              new Error(
                "Media chunk save was aborted.",
              ),
          );
        };
    },
  );

  return record;
}


export async function getMediaChunk(
  trackId,
  mediaVersion,
  chunkIndex,
) {
  const mediaKey =
    buildMediaCacheKey(
      trackId,
      mediaVersion,
    );

  if (
    !mediaKey ||
    !Number.isInteger(
      chunkIndex,
    ) ||
    chunkIndex < 0
  ) {
    return null;
  }

  const key =
    `${mediaKey}:${chunkIndex}`;

  const database =
    await openMediaDatabase();

  return new Promise(
    (
      resolve,
      reject,
    ) => {
      const transaction =
        database.transaction(
          MEDIA_CHUNK_STORE,
          "readonly",
        );

      const request =
        transaction
          .objectStore(
            MEDIA_CHUNK_STORE,
          )
          .get(
            key,
          );

      request.onsuccess =
        () => {
          resolve(
            request.result ??
              null,
          );
        };

      request.onerror =
        () => {
          reject(
            request.error ??
              new Error(
                "Unable to read media chunk.",
              ),
          );
        };
    },
  );
}

export function getChunkIndexesForRange(
  byteStart,
  byteEnd,
) {
  if (
    !Number.isInteger(
      byteStart,
    ) ||
    !Number.isInteger(
      byteEnd,
    )
  ) {
    throw new RangeError(
      "Media byte range positions must be integers.",
    );
  }

  if (
    byteStart < 0 ||
    byteEnd < 0
  ) {
    throw new RangeError(
      "Media byte range positions cannot be negative.",
    );
  }

  if (
    byteEnd <
    byteStart
  ) {
    throw new RangeError(
      "Media byte range end cannot be before start.",
    );
  }

  const firstChunkIndex =
    Math.floor(
      byteStart /
        MEDIA_CHUNK_SIZE,
    );

  const lastChunkIndex =
    Math.floor(
      byteEnd /
        MEDIA_CHUNK_SIZE,
    );

  const chunkIndexes =
    [];

  for (
    let chunkIndex =
      firstChunkIndex;
    chunkIndex <=
    lastChunkIndex;
    chunkIndex += 1
  ) {
    chunkIndexes.push(
      chunkIndex,
    );
  }

  return chunkIndexes;
}

export async function getCachedMediaRange(
  trackId,
  mediaVersion,
  byteStart,
  byteEnd,
) {
  const chunkIndexes =
    getChunkIndexesForRange(
      byteStart,
      byteEnd,
    );

  const output =
    new Uint8Array(
      byteEnd -
        byteStart +
        1,
    );

  let outputOffset =
    0;

  let nextByteStart =
    byteStart;

  for (
    const chunkIndex of
    chunkIndexes
  ) {
    const chunk =
      await getMediaChunk(
        trackId,
        mediaVersion,
        chunkIndex,
      );

    if (!chunk) {
      return null;
    }

    const sliceStart =
      Math.max(
        byteStart,
        chunk.byteStart,
      );

    const sliceEnd =
      Math.min(
        byteEnd,
        chunk.byteEnd,
      );

    if (
      sliceStart !==
        nextByteStart ||
      sliceEnd <
        sliceStart
    ) {
      return null;
    }

    const sliceOffset =
      sliceStart -
      chunk.byteStart;

    const sliceLength =
      sliceEnd -
      sliceStart +
      1;

    const slice =
      new Uint8Array(
        chunk.data,
        sliceOffset,
        sliceLength,
      );

    output.set(
      slice,
      outputOffset,
    );

    outputOffset +=
      sliceLength;

    nextByteStart =
      sliceEnd + 1;
  }

  if (
    nextByteStart !==
      byteEnd + 1 ||
    outputOffset !==
      output.byteLength
  ) {
    return null;
  }

  return output.buffer;
}

export async function cleanupExpiredMedia(
  now =
    Date.now(),
) {
  if (
    !Number.isSafeInteger(
      now,
    ) ||
    now < 0
  ) {
    throw new RangeError(
      "Media cleanup time must be a non-negative safe integer.",
    );
  }

  const database =
    await openMediaDatabase();

  return new Promise(
    (
      resolve,
      reject,
    ) => {
      const transaction =
        database.transaction(
          [
            MEDIA_RECORD_STORE,
            MEDIA_CHUNK_STORE,
            MEDIA_ARTWORK_STORE,
          ],
          "readwrite",
        );

      const mediaStore =
        transaction.objectStore(
          MEDIA_RECORD_STORE,
        );

      const chunkStore =
        transaction.objectStore(
          MEDIA_CHUNK_STORE,
        );

      const mediaKeyIndex =
        chunkStore.index(
          "mediaKey",
        );

      let deletedCount =
        0;

      const request =
        mediaStore.getAll();

      request.onsuccess =
        () => {
          const records =
            request.result;

          for (
            const record
            of records
          ) {
            const isExpired =
              Number.isSafeInteger(
                record.expiresAt,
              ) &&
              record.expiresAt <=
                now;

            const isPinned =
              record.state ===
              "PINNED";

            if (
              !isExpired ||
              isPinned
            ) {
              continue;
            }

            mediaStore.delete(
              record.key,
            );

            deletedCount +=
              1;

            const cursorRequest =
              mediaKeyIndex.openCursor(
                record.key,
              );

            cursorRequest.onsuccess =
              () => {
                const cursor =
                  cursorRequest.result;

                if (!cursor) {
                  return;
                }

                cursor.delete();

                cursor.continue();
              };

            cursorRequest.onerror =
              () => {
                transaction.abort();
              };
          }
        };

      request.onerror =
        () => {
          transaction.abort();
        };

      transaction.oncomplete =
        () => {
          resolve(
            deletedCount,
          );
        };

      transaction.onerror =
        () => {
          reject(
            transaction.error ??
              new Error(
                "Unable to clean up expired media.",
              ),
          );
        };

      transaction.onabort =
        () => {
          reject(
            transaction.error ??
              new Error(
                "Expired media cleanup was aborted.",
              ),
          );
        };
    },
  );
}

export async function getPinnedMediaRecords() {
  const database =
    await openMediaDatabase();


  return new Promise(
    (
      resolve,
      reject,
    ) => {
      const transaction =
        database.transaction(
          MEDIA_RECORD_STORE,
          "readonly",
        );


      const request =
        transaction
          .objectStore(
            MEDIA_RECORD_STORE,
          )
          .getAll();


      request.onsuccess =
        () => {
          const records =
            Array.isArray(
              request.result,
            )
              ? request.result
              : [];


          resolve(
            records.filter(
              (record) =>
                record.state ===
                "PINNED",
            ),
          );
        };


      request.onerror =
        () => {
          reject(
            request.error ??
              new Error(
                "Unable to read downloaded tracks.",
              ),
          );
        };
    },
  );
}


export async function saveArtwork({
  trackId,
  data,
  mimeType = "image/jpeg",
  sourceUrl = null,
  artworkVersion = null,
} = {}) {
  const normalizedTrackId =
    String(trackId ?? "").trim();

  if (!normalizedTrackId) {
    throw new TypeError(
      "Artwork requires a track id.",
    );
  }

  if (!(data instanceof ArrayBuffer)) {
    throw new TypeError(
      "Artwork data must be an ArrayBuffer.",
    );
  }

  const record = {
    trackId:
      normalizedTrackId,
    data,
    mimeType:
      mimeType ||
      "application/octet-stream",
    byteLength:
      data.byteLength,
    sourceUrl,
    artworkVersion:
      artworkVersion === null ||
      artworkVersion === undefined
        ? null
        : String(
            artworkVersion,
          ),
    updatedAt:
      Date.now(),
  };

  const database =
    await openMediaDatabase();

  await new Promise(
    (resolve, reject) => {
      const transaction =
        database.transaction(
          MEDIA_ARTWORK_STORE,
          "readwrite",
        );

      transaction
        .objectStore(
          MEDIA_ARTWORK_STORE,
        )
        .put(record);

      transaction.oncomplete =
        () => resolve();

      transaction.onerror =
        () => reject(
          transaction.error ??
            new Error(
              "Unable to save artwork.",
            ),
        );

      transaction.onabort =
        transaction.onerror;
    },
  );

  return record;
}


export async function getArtwork(
  trackId,
) {
  const normalizedTrackId =
    String(trackId ?? "").trim();

  if (!normalizedTrackId) {
    return null;
  }

  const database =
    await openMediaDatabase();

  return new Promise(
    (resolve, reject) => {
      const transaction =
        database.transaction(
          MEDIA_ARTWORK_STORE,
          "readonly",
        );

      const request =
        transaction
          .objectStore(
            MEDIA_ARTWORK_STORE,
          )
          .get(
            normalizedTrackId,
          );

      request.onsuccess =
        () => resolve(
          request.result ??
            null,
        );

      request.onerror =
        () => reject(
          request.error ??
            new Error(
              "Unable to read artwork.",
            ),
        );
    },
  );
}


export async function removeArtwork(
  trackId,
) {
  const normalizedTrackId =
    String(trackId ?? "").trim();

  if (!normalizedTrackId) {
    return false;
  }

  const database =
    await openMediaDatabase();

  await new Promise(
    (resolve, reject) => {
      const transaction =
        database.transaction(
          MEDIA_ARTWORK_STORE,
          "readwrite",
        );

      transaction
        .objectStore(
          MEDIA_ARTWORK_STORE,
        )
        .delete(
          normalizedTrackId,
        );

      transaction.oncomplete =
        () => resolve();

      transaction.onerror =
        () => reject(
          transaction.error ??
            new Error(
              "Unable to remove artwork.",
            ),
        );
    },
  );

  return true;
}


export async function saveLyrics(
  trackId,
  lyrics,
) {
  const normalizedTrackId =
    String(trackId ?? "").trim();

  if (
    !normalizedTrackId ||
    !lyrics ||
    typeof lyrics !== "object"
  ) {
    throw new TypeError(
      "Lyrics require a track id and payload.",
    );
  }

  const record = {
    trackId:
      normalizedTrackId,
    payload:
      lyrics,
    updatedAt:
      Date.now(),
  };

  const database =
    await openMediaDatabase();

  await new Promise(
    (resolve, reject) => {
      const transaction =
        database.transaction(
          MEDIA_LYRICS_STORE,
          "readwrite",
        );

      transaction
        .objectStore(
          MEDIA_LYRICS_STORE,
        )
        .put(
          record,
        );

      transaction.oncomplete =
        () => resolve();

      transaction.onerror =
        () => reject(
          transaction.error ??
            new Error(
              "Unable to save lyrics.",
            ),
        );

      transaction.onabort =
        transaction.onerror;
    },
  );

  return record;
}


export async function getLyrics(
  trackId,
) {
  const normalizedTrackId =
    String(trackId ?? "").trim();

  if (!normalizedTrackId) {
    return null;
  }

  const database =
    await openMediaDatabase();

  return new Promise(
    (resolve, reject) => {
      const transaction =
        database.transaction(
          MEDIA_LYRICS_STORE,
          "readonly",
        );

      const request =
        transaction
          .objectStore(
            MEDIA_LYRICS_STORE,
          )
          .get(
            normalizedTrackId,
          );

      request.onsuccess =
        () => resolve(
          request.result
            ?.payload ??
          null,
        );

      request.onerror =
        () => reject(
          request.error ??
            new Error(
              "Unable to read lyrics.",
            ),
        );
    },
  );
}


export async function saveDownloadJob(
  job,
) {
  if (!job?.id) {
    throw new TypeError(
      "Download job requires an id.",
    );
  }

  const database =
    await openMediaDatabase();

  const record = {
    ...job,
    id:
      String(job.id),
    updatedAt:
      Date.now(),
  };

  await new Promise(
    (resolve, reject) => {
      const transaction =
        database.transaction(
          MEDIA_DOWNLOAD_JOB_STORE,
          "readwrite",
        );

      transaction
        .objectStore(
          MEDIA_DOWNLOAD_JOB_STORE,
        )
        .put(record);

      transaction.oncomplete =
        () => resolve();

      transaction.onerror =
        () => reject(
          transaction.error ??
            new Error(
              "Unable to save download job.",
            ),
        );
    },
  );

  return record;
}


export async function getDownloadJobs() {
  const database =
    await openMediaDatabase();

  return new Promise(
    (resolve, reject) => {
      const transaction =
        database.transaction(
          MEDIA_DOWNLOAD_JOB_STORE,
          "readonly",
        );

      const request =
        transaction
          .objectStore(
            MEDIA_DOWNLOAD_JOB_STORE,
          )
          .getAll();

      request.onsuccess =
        () => resolve(
          Array.isArray(
            request.result,
          )
            ? request.result
            : [],
        );

      request.onerror =
        () => reject(
          request.error ??
            new Error(
              "Unable to read download jobs.",
            ),
        );
    },
  );
}


export async function removeDownloadedMedia(
  trackId,
  mediaVersion,
) {
  const mediaKey =
    buildMediaCacheKey(
      trackId,
      mediaVersion,
    );


  if (!mediaKey) {
    return false;
  }


  const database =
    await openMediaDatabase();


  await new Promise(
    (
      resolve,
      reject,
    ) => {
      const transaction =
        database.transaction(
          [
            MEDIA_RECORD_STORE,
            MEDIA_CHUNK_STORE,
            MEDIA_ARTWORK_STORE,
          ],
          "readwrite",
        );


      const mediaStore =
        transaction.objectStore(
          MEDIA_RECORD_STORE,
        );


      const chunkStore =
        transaction.objectStore(
          MEDIA_CHUNK_STORE,
        );

      const artworkStore =
        transaction.objectStore(
          MEDIA_ARTWORK_STORE,
        );


      const mediaKeyIndex =
        chunkStore.index(
          "mediaKey",
        );


      mediaStore.delete(
        mediaKey,
      );

      artworkStore.delete(
        String(trackId),
      );


      const cursorRequest =
        mediaKeyIndex.openCursor(
          mediaKey,
        );


      cursorRequest.onsuccess =
        () => {
          const cursor =
            cursorRequest.result;


          if (!cursor) {
            return;
          }


          cursor.delete();

          cursor.continue();
        };


      cursorRequest.onerror =
        () => {
          transaction.abort();
        };


      transaction.oncomplete =
        () => {
          resolve();
        };


      transaction.onerror =
        () => {
          reject(
            transaction.error ??
              new Error(
                "Unable to remove downloaded media.",
              ),
          );
        };


      transaction.onabort =
        () => {
          reject(
            transaction.error ??
              new Error(
                "Downloaded-media removal was aborted.",
              ),
          );
        };
    },
  );


  return true;
}
