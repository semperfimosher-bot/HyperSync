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
