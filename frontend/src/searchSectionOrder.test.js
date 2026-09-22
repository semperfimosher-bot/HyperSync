import assert from "node:assert/strict";
import {
  readFileSync,
} from "node:fs";
import test from "node:test";


const searchPageSource =
  readFileSync(
    new URL(
      "./components/pages/SearchPage.jsx",
      import.meta.url,
    ),
    "utf8",
  );


test(
  "search discovery panels are alphabetically ordered",
  () => {
    const discoveryIndex =
      searchPageSource.indexOf(
        'className="hs-search-discovery-shell"',
      );

    const discoveryGridIndex =
      searchPageSource.indexOf(
        'className="hs-search-discovery-grid"',
        discoveryIndex,
      );

    const albumIndex =
      searchPageSource.indexOf(
        "{albumPanel}",
        discoveryGridIndex,
      );

    const artistIndex =
      searchPageSource.indexOf(
        "{artistPanel}",
        discoveryGridIndex,
      );

    const collaborationIndex =
      searchPageSource.indexOf(
        "{collaborationPanel}",
        discoveryGridIndex,
      );

    assert.ok(
      discoveryIndex >= 0,
      "Discovery section was not found.",
    );

    assert.ok(
      albumIndex >= 0,
      "Album panel was not found.",
    );

    assert.ok(
      artistIndex >= 0,
      "Artist panel was not found.",
    );

    assert.ok(
      collaborationIndex >= 0,
      "Collaboration panel was not found.",
    );

    assert.ok(
      albumIndex <
        artistIndex,
      "Albums must appear before Artists.",
    );

    assert.ok(
      artistIndex <
        collaborationIndex,
      "Artists must appear before Collaborations.",
    );
  },
);
