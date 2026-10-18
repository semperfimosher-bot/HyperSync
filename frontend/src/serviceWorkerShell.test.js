import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";

// Exercise the registered worker handlers, not a separate helper implementation.
async function worker(t, { cached, network, put = async () => {}, manifest, cacheStorage } = {}) {
  const handlers = new Map();
  const background = [];
  t.mock.method(globalThis, "fetch", network ?? (async () => { throw new Error("offline"); }));
  const originals = { self: globalThis.self, caches: globalThis.caches, __HYPERSYNC_BUILD_MANIFEST__: globalThis.__HYPERSYNC_BUILD_MANIFEST__ };
  globalThis.__HYPERSYNC_BUILD_MANIFEST__ = manifest;
  globalThis.self = {
    location: { origin: "https://app.test" },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
    registration: {},
    addEventListener(type, handler) {
      handlers.set(type, [...(handlers.get(type) ?? []), handler]);
    },
  };
  globalThis.caches = cacheStorage ?? { open: async () => ({ match: cached ?? (async () => undefined), put }) };
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
  dispatch.activate = async () => {
    const tasks = [];
    for (const handler of handlers.get("activate") ?? []) handler({ waitUntil(task) { tasks.push(task); } });
    await Promise.all(tasks);
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

test("build inventory precaches deferred modules with at most four simultaneous fetches", async (t) => {
  const manifest = { revision: "fixture-build", assets: Array.from({ length: 16 }, (_, i) => `/assets/deferred-${i}.js`) };
  let active = 0;
  let peak = 0;
  const written = [];
  const dispatch = await worker(t, {
    manifest,
    network: async (url) => {
      if (url === "/") return new Response('<meta name="hypersync-build" content="fixture-build">');
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      return new Response("asset");
    },
    put: async (url) => { written.push(url); },
  });
  await dispatch.install();
  assert.ok(peak <= 4, `peak fetches: ${peak}`);
  for (const asset of manifest.assets) assert.ok(written.includes("https://app.test" + asset));
  assert.equal(written.at(-1), "/");
});

test("activation retains current and previous complete shells and prunes stale/partial builds", async (t) => {
  const deleted = [];
  const dispatch = await worker(t, {
    manifest: { revision: "current", assets: [] },
    cacheStorage: {
      keys: async () => ["unrelated", "hypersync-app-shell-old", "hypersync-app-shell-previous", "hypersync-app-shell-partial", "hypersync-app-shell-current"],
      open: async (name) => ({ match: async (path) => name.endsWith("partial") || path !== "/" ? undefined : new Response("ready"), put: async () => {} }),
      delete: async (name) => { deleted.push(name); },
    },
  });
  await dispatch.activate();
  assert.deepEqual(deleted.sort(), ["hypersync-app-shell-old", "hypersync-app-shell-partial"]);
});

test("rollback activation order, rather than cache creation order, chooses the retained generation", async (t) => {
  const deleted = [];
  const records = { "hypersync-app-shell-a": 30, "hypersync-app-shell-b": 20 };
  const dispatch = await worker(t, {
    manifest: { revision: "c", assets: [] },
    cacheStorage: {
      keys: async () => ["hypersync-app-shell-a", "hypersync-app-shell-b", "hypersync-app-shell-c"],
      open: async (name) => ({
        match: async (path) => path === "/" ? new Response("ready") : records[name] ? Response.json({ order: records[name] }) : undefined,
        put: async (_path, response) => { records[name] = (await response.json()).order; },
      }),
      delete: async (name) => { deleted.push(name); },
    },
  });
  await dispatch.activate();
  assert.deepEqual(deleted, ["hypersync-app-shell-b"]);
  assert.ok(records["hypersync-app-shell-c"] > 30);
});

test("old tabs can retrieve their hashed modules from the retained shell", async (t) => {
  const dispatch = await worker(t, {
    manifest: { revision: "current", assets: [] },
    cacheStorage: {
      keys: async () => ["hypersync-app-shell-previous", "hypersync-app-shell-current"],
      open: async (name) => ({ match: async () => name.endsWith("previous") ? new Response("previous module") : undefined }),
    },
  });
  const request = new Request("https://app.test/assets/old-module-abc123.js");
  Object.defineProperty(request, "destination", { value: "script" });
  assert.equal(await (await dispatch(request)).text(), "previous module");
});

test("a worker never publishes navigation HTML from a different build", async (t) => {
  const writes = [];
  const dispatch = await worker(t, {
    manifest: { revision: "old", assets: [] },
    network: async () => new Response('<meta name="hypersync-build" content="new">'),
    put: async (url) => { writes.push(url); },
  });
  await assert.rejects(dispatch.install(), /different/i);
  assert.deepEqual(writes, []);
});

test("stalled precache resources have bounded deadlines", { timeout: 1000 }, async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const dispatch = await worker(t, {
    network: async (url) => url === "/"
      ? new Response('<script src="/assets/stalled-aa11.js"></script>')
      : new Promise(() => {}),
  });
  const rejected = assert.rejects(dispatch.install(), /timed out/i);
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(10000);
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(10000);
  await rejected;
});

test("a stalled initial app document cannot hold worker installation indefinitely", { timeout: 1000 }, async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const dispatch = await worker(t, { network: async () => new Promise(() => {}) });
  const rejected = assert.rejects(dispatch.install(), /timed out/i);
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(10000);
  await rejected;
});

test("a stalled HTML body cannot hold installation indefinitely", { timeout: 1000 }, async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const dispatch = await worker(t, { network: async () => new Response(new ReadableStream()) });
  const rejected = assert.rejects(dispatch.install(), /timed out/i);
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(10000);
  await rejected;
});

test("navigation deadline also covers a stalled successful HTML body", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const dispatch = await worker(t, { cached: async () => new Response("cached app"), network: async () => new Response(new ReadableStream()) });
  const pending = dispatch(navigation()).then((response) => response.text());
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(3500);
  assert.equal(await Promise.race([pending, new Promise((resolve) => setImmediate(() => resolve("stalled")))]), "cached app");
});

test("failed installs remove their incomplete build cache without deleting a working shell", async (t) => {
  const deleted = [];
  const dispatch = await worker(t, {
    manifest: { revision: "incomplete", assets: [] },
    network: async () => new Response("unavailable", { status: 503 }),
    cacheStorage: {
      open: async () => ({ match: async () => undefined }),
      delete: async (name) => { deleted.push(name); },
    },
  });
  await assert.rejects(dispatch.install());
  assert.deepEqual(deleted, ["hypersync-app-shell-incomplete"]);
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
