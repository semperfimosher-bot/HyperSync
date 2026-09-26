import assert from "node:assert/strict";
import test from "node:test";

import {
  addTrackGroupSelection,
  getTrackGroupSelectionState,
  pruneTrackSelection,
  toggleTrackGroupSelection,
  toggleTrackSelection,
} from "./catalogSelection.js";


test(
  "right-click style track toggles preserve earlier selections",
  () => {
    let selection =
      new Set();

    selection =
      toggleTrackSelection(
        selection,
        "track-1",
      );

    selection =
      toggleTrackSelection(
        selection,
        "track-2",
      );

    assert.deepEqual(
      Array.from(
        selection,
      ).sort(),
      [
        "track-1",
        "track-2",
      ],
    );

    selection =
      toggleTrackSelection(
        selection,
        "track-1",
      );

    assert.deepEqual(
      Array.from(
        selection,
      ),
      [
        "track-2",
      ],
    );
  },
);


test(
  "artist group toggle selects and deselects every song by that artist",
  () => {
    const artistTracks = [
      "track-1",
      "track-2",
      "track-3",
    ];

    const selected =
      toggleTrackGroupSelection(
        new Set([
          "other-track",
        ]),
        artistTracks,
      );

    assert.deepEqual(
      new Set(
        selected,
      ),
      new Set([
        "other-track",
        ...artistTracks,
      ]),
    );

    const cleared =
      toggleTrackGroupSelection(
        selected,
        artistTracks,
      );

    assert.deepEqual(
      new Set(
        cleared,
      ),
      new Set([
        "other-track",
      ]),
    );
  },
);


test(
  "select all shown adds tracks without clearing existing selection",
  () => {
    const selection =
      addTrackGroupSelection(
        new Set([
          "existing",
        ]),
        [
          "visible-1",
          "visible-2",
        ],
      );

    assert.deepEqual(
      new Set(
        selection,
      ),
      new Set([
        "existing",
        "visible-1",
        "visible-2",
      ]),
    );
  },
);


test(
  "selection is pruned after catalog tracks disappear",
  () => {
    const selection =
      pruneTrackSelection(
        new Set([
          "keep",
          "deleted",
        ]),
        [
          {
            id:
              "keep",
          },
        ],
      );

    assert.deepEqual(
      Array.from(
        selection,
      ),
      [
        "keep",
      ],
    );
  },
);


test(
  "artist folders expose partial and full selection state",
  () => {
    assert.deepEqual(
      getTrackGroupSelectionState(
        new Set([
          "track-1",
        ]),
        [
          "track-1",
          "track-2",
        ],
      ),
      {
        selectedCount:
          1,
        totalCount:
          2,
        allSelected:
          false,
        partiallySelected:
          true,
      },
    );

    assert.equal(
      getTrackGroupSelectionState(
        new Set([
          "track-1",
          "track-2",
        ]),
        [
          "track-1",
          "track-2",
        ],
      ).allSelected,
      true,
    );
  },
);
