import assert from "node:assert/strict";
import test from "node:test";


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
        values.has(
          key,
        )
          ? values.get(
              key,
            )
          : null
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

    removeItem(
      key,
    ) {
      values.delete(
        key,
      );
    },

    clear() {
      values.clear();
    },
  };
}


test(
  "access token remains memory-only while session marker persists",
  async () => {
    globalThis.localStorage =
      createStorage({
        hypersync_access_token:
          "legacy-local-token",
      });

    globalThis.sessionStorage =
      createStorage({
        hypersync_access_token:
          "legacy-session-token",
      });

    const storage =
      await import(
        `./api/storage.js?security=${Date.now()}`
      );

    assert.equal(
      localStorage.getItem(
        storage.ACCESS_TOKEN_KEY,
      ),
      null,
    );

    assert.equal(
      sessionStorage.getItem(
        storage.ACCESS_TOKEN_KEY,
      ),
      null,
    );

    storage.saveAuthSession(
      "live-memory-token",
      {
        remember:
          true,
      },
    );

    assert.equal(
      storage.getAccessToken(),
      "live-memory-token",
    );

    assert.equal(
      localStorage.getItem(
        storage.ACCESS_TOKEN_KEY,
      ),
      null,
    );

    assert.equal(
      sessionStorage.getItem(
        storage.ACCESS_TOKEN_KEY,
      ),
      null,
    );

    assert.equal(
      localStorage.getItem(
        storage.SESSION_ACTIVE_KEY,
      ),
      "true",
    );

    storage.clearAuthSession();

    assert.equal(
      storage.getAccessToken(),
      null,
    );
  },
);
