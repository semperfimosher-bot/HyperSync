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


test(
  "admin monitoring uses the shared lifecycle-safe refresh hook",
  () => {
    for (
      const relativePath
      of [
        "./components/pages/AdminDashboardPage.jsx",
      ]
    ) {
      const source =
        fs.readFileSync(
          new URL(
            relativePath,
            import.meta.url,
          ),
          "utf8",
        );

      assert.match(
        source,
        /useQuietRefresh/,
      );

      assert.equal(
        source.includes(
          "setInterval(",
        ),
        false,
        relativePath,
      );
    }
  },
);


test(
  "rarely used overlays are split from startup and mounted only on demand",
  () => {
    const source =
      fs.readFileSync(
        new URL(
          "./App.jsx",
          import.meta.url,
        ),
        "utf8",
      );

    for (const component of [
      "components/ui/NotificationDetailOverlay.jsx",
      "components/player/MobilePlayerDetails.jsx",
      "components/auth/AuthOverlay.jsx",
      "components/ui/AppInstallModal.jsx",
    ]) {
      assert.match(
        source,
        new RegExp(
          `lazy\\(\\(\\) => import\\(["']\\./${component.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}["']\\)\\)`,
        ),
        component,
      );
    }

    assert.match(source, /mobilePlayerDetailsOpen \\?/);
    assert.match(source, /notificationDetail \\?/);
    assert.match(source, /authOpen \\?/);
    assert.match(source, /installHelpMode \\?/);
  },
);
