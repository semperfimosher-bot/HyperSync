import "fake-indexeddb/auto";

import assert from "node:assert/strict";
import test from "node:test";


function createStorage() {
  const values =
    new Map();

  return {
    getItem(key) {
      return values.has(key)
        ? values.get(key)
        : null;
    },

    setItem(key, value) {
      values.set(
        key,
        String(value),
      );
    },

    removeItem(key) {
      values.delete(
        key,
      );
    },

    clear() {
      values.clear();
    },
  };
}


if (
  typeof globalThis.localStorage ===
  "undefined"
) {
  globalThis.localStorage =
    createStorage();
}

if (
  typeof globalThis.sessionStorage ===
  "undefined"
) {
  globalThis.sessionStorage =
    createStorage();
}


async function loadOfflineDownloads() {
  return import(
    `./offlineDownloads.js?test=${Date.now()}-${Math.random()}`
  );
}


test(
  "offline owner keys isolate playlist jobs and pin references",
  async () => {
    const offline =
      await loadOfflineDownloads();

    const ownerA =
      offline.getOfflineOwnerKey({
        id:
          "owner-key-user-a",
      });

    const ownerB =
      offline.getOfflineOwnerKey({
        id:
          "owner-key-user-b",
      });

    assert.notEqual(
      offline.getPlaylistDownloadJobId(
        ownerA,
        "playlist-1",
      ),
      offline.getPlaylistDownloadJobId(
        ownerB,
        "playlist-1",
      ),
    );

    assert.notEqual(
      offline.getManualDownloadPinRef(
        ownerA,
      ),
      offline.getManualDownloadPinRef(
        ownerB,
      ),
    );

    assert.notEqual(
      offline.getPlaylistDownloadPinRef(
        ownerA,
        "playlist-1",
      ),
      offline.getPlaylistDownloadPinRef(
        ownerA,
        "playlist-2",
      ),
    );
  },
);


test(
  "downloaded track lists expose only the active owner's pins",
  async () => {
    const mediaStore =
      await import(
        "./mediaStore.js"
      );

    const offline =
      await loadOfflineDownloads();

    const now =
      Date.now();

    for (
      const [
        owner,
        trackId,
      ]
      of [
        [
          "scope-user-a",
          "scope-track-a",
        ],
        [
          "scope-user-b",
          "scope-track-b",
        ],
      ]
    ) {
      const record =
        mediaStore.createMediaRecord({
          trackId,
          mediaVersion:
            "v1",
          mimeType:
            "audio/mpeg",
          fileSize:
            1,
          state:
            "PINNED",
        });

      record.cachedBytes =
        1;

      record.title =
        trackId;

      record.pinRefs = [
        offline.getManualDownloadPinRef(
          owner,
        ),
      ];

      /*
       * Keep this test focused on ownership.
       * Recent validation prevents an online
       * metadata refresh from being necessary.
       */
      record.artworkValidatedAt =
        now;

      await mediaStore.saveMediaRecord(
        record,
      );
    }

    const tracksA =
      await offline.getDownloadedTracks(
        "scope-user-a",
      );

    const tracksB =
      await offline.getDownloadedTracks(
        "scope-user-b",
      );

    assert.deepEqual(
      tracksA.map(
        (track) =>
          track.id,
      ),
      [
        "scope-track-a",
      ],
    );

    assert.deepEqual(
      tracksB.map(
        (track) =>
          track.id,
      ),
      [
        "scope-track-b",
      ],
    );
  },
);


