import assert from "node:assert/strict";
import {
  readFileSync,
} from "node:fs";
import test from "node:test";


const searchApiSource =
  readFileSync(
    new URL(
      "./searchApi.js",
      import.meta.url,
    ),
    "utf8",
  );


test(
  "search sort modes are displayed alphabetically",
  () => {
    const start =
      searchApiSource.indexOf(
        "export const SEARCH_SORT_OPTIONS",
      );

    assert.ok(
      start >= 0,
      "SEARCH_SORT_OPTIONS was not found.",
    );

    const end =
      searchApiSource.indexOf(
        "];",
        start,
      );

    assert.ok(
      end >= 0,
      "SEARCH_SORT_OPTIONS was not closed.",
    );

    const optionsBlock =
      searchApiSource.slice(
        start,
        end,
      );

    const labels = [
      ...optionsBlock.matchAll(
        /label:\s*"([^"]+)"/g,
      ),
    ].map(
      (match) => match[1],
    );

    assert.deepEqual(
      labels,
      [
        "Alphabetical",
        "Artist",
        "Recently listened",
        "Smart Search",
      ],
    );
  },
);
