import assert from "node:assert/strict";
import test from "node:test";
import { readBoundedResponse } from "./boundedResponse.js";

test("a chunked artwork body stops at the byte budget even with false or absent length", async () => {
  for (const headers of [{}, { "Content-Length": "1" }]) {
    let pulls = 0;
    let cancelled = false;
    const response = new Response(new ReadableStream({
      pull(controller) { pulls += 1; controller.enqueue(new Uint8Array(4)); },
      cancel() { cancelled = true; },
    }), { headers });
    await assert.rejects(readBoundedResponse(response, 8), /size/i);
    assert.ok(pulls <= 4, "must not consume an unbounded response");
    assert.equal(cancelled, true);
  }
});

test("exact-limit artwork preserves bytes and declared oversized content is never read", async () => {
  assert.deepEqual(new Uint8Array(await readBoundedResponse(new Response(new Uint8Array([1, 2, 3])), 3)), new Uint8Array([1, 2, 3]));
  const response = new Response("too big", { headers: { "Content-Length": "100" } });
  await assert.rejects(readBoundedResponse(response, 3), /size/i);
});

test("cancelling a cloned oversized response does not await its unread original branch", async () => {
  const response = new Response(new Uint8Array(20));
  const outcome = await Promise.race([
    readBoundedResponse(response.clone(), 3).catch(() => "bounded"),
    new Promise((resolve) => setImmediate(() => resolve("stalled"))),
  ]);
  assert.equal(outcome, "bounded");
  await response.body.cancel();
});
