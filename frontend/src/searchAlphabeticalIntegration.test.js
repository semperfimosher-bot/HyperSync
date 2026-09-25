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
  "SearchPage uses intent-aware display ordering consistently",
  () => {
    assert.match(
      searchPageSource,
      /import\s*\{\s*orderSearchResultsForDisplay\s*,?\s*\}\s*from\s*["']\.\.\/\.\.\/searchAlphabetical\.js["'];/,
      "Expected SearchPage to import orderSearchResultsForDisplay.",
    );

    assert.match(
      searchPageSource,
      /const\s+displayResults\s*=\s*useMemo\([\s\S]*?orderSearchResultsForDisplay\(\s*results\s*,?\s*\)/,
      "Expected SearchPage to memoize display-ordered results.",
    );

    assert.match(
      searchPageSource,
      /pickTopSignal\(\s*displayResults\s*,?\s*\)/,
      "Top Signal must use the same alphabetical results.",
    );

    assert.match(
      searchPageSource,
      /displayResults\.tracks\.map\(/,
      "Track rows must use displayResults.tracks.",
    );

    assert.match(
      searchPageSource,
      /displayResults\.artists\.map\(/,
      "Artist cards must use displayResults.artists.",
    );

    assert.match(
      searchPageSource,
      /displayResults\.collaborations\.map\(/,
      "Collaboration cards must use displayResults.collaborations.",
    );

    assert.match(
      searchPageSource,
      /displayResults\.albums\.map\(/,
      "Album cards must use displayResults.albums.",
    );

    assert.match(
      searchPageSource,
      /displayResults\.people\.map\(/,
      "People rows must use displayResults.people.",
    );
  },
);
