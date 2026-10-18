import assert from "node:assert/strict";
import test from "node:test";
import { pageRows } from "./pagination.js";

test("catalog pages bound rendering without losing access to any row", () => {
  const rows = Array.from({ length: 100003 }, (_, id) => ({ id }));
  const first = pageRows(rows, 0);
  const last = pageRows(rows, 1000);
  assert.equal(first.items.length, 100);
  assert.deepEqual(last.items.map((row) => row.id), [100000, 100001, 100002]);
  assert.equal(last.total, rows.length);
  assert.equal(last.pageCount, 1001);
  assert.equal(pageRows(rows, 10000).page, 1000);
  assert.equal(pageRows(rows, -1).page, 0);
  assert.equal(rows.length, 100003);
});

test("empty or deleted pages clamp safely to a reachable page", () => {
  assert.deepEqual(pageRows([], 999), { items: [], page: 0, pageCount: 1, total: 0 });
  assert.equal(pageRows([1], 99).page, 0);
});
