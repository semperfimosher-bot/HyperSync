import assert from "node:assert/strict";
import test from "node:test";
import { buildShellManifest } from "../build/appShellManifest.mjs";

test("shell inventory covers deferred code/CSS and revision changes with worker or assets", () => {
  const bundle = {
    "sw.js": { type: "chunk", code: "worker-v1" },
    "assets/app-abc.js": { type: "chunk", code: "app" },
    "assets/Deferred-def.js": { type: "chunk", code: "deferred" },
    "assets/style-abc.css": { type: "asset", source: "css" },
  };
  const manifest = buildShellManifest(bundle);
  assert.deepEqual(manifest.assets, ["/assets/Deferred-def.js", "/assets/app-abc.js", "/assets/style-abc.css"]);
  assert.equal(buildShellManifest(Object.fromEntries(Object.entries(bundle).reverse())).revision, manifest.revision);
  bundle["sw.js"].code = "worker-v2";
  assert.notEqual(buildShellManifest(bundle).revision, manifest.revision);
  bundle["sw.js"].code = "worker-v1";
  bundle["assets/Deferred-def.js"].code = "changed deferred module";
  assert.notEqual(buildShellManifest(bundle).revision, manifest.revision);
});
