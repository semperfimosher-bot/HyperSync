import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";


test(
  "app shell keeps extracted auth and mobile navigation out of App.jsx",
  () => {
    const source =
      fs.readFileSync(
        new URL(
          "./App.jsx",
          import.meta.url,
        ),
        "utf8",
      );

    assert.match(
      source,
      /components\/auth\/AuthOverlay\.jsx/,
    );

    assert.match(
      source,
      /components\/layout\/MobileBottomNav\.jsx/,
    );

    assert.equal(
      source.includes(
        "function AuthOverlay(",
      ),
      false,
    );

    assert.equal(
      source.includes(
        "function MobileBottomNav(",
      ),
      false,
    );
  },
);
