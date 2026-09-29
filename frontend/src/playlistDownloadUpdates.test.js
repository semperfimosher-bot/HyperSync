import test from "node:test";
import assert from "node:assert/strict";

import {
  findMissingPlaylistTracks,
  mergeDetectedPlaylistUpdates,
  missingPlaylistDownloadProgress,
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


test(
  "detected updates preserve an active download for the same key",
  () => {
    const downloading = {
      key: "playlist|track",
      status: "downloading",
      progress: 0.45,
    };

    const merged =
      mergeDetectedPlaylistUpdates(
        [
          downloading,
        ],
        [
          {
            key: "playlist|track",
            status: "ready",
            progress: 0,
          },
          {
            key: "other|track",
            status: "ready",
            progress: 0,
          },
        ],
      );

    assert.equal(
      merged[0],
      downloading,
    );

    assert.equal(
      merged[1].key,
      "other|track",
    );
  },
);


test(
  "missing playlist progress averages only missing tracks safely",
  () => {
    const missing = [
      {
        id: "one",
      },
      {
        id: "two",
      },
    ];

    assert.equal(
      missingPlaylistDownloadProgress(
        missing,
        {
          one: {
            progress: 0.5,
          },
          two: {
            progress: 1,
          },
        },
      ),
      0.75,
    );

    assert.equal(
      missingPlaylistDownloadProgress(
        [],
        {},
      ),
      1,
    );

    assert.equal(
      missingPlaylistDownloadProgress(
        missing,
        {
          one: {
            progress: 4,
          },
          two: {
            progress: -2,
          },
        },
      ),
      0.5,
    );
  },
);
