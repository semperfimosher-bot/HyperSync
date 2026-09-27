import test from "node:test";
import assert from "node:assert/strict";

import {
  isOnDemandTrackId,
  normalizeOnDemandTrack,
  onDemandTrackId,
} from "./onDemandMusic.js";


test(
  "on-demand ids are isolated from catalog UUIDs",
  () => {
    const id =
      onDemandTrackId(
        "music:abc123",
      );

    assert.equal(
      id,
      "ondemand:music:abc123",
    );

    assert.equal(
      isOnDemandTrackId(
        id,
      ),
      true,
    );

    assert.equal(
      isOnDemandTrackId(
        "9e061d5c-5ae4-4db9-8bb1-ef55bdd7af33",
      ),
      false,
    );
  },
);


test(
  "normalizes remote metadata into a search-track shape",
  () => {
    assert.deepEqual(
      normalizeOnDemandTrack({
        provision_key:
          "music:track",
        title:
          "Love Somebody",
        artist:
          "Morgan Wallen",
        album:
          "One Thing at a Time",
        artwork_url:
          "https://example.test/art.jpg",
        duration_seconds:
          204,
      }),
      {
        id:
          "ondemand:music:track",
        provision_key:
          "music:track",
        source_type:
          "on_demand",
        title:
          "Love Somebody",
        artist:
          "Morgan Wallen",
        album:
          "One Thing at a Time",
        genre:
          null,
        release_year:
          null,
        duration_seconds:
          204,
        audio_url:
          null,
        artwork_url:
          "https://example.test/art.jpg",
        mime_type:
          null,
        file_size:
          null,
        media_version:
          null,
        artwork_version:
          null,
        match_label:
          "AVAILABLE ON DEMAND",
        matched_field:
          "external",
        user_play_count:
          0,
        global_play_count:
          0,
        provider:
          null,
        confidence:
          null,
        isrc:
          null,
      },
    );
  },
);
