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
            artworkUrl: "one.jpg",
            title: "Song One",
            artist: "Artist One",
          },
        },
        {
          id: "2",
          meta: {
            artworkUrl: "two.jpg",
            title: "Song Two",
            artist: "Artist Two",
          },
        },
        {
          id: "3",
          meta: {
            artworkUrl: "three.jpg",
            title: "Song Three",
            artist: "Artist Three",
          },
        },
      ],
    );
  },
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
