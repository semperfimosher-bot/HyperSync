import assert from "node:assert/strict";
import test from "node:test";

import {
  buildUploadIdentity,
  findCatalogDuplicate,
  findQueuedUploadDuplicates,
  normalizeUploadIdentityText,
} from "./uploadIdentity.js";


test(
  "upload identity ignores case whitespace and compatible unicode",
  () => {
    assert.equal(
      normalizeUploadIdentityText(
        "  The   Weeknd  ",
      ),
      "the weeknd",
    );

    assert.equal(
      buildUploadIdentity({
        artist:
          "Ｔｈｅ Weeknd",
        title:
          "  Blinding   Lights ",
      }),
      buildUploadIdentity({
        artist:
          "the weeknd",
        title:
          "blinding lights",
      }),
    );
  },
);


test(
  "duplicate queue entries are identified by artist and title",
  () => {
    const first = {
      id:
        "first",
      status:
        "queued",
      artist:
        "Post Malone",
      title:
        "Circles",
    };

    const second = {
      id:
        "second",
      status:
        "queued",
      artist:
        " post   malone ",
      title:
        "CIRCLES",
    };

    const differentArtist = {
      id:
        "third",
      status:
        "queued",
      artist:
        "Different Artist",
      title:
        "Circles",
    };

    const duplicates =
      findQueuedUploadDuplicates([
        first,
        second,
        differentArtist,
      ]);

    assert.equal(
      duplicates.size,
      1,
    );

    assert.equal(
      duplicates.get(
        "second",
      ),
      first,
    );

    assert.equal(
      duplicates.has(
        "third",
      ),
      false,
    );
  },
);


test(
  "catalog duplicate requires both matching artist and title",
  () => {
    const existing = {
      id:
        "track-1",
      artist:
        "SZA",
      title:
        "Saturn",
    };

    assert.equal(
      findCatalogDuplicate(
        {
          artist:
            " sza ",
          title:
            "SATURN",
        },
        [
          existing,
        ],
      ),
      existing,
    );

    assert.equal(
      findCatalogDuplicate(
        {
          artist:
            "Another Artist",
          title:
            "Saturn",
        },
        [
          existing,
        ],
      ),
      null,
    );
  },
);
