import test from "node:test";
import assert from "node:assert/strict";

import {
  looksLikeSmartPlaylistQuery,
} from "./smartPlaylistQuery.js";


test(
  "recognizes vibe playlist searches",
  () => {
    assert.equal(
      looksLikeSmartPlaylistQuery(
        "chill evening music",
      ),
      true,
    );

    assert.equal(
      looksLikeSmartPlaylistQuery(
        "workout hype",
      ),
      true,
    );
  },
);


test(
  "recognizes genre playlist searches",
  () => {
    assert.equal(
      looksLikeSmartPlaylistQuery(
        "country",
      ),
      true,
    );

    assert.equal(
      looksLikeSmartPlaylistQuery(
        "hip hop music",
      ),
      true,
    );
  },
);


test(
  "keeps structured search commands out of smart playlist submission",
  () => {
    assert.equal(
      looksLikeSmartPlaylistQuery(
        "songs by Morgan Wallen",
      ),
      false,
    );

    assert.equal(
      looksLikeSmartPlaylistQuery(
        "recent songs",
      ),
      false,
    );

    assert.equal(
      looksLikeSmartPlaylistQuery(
        "new music",
      ),
      false,
    );
  },
);
