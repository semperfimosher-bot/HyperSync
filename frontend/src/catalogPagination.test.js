import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Load the actual store with only browser/audio imports replaced: tests exercise
// its request coordination, page assembly and public mutation functions.
async function loadStore(request) {
  const key = `catalogTest${Math.random()}`;
  globalThis[key] = request;
  let source = await readFile(new URL("./catalogStore.js", import.meta.url), "utf8");
  source = source.replace(/import\s*\{[\s\S]*?\}\s*from "react";/, "const useCallback = () => {}; const useEffect = () => {}; const useState = () => {};")
    .replace(/import \{ apiRequest \} from "\.\/api\/client.js";/, `const apiRequest = globalThis[${JSON.stringify(key)}];`)
    .replace(/import \* as player\s*from "\.\/audioPlayer.js";/, "const player = {stopTrack() {}};")
    .replace(/import \{ clearCachedTrack \} from "\.\/mediaCache.js";/, "const clearCachedTrack = async () => {};");
  const store = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  delete globalThis[key];
  return store;
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("unused catalog releases its rows and reloads, but live subscribers retain shared data", async () => {
  let calls = 0;
  const store = await loadStore(async () => { calls += 1; return [{ id: `track-${calls}` }]; });
  const unsubscribe = store.subscribeToCatalog(() => {});
  await store.loadCatalog();
  assert.equal(store.releaseUnusedCatalog(), false);
  assert.deepEqual(await store.loadCatalog(), [{ id: "track-1" }]);
  unsubscribe();
  assert.equal(store.releaseUnusedCatalog(), true);
  const seen = [];
  const stop = store.subscribeToCatalog((rows) => seen.push(rows));
  assert.deepEqual(seen, [[]]);
  assert.deepEqual(await store.loadCatalog(), [{ id: "track-2" }]);
  stop();
});

test("unused catalog cancels in-flight assembly and cannot publish stale rows", async () => {
  const pending = deferred();
  const store = await loadStore(async () => pending.promise);
  const load = store.loadCatalog();
  const aborted = assert.rejects(load, { name: "AbortError" });
  store.releaseUnusedCatalog();
  pending.resolve([{ id: "stale" }]);
  await aborted;
  const seen = [];
  store.subscribeToCatalog((rows) => seen.push(rows));
  assert.deepEqual(seen, [[]]);
});

test("a failed deletion after the final viewer leaves cannot retain or reload the catalog", async () => {
  let rejectDelete;
  let reads = 0;
  const store = await loadStore(async (_path, options) => {
    if (options.method === "DELETE") return new Promise((_, reject) => { rejectDelete = reject; });
    reads += 1;
    return [{ id: "saved" }];
  });
  const unsubscribe = store.subscribeToCatalog(() => {});
  await store.loadCatalog();
  const rejected = assert.rejects(store.deleteCatalogTrack("saved"), /delete failed/);
  unsubscribe();
  store.releaseUnusedCatalog();
  rejectDelete(new Error("delete failed"));
  await rejected;
  const updates = [];
  store.subscribeToCatalog((rows) => updates.push(rows));
  assert.deepEqual(updates, [[]]);
  assert.equal(reads, 1);
});

test("catalog walks all pages, deduplicates IDs, publishes only the completed array", async () => {
  const calls = [];
  const store = await loadStore(async (path) => {
    calls.push(path);
    return calls.length === 1
      ? { items: [{ id: "a", title: "old" }, { id: "b" }], next_cursor: "next token" }
      : { items: [{ id: "a", title: "updated" }, { id: "c" }], next_cursor: null };
  });
  const updates = [];
  store.subscribeToCatalog((rows) => updates.push(rows));
  const rows = await store.loadCatalog();
  assert.deepEqual(rows, [{ id: "a", title: "updated" }, { id: "b" }, { id: "c" }]);
  assert.equal(calls.length, 2);
  assert.match(calls[0], /page_size=250/);
  assert.match(calls[1], /cursor=next(?:\+|%20)token/);
  assert.equal(updates.length, 2);
});

test("legacy servers still return complete arrays", async () => {
  const store = await loadStore(async () => [{ id: "a" }]);
  assert.deepEqual(await store.loadCatalog(), [{ id: "a" }]);
});

test("aborted pagination never publishes a partial array", async () => {
  const controller = new AbortController();
  const store = await loadStore(async () => {
    controller.abort();
    return { items: [{ id: "a" }], next_cursor: "next" };
  });
  const updates = [];
  store.subscribeToCatalog((rows) => updates.push(rows));
  await assert.rejects(store.loadCatalog({ signal: controller.signal }), { name: "AbortError" });
  assert.deepEqual(updates, [[]]);
});

test("forced refresh supersedes stale requests and local removals beat in-flight pages", async () => {
  const pending = deferred();
  let calls = 0;
  const store = await loadStore(async () => {
    calls += 1;
    if (calls === 1) return pending.promise;
    return { items: [{ id: "new" }], next_cursor: null };
  });
  const stale = store.loadCatalog();
  const staleResult = assert.rejects(stale, { name: "AbortError" });
  assert.deepEqual(await store.loadCatalog({ force: true }), [{ id: "new" }]);
  pending.resolve({ items: [{ id: "old" }], next_cursor: null });
  await staleResult;
  assert.deepEqual(await store.loadCatalog(), [{ id: "new" }]);

  const page = deferred();
  const other = await loadStore(async () => page.promise);
  const loading = other.loadCatalog();
  other.removeCatalogTrack("removed");
  page.resolve({ items: [{ id: "removed" }, { id: "kept" }], next_cursor: null });
  assert.deepEqual(await loading, [{ id: "kept" }]);
});

test("page failures and repeated cursors preserve the previous complete catalog", async () => {
  let mode = "initial";
  const store = await loadStore(async () => {
    if (mode === "initial") return [{ id: "saved" }];
    return { items: [{ id: "partial" }], next_cursor: "same" };
  });
  await store.loadCatalog();
  mode = "loop";
  await assert.rejects(store.loadCatalog({ force: true }), /cursor/i);
  assert.deepEqual(await store.loadCatalog(), [{ id: "saved" }]);
});

test("a later page error retains the last successful array and permits retry", async () => {
  let calls = 0;
  const store = await loadStore(async () => {
    calls += 1;
    if (calls === 1) return [{ id: "saved" }];
    if (calls === 2) return { items: [{ id: "partial" }], next_cursor: "next" };
    if (calls === 3) throw new Error("Page unavailable");
    return { items: [{ id: "retried" }], next_cursor: null };
  });
  await store.loadCatalog();
  await assert.rejects(store.loadCatalog({ force: true }), /Page unavailable/);
  assert.deepEqual(await store.loadCatalog(), [{ id: "saved" }]);
  assert.deepEqual(await store.loadCatalog({ force: true }), [{ id: "retried" }]);
});

test("a joining subscriber can abort without cancelling the shared page walk", async () => {
  const pending = deferred();
  const store = await loadStore(async () => pending.promise);
  const owner = store.loadCatalog();
  const controller = new AbortController();
  const joining = store.loadCatalog({ signal: controller.signal });
  controller.abort();
  await assert.rejects(joining, { name: "AbortError" });
  pending.resolve({ items: [{ id: "complete" }], next_cursor: null });
  assert.deepEqual(await owner, [{ id: "complete" }]);
});
