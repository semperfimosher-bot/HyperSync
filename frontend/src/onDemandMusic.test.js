import test from "node:test";
import assert from "node:assert/strict";

import {
  buildOnDemandArtistPlaylist,
  inferOnDemandArtistName,
  isOnDemandTrackId,
  normalizeOnDemandTrack,
  onDemandArtistLookupQuery,
  onDemandPollDelay,
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
        track_number:
          null,
        disc_number:
          null,
      },
    );
  },
);


test(
  "infers an exact missing artist from on-demand metadata",
  () => {
    assert.equal(
      inferOnDemandArtistName(
        "Morgan Wallen",
        [
          {
            artist:
              "Morgan Wallen",
          },
          {
            artist:
              "Tate McRae & Morgan Wallen",
          },
        ],
      ),
      "Morgan Wallen",
    );

    assert.equal(
      inferOnDemandArtistName(
        "songs by Morgan Wallen",
        [
          {
            artist:
              "Morgan Wallen",
          },
        ],
      ),
      "Morgan Wallen",
    );
  },
);


test(
  "metadata artist playlist deduplicates and caps at 500 tracks",
  () => {
    const onDemandTracks =
      Array.from(
        {
          length:
            499,
        },
        (
          _,
          index,
        ) => ({
          id:
            `ondemand:track-${index}`,
          provision_key:
            `track-${index}`,
          source_type:
            "on_demand",
          title:
            `Song ${index}`,
          artist:
            "Example Artist",
          artwork_url:
            index === 0
              ? "cover.jpg"
              : null,
        }),
      );

    onDemandTracks.splice(
      2,
      0,
      {
        id:
          "ondemand:duplicate",
        provision_key:
          "duplicate",
        source_type:
          "on_demand",
        title:
          "Song 0",
        artist:
          "Example Artist",
      },
      {
        id:
          "ondemand:feature",
        provision_key:
          "feature",
        source_type:
          "on_demand",
        title:
          "Feature",
        artist:
          "Other Artist & Example Artist",
      },
    );

    for (
      let index = 499;
      index < 520;
      index += 1
    ) {
      onDemandTracks.push({
        id:
          `ondemand:track-${index}`,
        provision_key:
          `track-${index}`,
        source_type:
          "on_demand",
        title:
          `Song ${index}`,
        artist:
          "Example Artist",
      });
    }

    const playlist =
      buildOnDemandArtistPlaylist({
        artistName:
          "Example Artist",
        onDemandTracks,
      });

    assert.equal(
      playlist.transient,
      true,
    );

    assert.equal(
      playlist.tracks.length,
      500,
    );

    assert.equal(
      playlist.tracks.filter(
        (track) =>
          track.title ===
          "Song 0",
      ).length,
      1,
    );

    assert.equal(
      playlist.tracks.some(
        (track) =>
          track.title ===
          "Feature",
      ),
      false,
    );
  },
);


test(
  "on-demand status polling backs off after failures",
  () => {
    assert.equal(
      onDemandPollDelay(0),
      1500,
    );

    assert.equal(
      onDemandPollDelay(1),
      3000,
    );

    assert.equal(
      onDemandPollDelay(4),
      24000,
    );

    assert.equal(
      onDemandPollDelay(20),
      30000,
    );
  },
);


test(
  "artist lookup query handles direct and songs-by searches",
  () => {
    assert.equal(
      onDemandArtistLookupQuery(
        "Kane Brown",
      ),
      "Kane Brown",
    );

    assert.equal(
      onDemandArtistLookupQuery(
        "songs by   Kane Brown",
      ),
      "Kane Brown",
    );
  },
);
