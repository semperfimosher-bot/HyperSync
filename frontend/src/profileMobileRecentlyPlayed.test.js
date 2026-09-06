import assert from "node:assert/strict";
import {
  readFileSync,
} from "node:fs";
import test from "node:test";


const profileCss = readFileSync(
  new URL(
    "./styles/profile.css",
    import.meta.url,
  ),
  "utf8",
);


const mobileStart =
  profileCss.indexOf(
    "@media (\n  max-width: 520px",
  );


const mobileCss =
  profileCss.slice(
    mobileStart,
  );


test(
  "recently played uses rows on mobile",
  () => {
    assert.ok(
      mobileStart >= 0,
      "Expected the 520px mobile media query.",
    );

    assert.match(
      mobileCss,
      /\.hs-recent-grid\s*\{[\s\S]*?grid-template-columns:\s*1fr;/,
    );

    assert.match(
      mobileCss,
      /\.hs-recent-card\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*64px\s+minmax\(0,\s*1fr\);/,
    );
  },
);
