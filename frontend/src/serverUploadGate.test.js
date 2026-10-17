import assert from "node:assert/strict";
import test from "node:test";
import { runServerUpload } from "./serverUploadGate.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("server uploads execute FIFO with one action active", async () => {
  const release = deferred();
  const order = [];
  const first = runServerUpload(async () => { order.push(1); await release.promise; });
  const second = runServerUpload(() => { order.push(2); });
  const third = runServerUpload(() => { order.push(3); });
  await Promise.resolve();
  assert.deepEqual(order, [1]);
  release.resolve();
  await Promise.all([first, second, third]);
  assert.deepEqual(order, [1, 2, 3]);
});

test("cancelling a queued middle upload rejects promptly without bypassing active work", async () => {
  const release = deferred();
  const controller = new AbortController();
  const order = [];
  const first = runServerUpload(async () => { order.push(1); await release.promise; });
  const second = runServerUpload(() => { assert.fail("cancelled action ran"); }, { signal: controller.signal });
  const rejected = assert.rejects(second, { name: "AbortError" });
  const third = runServerUpload(() => { order.push(3); });
  controller.abort();
  await rejected;
  assert.deepEqual(order, [1]);
  release.resolve();
  await Promise.all([first, third]);
  assert.deepEqual(order, [1, 3]);
});

test("failed work releases the queue and already-aborted jobs never execute", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(runServerUpload(() => assert.fail("aborted action ran"), {
    signal: controller.signal,
  }), { name: "AbortError" });
  const failed = runServerUpload(() => { throw new Error("failed"); });
  const next = runServerUpload(() => "next");
  await assert.rejects(failed, /failed/);
  assert.equal(await next, "next");
});

test("aborting active work does not release its slot before it settles", async () => {
  const release = deferred();
  const controller = new AbortController();
  let nextStarted = false;
  const active = runServerUpload(() => release.promise, { signal: controller.signal });
  const next = runServerUpload(() => { nextStarted = true; });
  controller.abort();
  await Promise.resolve();
  assert.equal(nextStarted, false);
  release.resolve();
  await Promise.all([active, next]);
  assert.equal(nextStarted, true);
});
