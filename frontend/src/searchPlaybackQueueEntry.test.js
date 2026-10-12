import assert from "node:assert/strict";
import test from "node:test";

import {
  searchPlaybackQueueEntry,
} from "./searchPlaybackQueueEntry.js";


test(
  "search playback queue entries preserve track metadata and normalize field names",
  () => {
    const entry = searchPlaybackQueueEntry({
      id: "track-1",
      audio_url: "/api/audio/track-1",
      artwork_url: "https://cdn.example.test/art.jpg",
      mime_type: "audio/mpeg",
      file_size: 2048,
      media_version: "v3",
      title: "Example Track",
      artist: "Example Artist",
      album: "Example Album",
      genre: "Electronic",
      release_year: 2025,
      duration_seconds: 183,
      catalog_track_id: "catalog-1",
    });

    assert.deepEqual(entry, {
      id: "track-1",
      audioUrl: "/api/audio/track-1",
      artworkUrl: "https://cdn.example.test/art.jpg",
      mimeType: "audio/mpeg",
      fileSize: 2048,
      mediaVersion: "v3",
      title: "Example Track",
      artist: "Example Artist",
      album: "Example Album",
      genre: "Electronic",
      releaseYear: 2025,
      durationSeconds: 183,
      catalogTrackId: "catalog-1",
    });
  },
);


test(
  "search playback queue entries provide safe defaults for missing metadata",
  () => {
    assert.deepEqual(
      searchPlaybackQueueEntry(null),
      {
        id: undefined,
        audioUrl: null,
        artworkUrl: null,
        mimeType: null,
        fileSize: null,
        mediaVersion: null,
        title: "",
        artist: "",
        album: "",
        genre: "",
        releaseYear: null,
        durationSeconds: null,
        catalogTrackId: null,
      },
    );
  },
);
