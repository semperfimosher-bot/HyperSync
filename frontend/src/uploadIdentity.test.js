import assert from "node:assert/strict";
import test from "node:test";

import {
  buildUploadIdentity,
  findCatalogDuplicate,
  findQueuedUploadDuplicates,
  normalizeUploadIdentityText,
  normalizeUploadTitleIdentityText,
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
  "upload title identity collapses versions to the same root song",
  () => {
    const root =
      buildUploadIdentity({
        artist:
          "Morgan Wallen",
        title:
          "Love Somebody",
      });

    for (const versionTitle of [
      "Love Somebody (Remix)",
      "Love Somebody [2026 Remaster]",
      "Love Somebody - Acoustic Version",
      "Love Somebody Live",
      "Love Somebody Sped Up",
      "Love Somebody Slowed + Reverb",
    ]) {
      assert.equal(
        buildUploadIdentity({
          artist:
            "Morgan Wallen",
          title:
            versionTitle,
        }),
        root,
      );
    }

    assert.equal(
      normalizeUploadTitleIdentityText(
        "Sweet Dreams (Are Made of This)",
      ),
      "sweet dreams (are made of this)",
    );

    assert.notEqual(
      buildUploadIdentity({
        artist:
          "Different Artist",
        title:
          "Love Somebody (Remix)",
      }),
      root,
    );
  },
);


test(
  "root song versions are prevented as queued and catalog duplicates",
  () => {
    const original = {
      id:
        "original",
      status:
        "queued",
      artist:
        "Morgan Wallen",
      title:
        "Love Somebody",
    };

    const remix = {
      id:
        "remix",
      status:
        "queued",
      artist:
        "Morgan Wallen",
      title:
        "Love Somebody (Remix)",
    };

    const queueDuplicates =
      findQueuedUploadDuplicates([
        original,
        remix,
      ]);

    assert.equal(
      queueDuplicates.get(
        "remix",
      ),
      original,
    );

    assert.equal(
      findCatalogDuplicate(
        remix,
        [
          {
            id:
              "catalog-root",
            artist:
              "Morgan Wallen",
            title:
              "Love Somebody",
          },
        ],
      )?.id,
      "catalog-root",
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
