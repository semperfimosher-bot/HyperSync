import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const manifest = JSON.parse(
  await readFile(resolve(dist, "app-shell-manifest.json"), "utf8"),
);
const html = await readFile(resolve(dist, "index.html"), "utf8");
const worker = await readFile(resolve(dist, "sw.js"), "utf8");

assert.ok(
  html.includes(manifest.revision) && worker.includes(manifest.revision),
  "HTML and service worker must share the same build identity",
);

for (const path of manifest.assets) {
  assert.ok(
    path.startsWith("/assets/") && !path.includes(".."),
    `Unsafe app-shell asset path: ${path}`,
  );
  await stat(resolve(dist, `.${path}`));
}

const initialScripts = [
  ...new Set(
    [...html.matchAll(/(?:src|href)="(\/assets\/[^"\s]+\.js)"/g)]
      .map((match) => match[1]),
  ),
];
let initialScriptBytes = 0;
for (const path of initialScripts) {
  initialScriptBytes += (await stat(resolve(dist, `.${path}`))).size;
}

const maxInitialScriptBytes = 400_000;
assert.ok(
  initialScriptBytes < maxInitialScriptBytes,
  `Initial scripts ${initialScriptBytes} bytes exceed the ${maxInitialScriptBytes}-byte budget`,
);
assert.ok(
  manifest.assets.some((path) => /\/SearchPage-[^/]+\.js$/.test(path)),
  "Deferred search-page code must be included in the offline asset inventory",
);

console.log(
  JSON.stringify({
    revision: manifest.revision,
    initialScriptBytes,
    maxInitialScriptBytes,
    codeAndStyleAssets: manifest.assets.length,
  }),
);
