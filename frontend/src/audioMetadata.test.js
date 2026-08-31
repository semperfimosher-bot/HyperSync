import test from "node:test";
import assert from "node:assert/strict";

import {
  applyManualMetadataEdit,
  buildInitialMetadata,
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
