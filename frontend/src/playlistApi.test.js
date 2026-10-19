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
  "explicit library and playlist pages keep the requested limit and offset",
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
      await getLibraryTracks({
        offset: 50,
      });
      await getPlaylist("playlist-2", {
        offset: 50,
      });

      assert.deepEqual(requested, [
        "/api/playlists/library/tracks?limit=25&offset=50",
        "/api/playlists/playlist-1?limit=25&offset=50",
        "/api/playlists/library/tracks?limit=1000&offset=50",
        "/api/playlists/playlist-2?limit=1000&offset=50",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
);


test(
  "explicit first library page makes one bounded request without fetching the whole library",
  async () => {
    const originalFetch = globalThis.fetch;
    const requested = [];
    const page = Array.from({ length: 1000 }, (_, index) => ({
      id: `track-${index}`,
    }));

    globalThis.fetch = async (url) => {
      requested.push(String(url));
      return new Response(JSON.stringify(page), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    try {
      const result = await getLibraryTracks({
        limit: 1000,
        offset: 0,
      });

      assert.equal(result.length, 1000);
      assert.deepEqual(requested, [
        "/api/playlists/library/tracks?limit=1000&offset=0",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
);


test(
  "default library and playlist reads aggregate pages without losing order or metadata",
  async () => {
    const originalFetch = globalThis.fetch;
    const requested = [];
    const libraryTracks = Array.from(
      { length: 1001 },
      (_, index) => ({
        id: `library-${index}`,
      }),
    );
    const playlistTracks = Array.from(
      { length: 1001 },
      (_, index) => ({
        id: `playlist-track-${index}`,
      }),
    );

    globalThis.fetch = async (url) => {
      const requestUrl = new URL(
        String(url),
        "https://hypersync.test",
      );
      const offset = Number(
        requestUrl.searchParams.get("offset") ?? 0,
      );
      requested.push(
        requestUrl.pathname + requestUrl.search,
      );

      const source = requestUrl.pathname.endsWith(
        "/library/tracks",
      )
        ? libraryTracks
        : playlistTracks;
      const page = source.slice(
        offset,
        offset + 1000,
      );
      const body = requestUrl.pathname.endsWith(
        "/library/tracks",
      )
        ? page
        : {
            id: "playlist-1",
            title: "Large playlist",
            track_count: playlistTracks.length,
            tracks: page,
          };

      return new Response(
        JSON.stringify(body),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    };

    try {
      const library = await getLibraryTracks();
      const playlist = await getPlaylist("playlist-1");

      assert.equal(library.length, 1001);
      assert.equal(library[0].id, "library-0");
      assert.equal(library[1000].id, "library-1000");
      assert.equal(playlist.tracks.length, 1001);
      assert.equal(
        playlist.tracks[0].id,
        "playlist-track-0",
      );
      assert.equal(
        playlist.tracks[1000].id,
        "playlist-track-1000",
      );
      assert.equal(playlist.track_count, 1001);
      assert.deepEqual(requested, [
        "/api/playlists/library/tracks?limit=1000&offset=0",
        "/api/playlists/library/tracks?limit=1000&offset=1000",
        "/api/playlists/playlist-1?limit=1000&offset=0",
        "/api/playlists/playlist-1?limit=1000&offset=1000",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
);
