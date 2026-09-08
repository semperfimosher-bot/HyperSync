import assert from "node:assert/strict";
import {
  readFileSync,
} from "node:fs";
import test from "node:test";


const constantsSource =
  readFileSync(
    new URL(
      "./constants.js",
      import.meta.url,
    ),
    "utf8",
  );


test(
  "search quick commands are alphabetically ordered",
  () => {
    const start =
      constantsSource.indexOf(
        "export const SEARCH_QUICK_COMMANDS",
      );

    assert.ok(
      start >= 0,
      "SEARCH_QUICK_COMMANDS was not found.",
    );

    const end =
      constantsSource.indexOf(
        "];",
        start,
      );

    assert.ok(
      end >= 0,
      "SEARCH_QUICK_COMMANDS was not closed.",
    );

    const commandsBlock =
      constantsSource.slice(
        start,
        end,
      );

    const labels = [
      ...commandsBlock.matchAll(
        /label:\s*"([^"]+)"/g,
      ),
    ].map(
      (match) => match[1],
    );

    assert.deepEqual(
      labels,
      [
        "Find People",
        "Most Played",
        "New Releases",
        "Recently Played",
        "Top Albums",
        "Top Artists",
      ],
    );
  },
);
