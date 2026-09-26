import test from "node:test";
import assert from "node:assert/strict";


async function loadQueueModule() {
  return import("./playerQueue.js")
    .catch(() => ({}));
}


test(
  "buildTrackQueue preserves track order and metadata",
  async () => {
    const queueModule =
      await loadQueueModule();

    assert.equal(
      typeof queueModule.buildTrackQueue,
      "function",
    );

    const queue =
      queueModule.buildTrackQueue([
        {
          id: 1,
          title: "Song One",
          artist: "Artist One",
          artworkUrl: "one.jpg",
          mime_type: "audio/mpeg",
          file_size: 5_000_000,
          media_version:
            "media-version-one",
        },
        {
          id: 2,
          title: "Song Two",
          artist: "Artist Two",
          artworkUrl: "two.jpg",
        },
        {
          id: 3,
          title: "Song Three",
          artist: "Artist Three",
          artworkUrl: "three.jpg",
        },
      ]);

    assert.deepEqual(
  queue,
  [
    {
      id: "1",
      meta: {
        audioUrl: null,
        artworkUrl: "one.jpg",
        title: "Song One",
        artist: "Artist One",
        album: "",
        mimeType: "audio/mpeg",
        fileSize: 5_000_000,
        mediaVersion:
          "media-version-one",
        artworkVersion:
          null,
        durationSeconds:
          null,
      },
    },
    {
      id: "2",
      meta: {
        audioUrl: null,
        artworkUrl: "two.jpg",
        title: "Song Two",
        artist: "Artist Two",
        album: "",
        mimeType: null,
        fileSize: null,
        mediaVersion: null,
        artworkVersion:
          null,
        durationSeconds:
          null,
      },
    },
    {
      id: "3",
      meta: {
        audioUrl: null,
        artworkUrl: "three.jpg",
        title: "Song Three",
        artist: "Artist Three",
        album: "",
        mimeType: null,
        fileSize: null,
        mediaVersion: null,
        artworkVersion:
          null,
        durationSeconds:
          null,
      },
    },
  ],
);


test(
  "getNextQueueIndex advances in order",
  async () => {
    const queueModule =
      await loadQueueModule();

    assert.equal(
      typeof queueModule.getNextQueueIndex,
      "function",
    );

    const queue = [
      { id: "1" },
      { id: "2" },
      { id: "3" },
    ];

    assert.equal(
      queueModule.getNextQueueIndex(
        queue,
        0,
      ),
      1,
    );

    assert.equal(
      queueModule.getNextQueueIndex(
        queue,
        1,
      ),
      2,
    );
  },
);


test(
  "getNextQueueIndex stops at the end of the queue",
  async () => {
    const queueModule =
      await loadQueueModule();

    assert.equal(
      typeof queueModule.getNextQueueIndex,
      "function",
    );

    const queue = [
      { id: "1" },
      { id: "2" },
      { id: "3" },
    ];

    assert.equal(
      queueModule.getNextQueueIndex(
        queue,
        2,
      ),
      -1,
    );
  },
);

test(
  "getUpcomingQueueEntries returns only tracks after the current track",
  async () => {
    const queueModule =
      await loadQueueModule();

    assert.equal(
      typeof queueModule.getUpcomingQueueEntries,
      "function",
    );

    const queue = [
      {
        id: "1",
        meta: {
          title: "Song One",
        },
      },
      {
        id: "2",
        meta: {
          title: "Song Two",
        },
      },
      {
        id: "3",
        meta: {
          title: "Song Three",
        },
      },
    ];

    assert.deepEqual(
      queueModule.getUpcomingQueueEntries(
        queue,
        0,
      ),
      [
        {
          queueIndex: 1,
          track: queue[1],
        },
        {
          queueIndex: 2,
          track: queue[2],
        },
      ],
    );
  },
);


test(
  "getQueueTrackAtIndex safely selects a queued track",
  async () => {
    const queueModule =
      await loadQueueModule();

    assert.equal(
      typeof queueModule.getQueueTrackAtIndex,
      "function",
    );

    const queue = [
      { id: "1" },
      { id: "2" },
      { id: "3" },
    ];

    assert.equal(
      queueModule.getQueueTrackAtIndex(
        queue,
        1,
      ),
      queue[1],
    );

    assert.equal(
      queueModule.getQueueTrackAtIndex(
        queue,
        99,
      ),
      null,
    );

    assert.equal(
      queueModule.getQueueTrackAtIndex(
        queue,
        -1,
      ),
      null,
    );
  },
);

test(
  "queue preserves direct audio URL",
  async () => {
    const queueModule =
      await loadQueueModule();

    const queue =
      queueModule.buildTrackQueue([
        {
          id: "123",
          title: "Fast Song",
          artist: "HyperSync",
          audio_url:
            "https://s3.example.test/audio.mp3",
          artwork_url:
            "https://s3.example.test/art.jpg",
        },
      ]);

    assert.equal(
      queue[0].meta.audioUrl,
      "https://s3.example.test/audio.mp3",
    );
  },
);


test(
  "audio source prefers direct URL",
  async () => {
    const queueModule =
      await loadQueueModule();

    assert.equal(
      queueModule.getTrackAudioSource(
        "123",
        {
          audioUrl:
            "https://s3.example.test/audio.mp3",
        },
      ),
      "https://s3.example.test/audio.mp3",
    );

    assert.equal(
      queueModule.getTrackAudioSource(
        "123",
        {},
      ),
      "/api/audio/123",
    );
  },
);
})

