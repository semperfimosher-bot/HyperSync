import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";

// Exercise the registered worker handlers, not a separate helper implementation.
async function worker(t, { cached, network, put = async () => {} } = {}) {
  const handlers = new Map();
  const background = [];
  t.mock.method(globalThis, "fetch", network ?? (async () => { throw new Error("offline"); }));
  const originals = { self: globalThis.self, caches: globalThis.caches };
  globalThis.self = {
    location: { origin: "https://app.test" },
    skipWaiting: async () => {},
    addEventListener(type, handler) {
      handlers.set(type, [...(handlers.get(type) ?? []), handler]);
    },
  };
  globalThis.caches = { open: async () => ({ match: cached ?? (async () => undefined), put }) };
  t.after(async () => {
    await Promise.allSettled(background);
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  });
  await import(`./serviceWorker.js?shell=${Math.random()}`);
  const dispatch = (request, preloadResponse) => {
    let result;
    for (const handler of handlers.get("fetch") ?? []) {
      handler({ request, preloadResponse, respondWith(promise) { result = promise; }, waitUntil(task) { background.push(task); } });
    }
    return result;
  };
  dispatch.background = () => Promise.allSettled(background);
  dispatch.install = () => {
    let result;
    for (const handler of handlers.get("install") ?? []) {
      handler({ waitUntil(promise) { result = promise; } });
    }
    return result;
  };
  dispatch.prepare = async (requestId) => {
    const replies = [];
    const tasks = [];
    for (const handler of handlers.get("message") ?? []) {
      handler({
        data: { type: "HYPERSYNC_PREPARE_OFFLINE_APP", requestId },
        source: { postMessage(message) { replies.push(message); } },
        waitUntil(task) { tasks.push(task); },
      });
    }
    await Promise.all(tasks);
    return replies;
  };
  return dispatch;
}

function navigation() {
  const request = new Request("https://app.test/library");
  Object.defineProperty(request, "mode", { value: "navigate" });
  return request;
}

test("navigation uses the cached app during an upstream outage", async (t) => {
  const dispatch = await worker(t, {
    cached: async () => new Response("cached app"),
    network: async () => new Response("proxy unavailable", { status: 503 }),
  });
  const response = await dispatch(navigation());
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "cached app");
});

test("navigation deadline covers a stalled preload", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const dispatch = await worker(t, { cached: async () => new Response("cached app") });
  const pending = dispatch(navigation(), new Promise(() => {}));
  // Let caches.open settle before advancing the worker's deadline.
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(3500);
  const result = await Promise.race([
    pending.then(async (response) => response.text()),
    new Promise((resolve) => setImmediate(() => resolve("deadline missed"))),
  ]);
  assert.equal(result, "cached app");
});

test("successful navigation survives unavailable cache storage", async (t) => {
  const dispatch = await worker(t, { network: async () => new Response("live app") });
  globalThis.caches.open = async () => { throw new Error("storage disabled"); };
  assert.equal(await (await dispatch(navigation())).text(), "live app");
});

test("a quota error cannot replace a successful navigation with stale content", async (t) => {
  const dispatch = await worker(t, {
    cached: async () => new Response("stale app"),
    network: async () => new Response("live app"),
    put: async () => { throw new Error("quota exceeded"); },
  });
  assert.equal(await (await dispatch(navigation())).text(), "live app");
});

test("static module handler reuses an Origin-varying precache offline", async (t) => {
  const dispatch = await worker(t, {
    cached: async (_request, options) => options?.ignoreVary
      ? new Response("cached module", { headers: { Vary: "Origin" } }) : undefined,
  });
  const request = new Request("https://app.test/assets/app.js");
  Object.defineProperty(request, "destination", { value: "script" });
  assert.equal(await (await dispatch(request)).text(), "cached module");
});

test("static asset delivery survives a cache quota error", async (t) => {
  const dispatch = await worker(t, {
    network: async () => new Response("live module"),
    put: async () => { throw new Error("quota exceeded"); },
  });
  const request = new Request("https://app.test/assets/app.js");
  Object.defineProperty(request, "destination", { value: "script" });
  assert.equal(await (await dispatch(request)).text(), "live module");
});

test("failed shell install preserves the previous offline entry point", async (t) => {
  const writes = [];
  const dispatch = await worker(t, {
    network: async (url) => url === "/"
      ? new Response('<script src="/assets/new.js"></script>')
      : new Response("unavailable", { status: 503 }),
    put: async (url) => { writes.push(url); },
  });
  await assert.rejects(dispatch.install());
  assert.equal(writes.includes("/"), false);
});

test("shell install cannot report success when the entry point is unavailable", async (t) => {
  const dispatch = await worker(t, {
    network: async () => new Response("unavailable", { status: 503 }),
  });
  await assert.rejects(dispatch.install());
});

test("shell entry point is published after required scripts and styles", async (t) => {
  const writes = [];
  const dispatch = await worker(t, {
    network: async (url) => url === "/"
      ? new Response('<script src="/assets/app.js"></script><link rel="stylesheet" href="/assets/app.css">')
      : String(url).includes("/assets/")
        ? new Response("asset") : new Response("optional icon missing", { status: 404 }),
    put: async (url) => { writes.push(url); },
  });
  await dispatch.install();
  assert.deepEqual(writes, ["https://app.test/assets/app.js", "https://app.test/assets/app.css", "/"]);
});

for (const failure of ["fetch", "storage"]) {
  test(`offline preparation reports ${failure} failure without replacing the cached app`, async (t) => {
    const writes = [];
    const dispatch = await worker(t, {
      network: async (url) => url === "/"
        ? new Response('<script src="/assets/new.js"></script>')
        : new Response("asset", { status: failure === "fetch" ? 503 : 200 }),
      put: async (url) => {
        if (String(url).endsWith(".js")) throw new Error("quota exceeded");
        writes.push(url);
      },
    });
    assert.deepEqual(await dispatch.prepare("request-123"), [{
      type: "HYPERSYNC_PREPARE_OFFLINE_APP_COMPLETE", requestId: "request-123", ok: false,
    }]);
    assert.equal(writes.includes("/"), false);
  });
}

test("successful navigation does not publish HTML whose required bundle failed", async (t) => {
  const writes = [];
  const html = '<script src="/assets/new.js"></script>';
  const dispatch = await worker(t, {
    network: async (request) => request instanceof Request && request.url.endsWith("/library")
      ? new Response(html) : new Response("unavailable", { status: 503 }),
    put: async (url) => { writes.push(url); },
  });
  assert.equal(await (await dispatch(navigation())).text(), html);
  await dispatch.background();
  assert.equal(writes.includes("/"), false);
});
