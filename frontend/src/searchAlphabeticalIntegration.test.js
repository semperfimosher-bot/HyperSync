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
  "SearchPage uses alphabetical results consistently",
  () => {
    assert.match(
      searchPageSource,
      /import\s*\{\s*alphabetizeSearchResults\s*,?\s*\}\s*from\s*["']\.\.\/\.\.\/searchAlphabetical\.js["'];/,
      "Expected SearchPage to import alphabetizeSearchResults.",
    );

    assert.match(
      searchPageSource,
      /const\s+alphabeticalResults\s*=\s*useMemo\([\s\S]*?alphabetizeSearchResults\(\s*results\s*,?\s*\)/,
      "Expected SearchPage to memoize alphabetical results.",
    );

    assert.match(
      searchPageSource,
      /pickTopSignal\(\s*alphabeticalResults\s*,?\s*\)/,
      "Top Signal must use the same alphabetical results.",
    );

    assert.match(
      searchPageSource,
      /alphabeticalResults\.tracks\.map\(/,
      "Track rows must use alphabeticalResults.tracks.",
    );

    assert.match(
      searchPageSource,
      /alphabeticalResults\.artists\.map\(/,
      "Artist cards must use alphabeticalResults.artists.",
    );

    assert.match(
      searchPageSource,
      /alphabeticalResults\.collaborations\.map\(/,
      "Collaboration cards must use alphabeticalResults.collaborations.",
    );

    assert.match(
      searchPageSource,
      /alphabeticalResults\.albums\.map\(/,
      "Album cards must use alphabeticalResults.albums.",
    );

    assert.match(
      searchPageSource,
      /alphabeticalResults\.people\.map\(/,
      "People rows must use alphabeticalResults.people.",
    );
  },
);
