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
    getItem(key) {
      return values.has(key)
        ? values.get(key)
        : null;
    },

    setItem(
      key,
      value,
    ) {
      values.set(
        key,
        String(value),
      );
    },

    removeItem(key) {
      values.delete(key);
    },
  };
}


test(
  "failed refresh does not erase the remembered browser session",
  async () => {
    globalThis.localStorage =
      createStorage({
        hypersync_session_active:
          "true",
        hypersync_remember_me:
          "true",
        hypersync_user_profile:
          JSON.stringify({
            id: "user-1",
            username: "listener",
          }),
      });

    globalThis.sessionStorage =
      createStorage();

    const originalFetch =
      globalThis.fetch;

    globalThis.fetch =
      async () => ({
        ok:
          false,
        status:
          401,
        async json() {
          return {
            detail:
              "Refresh session is no longer active.",
          };
        },
      });

    try {
      const client =
        await import(
          `./api/client.js?refresh-persistence=${Date.now()}`
        );

      await assert.rejects(
        () =>
          client.refreshAccessToken(),
        /Refresh session is no longer active/,
      );

      assert.equal(
        localStorage.getItem(
          "hypersync_session_active",
        ),
        "true",
      );

      assert.notEqual(
        localStorage.getItem(
          "hypersync_user_profile",
        ),
        null,
      );
    } finally {
      globalThis.fetch =
        originalFetch;
    }
  },
);