test(
  "interrupted jobs recover only for the matching owner",
  async () => {
    const mediaStore =
      await import(
        "./mediaStore.js"
      );

    const offline =
      await loadOfflineDownloads();

    const record =
      mediaStore.createMediaRecord({
        trackId:
          "recovery-track",
        mediaVersion:
          "v1",
        mimeType:
          "audio/mpeg",
        fileSize:
          1000,
        state:
          "PARTIAL",
      });

    record.cachedBytes =
      400;

    await mediaStore.saveMediaRecord(
      record,
    );

    await mediaStore.saveDownloadJob({
      id:
        "recovery-job-a",
      ownerKey:
        "recovery-owner-a",
      playlistId:
        "playlist-a",
      kind:
        "playlist",
      state:
        "downloading",
      totalBytes:
        1000,
      downloadedBytes:
        0,
      trackKeys: [
        "recovery-track:v1",
      ],
    });

    await mediaStore.saveDownloadJob({
      id:
        "recovery-job-b",
      ownerKey:
        "recovery-owner-b",
      playlistId:
        "playlist-b",
      kind:
        "playlist",
      state:
        "downloading",
      totalBytes:
        1000,
      downloadedBytes:
        0,
      trackKeys: [
        "recovery-track:v1",
      ],
    });

    assert.equal(
      await offline.recoverInterruptedDownloadJobs(
        "recovery-owner-a",
      ),
      1,
    );

    const jobs =
      await mediaStore.getDownloadJobs();

    const jobA =
      jobs.find(
        (job) =>
          job.id ===
          "recovery-job-a",
      );

    const jobB =
      jobs.find(
        (job) =>
          job.id ===
          "recovery-job-b",
      );

    assert.equal(
      jobA.state,
      "paused",
    );

    assert.equal(
      jobA.downloadedBytes,
      400,
    );

    assert.equal(
      jobB.state,
      "downloading",
    );
  },
);


test(
  "offline downloads reject durable writes without an owner pin",
  async () => {
    const offline =
      await loadOfflineDownloads();

    await assert.rejects(
      () =>
        offline.downloadTrackForOffline({
          id:
            "unowned-track",
          media_version:
            "v1",
          file_size:
            1,
          mime_type:
            "audio/mpeg",
        }),
      {
        message:
          "Offline downloads require an account-scoped owner.",
      },
    );
  },
);


test(
  "legacy unscoped downloads are removed without touching scoped downloads",
  async () => {
    const mediaStore =
      await import(
        "./mediaStore.js"
      );

    const offline =
      await loadOfflineDownloads();

    const legacy =
      mediaStore.createMediaRecord({
        trackId:
          "legacy-unscoped-track",
        mediaVersion:
          "v1",
        mimeType:
          "audio/mpeg",
        fileSize:
          1,
        state:
          "PINNED",
      });

    legacy.cachedBytes =
      1;

    await mediaStore.saveMediaRecord(
      legacy,
    );

    const scoped =
      mediaStore.createMediaRecord({
        trackId:
          "scoped-survivor-track",
        mediaVersion:
          "v1",
        mimeType:
          "audio/mpeg",
        fileSize:
          1,
        state:
          "PINNED",
      });

    scoped.cachedBytes =
      1;

    scoped.pinRefs = [
      offline.getManualDownloadPinRef(
        "cleanup-owner",
      ),
    ];

    await mediaStore.saveMediaRecord(
      scoped,
    );

    await mediaStore.saveDownloadJob({
      id:
        "legacy-unscoped-job",
      state:
        "complete",
      trackKeys: [
        "legacy-unscoped-track:v1",
      ],
    });

    await mediaStore.saveDownloadJob({
      id:
        "scoped-survivor-job",
      ownerKey:
        "cleanup-owner",
      state:
        "complete",
      trackKeys: [
        "scoped-survivor-track:v1",
      ],
    });

    const result =
      await offline.cleanupLegacyUnscopedDownloads();

    assert.ok(
      result.removedMedia >=
        1,
    );

    assert.ok(
      result.removedJobs >=
        1,
    );

    assert.equal(
      await mediaStore.getMediaRecord(
        "legacy-unscoped-track",
        "v1",
      ),
      null,
    );

    assert.ok(
      await mediaStore.getMediaRecord(
        "scoped-survivor-track",
        "v1",
      ),
    );

    const jobs =
      await mediaStore.getDownloadJobs();

    assert.equal(
      jobs.some(
        (job) =>
          job.id ===
          "legacy-unscoped-job",
      ),
      false,
    );

    assert.equal(
      jobs.some(
        (job) =>
          job.id ===
          "scoped-survivor-job",
      ),
      true,
    );
  },
);
