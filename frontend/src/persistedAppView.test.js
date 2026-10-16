import test from "node:test";
import assert from "node:assert/strict";
import {
  clearPersistedAppView,
  readPersistedAppView,
  writePersistedAppView,
} from "./persistedAppView.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test("persists and restores only navigation context per user", () => {
  const storage = memoryStorage();
  assert.equal(writePersistedAppView("user-1", {
    active_page: "search",
    search_query: "ambient",
    profile_username: "",
    access_token: "must-not-be-saved",
  }, storage), true);
  assert.deepEqual(readPersistedAppView("user-1", storage), {
    active_page: "search",
    search_query: "ambient",
    profile_username: "",
  });
  assert.equal(readPersistedAppView("user-2", storage), null);
});

test("limits persisted text and handles unavailable storage safely", () => {
  const storage = memoryStorage();
  writePersistedAppView("user", {
    active_page: "search",
    search_query: "x".repeat(500),
    profile_username: "y".repeat(200),
  }, storage);
  const restored = readPersistedAppView("user", storage);
  assert.equal(restored.search_query.length, 200);
  assert.equal(restored.profile_username.length, 100);
  assert.equal(readPersistedAppView("user", null), null);
  assert.equal(writePersistedAppView("user", {}, null), false);
});

test("clears persisted view for a user", () => {
  const storage = memoryStorage();
  writePersistedAppView("user", { active_page: "library" }, storage);
  assert.equal(clearPersistedAppView("user", storage), true);
  assert.equal(readPersistedAppView("user", storage), null);
});
