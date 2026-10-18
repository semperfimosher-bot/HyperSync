import "fake-indexeddb/auto";
import { forceCloseDatabase } from "fake-indexeddb";
import assert from "node:assert/strict";
import test from "node:test";

test("forced IndexedDB closure reopens media and artwork without losing persisted bytes", async (t) => {
  const handles = [];
  const originalOpen = indexedDB.open.bind(indexedDB);
  t.mock.method(indexedDB, "open", (...args) => {
    const request = originalOpen(...args);
    request.addEventListener("success", () => handles.push(request.result));
    return request;
  });
  const store = await import(`./mediaStore.js?recovery=${Math.random()}`);
  await store.saveArtwork({ trackId: "recovery-art", data: new Uint8Array([1, 2]).buffer });
  await store.saveMediaRecord(store.createMediaRecord({ trackId: "recovery-track", mediaVersion: "v1", fileSize: 2, state: "COMPLETE" }));
  for (const database of handles) forceCloseDatabase(database);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await store.getMediaRecord("recovery-track", "v1")).state, "COMPLETE");
  assert.deepEqual(new Uint8Array((await store.getArtwork("recovery-art")).data), new Uint8Array([1, 2]));
});
