import test from "node:test";
import assert from "node:assert/strict";

import {
  findMissingPlaylistTracks,
  playlistUpdateKey,
} from "./playlistDownloadUpdates.js";


test(
  "generated playlist update detection returns only new offline media",
  () => {
    const livePlaylist = {
      id: "playlist-1",
      tracks: [
        {
          id: "track-1",
          media_version: "v1",
        },
        {
          id: "track-2",
          media_version: "v1",
        },
        {
          id: "track-3",
          media_version: "v1",
        },
      ],
    };

    const downloadedPlaylist = {
      id: "playlist-1",
      tracks: [
        {
          id: "track-1",
          media_version: "v1",
        },
        {
          id: "track-2",
          media_version: "v1",
        },
      ],
    };

    const missing =
      findMissingPlaylistTracks(
        livePlaylist,
        downloadedPlaylist,
      );

    assert.deepEqual(
      missing.map(
        (track) => track.id,
      ),
      ["track-3"],
    );

    assert.equal(
      playlistUpdateKey(
        livePlaylist,
        missing,
      ),
      "playlist-1|track-3::v1",
    );
  },
);


test(
  "changed media versions are treated as downloadable updates",
  () => {
    const missing =
      findMissingPlaylistTracks(
        {
          id: "playlist-2",
          tracks: [
            {
              id: "track-1",
              media_version:
                "v2",
            },
          ],
        },
        {
          id: "playlist-2",
          tracks: [
            {
              id: "track-1",
              media_version:
                "v1",
            },
          ],
        },
      );

    assert.equal(
      missing.length,
      1,
    );
  },
);