test(
  "controlled playback uses stable media identity instead of a signed audio URL",
  async () => {
    const queueModule =
      await loadQueueModule();

    assert.equal(
      queueModule.getTrackAudioSource(
        "track 123",
        {
          audioUrl:
            "https://signed.example/audio?token=changing",
          mediaVersion:
            "version/abc",
        },
        {
          useStableMediaRoute:
            true,
        },
      ),
      "/__hypersync/media/track%20123/version%2Fabc",
    );
  },
);

test(
  "insertQueueEntryAsNext places a manual track directly after the current song",
  async () => {
    const queueModule =
      await loadQueueModule();

    const queue = [
      { id: "current" },
      { id: "auto-1" },
      { id: "auto-2" },
    ];

    const next = {
      id: "manual",
      meta: {
        title: "Play Me Next",
        artist: "Correct Artist",
      },
    };

    assert.deepEqual(
      queueModule.insertQueueEntryAsNext(
        queue,
        0,
        next,
      ),
      [
        queue[0],
        next,
        queue[1],
        queue[2],
      ],
    );
  },
);


test(
  "insertQueueEntryAsNext moves an existing upcoming track instead of duplicating it",
  async () => {
    const queueModule =
      await loadQueueModule();

    const current = {
      id: "current",
    };

    const existing = {
      id: "move-me",
      meta: {
        title: "Existing",
      },
    };

    const queue = [
      current,
      { id: "other" },
      existing,
      { id: "later" },
    ];

    const moved = {
      id: "move-me",
      meta: {
        title: "Fresh Metadata",
        artist: "Fresh Artist",
      },
    };

    assert.deepEqual(
      queueModule.insertQueueEntryAsNext(
        queue,
        0,
        moved,
      ),
      [
        current,
        moved,
        queue[1],
        queue[3],
      ],
    );
  },
);


test(
  "buildTrackQueue keeps album artwork version and duration metadata",
  async () => {
    const queueModule =
      await loadQueueModule();

    const [entry] =
      queueModule.buildTrackQueue([
        {
          id: "meta-track",
          title: "Song",
          artist: "Artist",
          album: "Album",
          genre: "Country",
          release_year: 2024,
          artwork_version:
            "art-v2",
          duration_seconds:
            321,
        },
      ]);

    assert.equal(
      entry.meta.album,
      "Album",
    );

    assert.equal(
      entry.meta.artist,
      "Artist",
    );

    assert.equal(
      entry.meta.genre,
      "Country",
    );

    assert.equal(
      entry.meta.releaseYear,
      2024,
    );

    assert.equal(
      entry.meta.artworkVersion,
      "art-v2",
    );

    assert.equal(
      entry.meta.durationSeconds,
      321,
    );
  },
);

