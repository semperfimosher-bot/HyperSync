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
      source_type: "catalog",
      provision_key: "candidate-1",
      provision_id: "provision-1",
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
      onDemand: false,
      provisionKey: "candidate-1",
      provisionId: "provision-1",
      catalogTrackId: "catalog-1",
    });
  },
);


test(
  "search playback queue entries support on-demand tracks and explicit overrides",
  () => {
    const entry = searchPlaybackQueueEntry(
      {
        id: "ondemand:candidate-2",
        source_type: "on_demand",
        title: "Preparing Track",
        audioUrl: "/temporary/stream",
        artworkUrl: "https://cdn.example.test/cover.jpg",
        releaseYear: 2024,
        durationSeconds: 91,
      },
      {
        id: "temporary-playback-id",
        audioUrl: "/resolved/stream",
        onDemand: false,
        provisionKey: "override-key",
        provisionId: "override-provision",
        catalogTrackId: "resolved-catalog-id",
      },
    );

    assert.equal(entry.id, "temporary-playback-id");
    assert.equal(entry.audioUrl, "/resolved/stream");
    assert.equal(entry.onDemand, false);
    assert.equal(entry.provisionKey, "override-key");
    assert.equal(entry.provisionId, "override-provision");
    assert.equal(entry.catalogTrackId, "resolved-catalog-id");
    assert.equal(entry.artworkUrl, "https://cdn.example.test/cover.jpg");
    assert.equal(entry.releaseYear, 2024);
    assert.equal(entry.durationSeconds, 91);
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
        onDemand: false,
        provisionKey: null,
        provisionId: null,
        catalogTrackId: null,
      },
    );
  },
);
