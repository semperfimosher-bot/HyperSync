import assert from "node:assert/strict";
import { test } from "node:test";

import {
  clearPersistedPlayerState,
  readPersistedPlayerState,
  writePersistedPlayerState,
} from "./playerPersistence.js";

test("blocked localStorage does not interrupt player startup or playback", () => {
  const previousWindow = globalThis.window;

  globalThis.window = {
    get localStorage() {
      throw new DOMException("Storage access denied", "SecurityError");
    },
  };

  try {
    assert.equal(readPersistedPlayerState(), null);
    assert.doesNotThrow(() => writePersistedPlayerState({ trackId: "song-1" }));
    assert.doesNotThrow(() => clearPersistedPlayerState());
  } finally {
    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
  }
});
