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
  "search filter tabs are alphabetically ordered after All",
  () => {
    const start =
      searchPageSource.indexOf(
        "const FILTERS = [",
      );

    assert.ok(
      start >= 0,
      "FILTERS was not found.",
    );

    const end =
      searchPageSource.indexOf(
        "];",
        start,
      );

    assert.ok(
      end >= 0,
      "FILTERS was not closed.",
    );

    const filtersBlock =
      searchPageSource.slice(
        start,
        end,
      );

    const labels = [
      ...filtersBlock.matchAll(
        /\[\s*"[^"]+"\s*,\s*"([^"]+)"\s*,?\s*\]/g,
      ),
    ].map(
      (match) => match[1],
    );

    assert.deepEqual(
      labels,
      [
        "All",
        "Albums",
        "Artists",
        "Collaborations",
        "People",
        "Tracks",
      ],
    );
  },
);
