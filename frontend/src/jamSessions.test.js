import assert from "node:assert/strict";
import test from "node:test";

import { shouldApplyJamRefresh } from "./jamSessions.js";

test("a previous account's pending refresh cannot restore its Jam", () => {
  const old = { id: "old-jam", revision: 4 };
  assert.equal(shouldApplyJamRefresh("old-user", "new-user", old, null, old), false);
});

test("a pending poll cannot replace a newer mutation or new Jam", () => {
  const before = { id: "jam", revision: 4 };
  const current = { id: "jam", revision: 5 };
  assert.equal(shouldApplyJamRefresh("user", "user", before, current, before), false);
  assert.equal(shouldApplyJamRefresh("user", "user", null, current, null), false);
  assert.equal(shouldApplyJamRefresh("user", "user", before, before, current), true);
});

test("Home's Jam action requests the persistent controller", async () => {
  const { OPEN_JAM_EVENT, requestJamPanel } = await import("./jamSessions.js");
  const target = new EventTarget();
  let opened = 0;
  target.addEventListener(OPEN_JAM_EVENT, () => { opened += 1; });
  requestJamPanel(target);
  assert.equal(opened, 1);
  assert.doesNotThrow(() => requestJamPanel(null));
});
