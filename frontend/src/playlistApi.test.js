import test from "node:test";
import assert from "node:assert/strict";

const {
  getLibraryTrack,
  getLibraryTracks,
  getPlaylist,
} = await import("./playlistApi.js");


test(
  "single-track lookup requests only the selected catalog track",
  async () => {
    const originalFetch = globalThis.fetch;
    const requested = [];
    const track = {
      id: "track/with spaces",
      title: "Example",
      artist: "Artist",
      audio_url: "/api/audio/example",
    };

    globalThis.fetch = async (url) => {
      requested.push(String(url));

      return new Response(
        JSON.stringify(track),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    };

    try {
      const result = await getLibraryTrack(
        "track/with spaces",
      );

      assert.deepEqual(result, track);
      assert.deepEqual(
        requested,
        ["/api/catalog/tracks/track%2Fwith%20spaces"],
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
);


test(
  "single-track lookup safely falls back when the catalog request fails",
  async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          detail: "Track not found.",
        }),
        {
          status: 404,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );

    try {
      assert.equal(
        await getLibraryTrack("missing-track"),
        null,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
);


test(
  "single-track lookup skips empty track IDs without making a request",
  async () => {
    const originalFetch = globalThis.fetch;
    let requested = false;

    globalThis.fetch = async () => {
      requested = true;
      throw new Error("Unexpected request");
    };

    try {
      assert.equal(
        await getLibraryTrack("  "),
        null,
      );
      assert.equal(requested, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
);


test(
  "library and playlist APIs support opt-in pagination without changing defaults",
  async () => {
    const originalFetch = globalThis.fetch;
    const requested = [];

    globalThis.fetch = async (url) => {
      requested.push(String(url));
      return new Response("[]", {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    };

    try {
      await getLibraryTracks({
        limit: 25,
        offset: 50,
      });
      await getPlaylist("playlist-1", {
        limit: 25,
        offset: 50,
      });
      await getLibraryTracks();
      await getPlaylist("playlist-1");

      assert.deepEqual(requested, [
        "/api/playlists/library/tracks?limit=25&offset=50",
        "/api/playlists/playlist-1?limit=25&offset=50",
        "/api/playlists/library/tracks",
        "/api/playlists/playlist-1",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
);
