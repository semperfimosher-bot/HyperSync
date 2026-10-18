import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const manifest = JSON.parse(await readFile(resolve(dist, "app-shell-manifest.json"), "utf8"));
const html = await readFile(resolve(dist, "index.html"), "utf8");
const worker = await readFile(resolve(dist, "sw.js"), "utf8");
assert.ok(html.includes(manifest.revision) && worker.includes(manifest.revision), "shell and worker must share build identity");
for (const path of manifest.assets) {
  assert.ok(path.startsWith("/assets/") && !path.includes(".."));
  await stat(resolve(dist, "." + path));
}
const initialScripts = [...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"\s]+\.js)"/g)].map((match) => match[1]))];
let bytes = 0;
for (const path of initialScripts) bytes += (await stat(resolve(dist, "." + path))).size;
assert.ok(bytes < 400000, `Initial scripts ${bytes} exceed the 400000-byte budget (prior entry alone: 535880)`);
assert.ok(manifest.assets.some((path) => path.includes("SearchPage-")), "deferred search must be available offline");
console.log(JSON.stringify({ revision: manifest.revision, initialScriptBytes: bytes, codeAndStyleAssets: manifest.assets.length }));
