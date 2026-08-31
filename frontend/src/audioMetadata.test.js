import test from "node:test";
import assert from "node:assert/strict";

import {
  applyManualMetadataEdit,
  buildInitialMetadata,
  mergeEmbeddedMetadata,
} from "./utils/audioMetadata.js";


test(
  "initial metadata does not invent an album",
  () => {
    const result =
      buildInitialMetadata(
        (
          "FKi 1st & Post Malone"
          + " - The Meaning.mp3"
        ),
      );

    assert.equal(
      result.title,
      "The Meaning",
    );

    assert.equal(
      result.artist,
      "FKi 1st & Post Malone",
    );

    assert.equal(
      result.album,
      "",
    );

    assert.deepEqual(
      result.metadataEdited,
      {
        title: false,
        artist: false,
        album: false,
        duration: false,
      },
    );
  },
);


test(
  "manual metadata edits are tracked",
  () => {
    const item = {
      title: "Original",
      artist: "Artist",
      album: "",
      duration: 200,

      metadataEdited: {
        title: false,
        artist: false,
        album: false,
        duration: false,
      },
    };

    const result =
      applyManualMetadataEdit(
        item,
        {
          album:
            "Correct Album",
        },
      );

    assert.equal(
      result.album,
      "Correct Album",
    );

    assert.equal(
      result.metadataEdited
        .album,
      true,
    );

    assert.equal(
      result.metadataEdited
        .title,
      false,
    );
  },
);

test(
  "embedded metadata fills title artist and album",
  () => {
    const initial =
      buildInitialMetadata(
        "Unknown - Song.mp3",
      );

    const result =
      mergeEmbeddedMetadata(
        initial,
        {
          title: "The Meaning",
          artist:
            "FKi 1st & Post Malone",
          album:
            "First Time for Everything, Pt. 1",
        },
      );

    assert.equal(
      result.title,
      "The Meaning",
    );

    assert.equal(
      result.artist,
      "FKi 1st & Post Malone",
    );

    assert.equal(
      result.album,
      "First Time for Everything, Pt. 1",
    );

    assert.equal(
      result.metadataEdited.album,
      false,
    );
  },
);
