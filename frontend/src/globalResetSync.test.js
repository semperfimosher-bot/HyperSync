import assert from "node:assert/strict";
import test from "node:test";

import {
  GLOBAL_RESET_GENERATION_KEY,
  syncGlobalResetState,
} from "./globalResetSync.js";


function createStorage(
  initial = {},
) {
  const values =
    new Map(
      Object.entries(
        initial,
      ),
    );

  return {
    getItem(
      key,
    ) {
      return (
        values.get(
          key,
        ) ??
        null
      );
    },

    setItem(
      key,
      value,
    ) {
      values.set(
        key,
        String(
          value,
        ),
      );
    },

    clear() {
      values.clear();
    },
  };
}


function resetResponse(
  generation,
) {
  return {
    ok:
      true,

    async json() {
      return {
        generation,
      };
    },
  };
}


test(
  "offline device waits until connectivity returns",
  async () => {
    let fetchCalls = 0;
    let clearCalls = 0;

    const result =
      await syncGlobalResetState({
        navigatorLike: {
          onLine:
            false,
        },

        fetchLike:
          async () => {
            fetchCalls += 1;

            return resetResponse(
              2,
            );
          },

        clearClientData:
          async () => {
            clearCalls += 1;
          },

        storage:
          createStorage({
            [GLOBAL_RESET_GENERATION_KEY]:
              "1",
          }),
      });

    assert.equal(
      result.checked,
      false,
    );

    assert.equal(
      result.resetApplied,
      false,
    );

    assert.equal(
      fetchCalls,
      0,
    );

    assert.equal(
      clearCalls,
      0,
    );
  },
);


test(
  "newer server generation wipes stale device and acknowledges it",
  async () => {
    const storage =
      createStorage({
        [GLOBAL_RESET_GENERATION_KEY]:
          "3",

        oldDownloadState:
          "present",
      });

    let clearCalls = 0;

    const result =
      await syncGlobalResetState({
        navigatorLike: {
          onLine:
            true,
        },

        fetchLike:
          async () =>
            resetResponse(
              4,
            ),

        storage,

        clearClientData:
          async () => {
            clearCalls += 1;

            storage.clear();
          },
      });

    assert.equal(
      result.checked,
      true,
    );

    assert.equal(
      result.resetApplied,
      true,
    );

    assert.equal(
      result.generation,
      4,
    );

    assert.equal(
      clearCalls,
      1,
    );

    assert.equal(
      storage.getItem(
        GLOBAL_RESET_GENERATION_KEY,
      ),
      "4",
    );

    assert.equal(
      storage.getItem(
        "oldDownloadState",
      ),
      null,
    );
  },
);


test(
  "acknowledged generation does not wipe again",
  async () => {
    const storage =
      createStorage({
        [GLOBAL_RESET_GENERATION_KEY]:
          "7",
      });

    let clearCalls = 0;

    const result =
      await syncGlobalResetState({
        navigatorLike: {
          onLine:
            true,
        },

        fetchLike:
          async () =>
            resetResponse(
              7,
            ),

        storage,

        clearClientData:
          async () => {
            clearCalls += 1;
          },
      });

    assert.equal(
      result.resetApplied,
      false,
    );

    assert.equal(
      clearCalls,
      0,
    );
  },
);


test(
  "device with no marker wipes when a reset already happened",
  async () => {
    const storage =
      createStorage();

    let clearCalls = 0;

    const result =
      await syncGlobalResetState({
        navigatorLike: {
          onLine:
            true,
        },

        fetchLike:
          async () =>
            resetResponse(
              1,
            ),

        storage,

        clearClientData:
          async () => {
            clearCalls += 1;

            storage.clear();
          },
      });

    assert.equal(
      result.resetApplied,
      true,
    );

    assert.equal(
      clearCalls,
      1,
    );

    assert.equal(
      storage.getItem(
        GLOBAL_RESET_GENERATION_KEY,
      ),
      "1",
    );
  },
);
