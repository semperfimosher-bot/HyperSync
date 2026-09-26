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

    clear() {
      values.clear();
    },
  };
}


const sharedLocalStorage =
  createStorage();

const sharedSessionStorage =
  createStorage();


function resetStorage(
  localValues = {},
  sessionValues = {},
) {
  sharedLocalStorage.clear();
  sharedSessionStorage.clear();

  Object.entries(
    localValues,
  ).forEach(
    ([key, value]) => {
      sharedLocalStorage.setItem(
        key,
        value,
      );
    },
  );

  Object.entries(
    sessionValues,
  ).forEach(
    ([key, value]) => {
      sharedSessionStorage.setItem(
        key,
        value,
      );
    },
  );

  globalThis.localStorage =
    sharedLocalStorage;

  globalThis.sessionStorage =
    sharedSessionStorage;
}


test(
  "rejected refresh clears the stale remembered browser session",
  async () => {
    resetStorage({
      hypersync_session_active:
        "true",
      hypersync_remember_me:
        "true",
      hypersync_user_profile:
        JSON.stringify({
          id:
            "user-1",
          username:
            "listener",
        }),
    });

    const originalFetch =
      globalThis.fetch;

    const calls = [];

    globalThis.fetch =
      async (
        url,
      ) => {
        calls.push(
          String(
            url,
          ),
        );

        return {
          ok:
            false,
          status:
            401,
          headers: {
            get() {
              return null;
            },
          },
          async json() {
            return {
              detail:
                "Refresh session is no longer active.",
            };
          },
        };
      };

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
        null,
      );

      assert.equal(
        localStorage.getItem(
          "hypersync_user_profile",
        ),
        null,
      );

      const callCountAfterRefresh =
        calls.length;

      await assert.rejects(
        () =>
          client.apiRequest(
            "/users/me/playback-state",
          ),
        /Authentication required/,
      );

      assert.equal(
        calls.length,
        callCountAfterRefresh,
      );
    } finally {
      globalThis.fetch =
        originalFetch;
    }
  },
);


test(
  "429 refresh cooldown suppresses repeated protected requests",
  async () => {
    resetStorage({
      hypersync_session_active:
        "true",
      hypersync_remember_me:
        "true",
      hypersync_user_profile:
        JSON.stringify({
          id:
            "user-1",
          username:
            "listener",
        }),
    });

    const originalFetch =
      globalThis.fetch;

    const calls = [];

    globalThis.fetch =
      async (
        url,
      ) => {
        calls.push(
          String(
            url,
          ),
        );

        return {
          ok:
            false,
          status:
            429,
          headers: {
            get(name) {
              return (
                String(
                  name,
                ).toLowerCase() ===
                "retry-after"
              )
                ? "60"
                : null;
            },
          },
          async json() {
            return {
              detail:
                "Too many requests. Try again shortly.",
            };
          },
        };
      };

    try {
      const client =
        await import(
          `./api/client.js?refresh-cooldown=${Date.now()}`
        );

      await assert.rejects(
        () =>
          client.refreshAccessToken(),
        /Too many requests/,
      );

      assert.equal(
        calls.length,
        1,
      );

      await assert.rejects(
        () =>
          client.apiRequest(
            "/users/me/playback-state",
          ),
        /Too many requests/,
      );

      assert.equal(
        calls.length,
        1,
      );

      assert.equal(
        client.isAuthRefreshCoolingDown(),
        true,
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
