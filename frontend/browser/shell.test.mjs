import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { chromium } from "playwright";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const shellManifest = JSON.parse(await readFile(resolve(dist, "app-shell-manifest.json"), "utf8"));
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function fixture(t, { admin = false } = {}) {
  const html = await readFile(resolve(dist, "index.html"), "utf8");
  const state = { mode: "healthy", build: "base", catalogFetches: 0 };
  const user = { id: "browser-admin", username: "browser-admin", display_name: "Fixture Admin", role: "admin", account_type: "registered" };
  const catalog = Array.from({ length: 261 }, (_, index) => ({ id: `track-${index}`, title: `Song ${String(index).padStart(3, "0")}`, artist: "Fixture Artist", album: "Fixture Album", genre: "Fixture", mime_type: "audio/wav" }));
  const revision = () => state.build === "base" || state.build === "rollback" ? shellManifest.revision : `${shellManifest.revision}-${state.build}`;
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, "http://127.0.0.1").pathname;
    const send = (status, body, type = "text/html") => {
      response.writeHead(status, {
        "Content-Type": type,
        "Cache-Control": "no-store",
        "Vary": "Origin",
        "Service-Worker-Allowed": "/",
        // This fixture has no external providers, credentials, or production API.
        "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'",
      });
      response.end(body);
    };
    try {
      if (path.startsWith("/api/")) {
        if (admin && path === "/api/auth/refresh") {
          const token = "fixture." + Buffer.from(JSON.stringify({ sub: user.id, role: "admin", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url") + ".fixture";
          send(200, JSON.stringify({ access_token: token, user }), "application/json");
        } else if (admin && path === "/api/users/me") send(200, JSON.stringify(user), "application/json");
        else if (admin && path === "/api/catalog/tracks") {
          state.catalogFetches += 1;
          const second = new URL(request.url, "http://127.0.0.1").searchParams.has("cursor");
          send(200, JSON.stringify({ items: second ? catalog.slice(250) : catalog.slice(0, 250), next_cursor: second ? null : "fixture-next" }), "application/json");
        } else send(404, JSON.stringify({ detail: "Shell fixture has no backend" }), "application/json");
      } else if (path === "/" || path === "/library") {
        if (state.mode === "stalled") return;
        if (state.mode === "outage") send(503, "upstream unavailable");
        else if (state.mode === "broken-update") send(200, `<html><head><meta name="hypersync-build" content="${revision()}"></head><body><div id="root"></div><script type="module" src="/assets/missing-update.js"></script></body></html>`);
        else if (state.mode === "recovered") send(200, html.replace("<html", '<html data-network-recovered="true"'));
        else send(200, html.replaceAll(shellManifest.revision, revision()));
      } else if (path === "/sw.js") {
        const workerSource = (await readFile(resolve(dist, "sw.js"), "utf8")).replaceAll(shellManifest.revision, revision());
        // Simulate rolling back to the original build: same shell revision, but a new worker script identity.
        send(200, state.build === "rollback" ? `${workerSource}\n/* rollback fixture */` : workerSource, "text/javascript");
      } else if (path === "/assets/quota-fixture-aa11.js") {
        send(200, "window.__quotaFixture = true;/*" + "x".repeat(10000) + "*/", "text/javascript");
      } else {
        const file = resolve(dist, "." + decodeURIComponent(path));
        if (!file.startsWith(resolve(dist) + sep)) return send(400, "Invalid path");
        send(200, await readFile(file), types[extname(file)] ?? "application/octet-stream");
      }
    } catch { send(404, "not found"); }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  let context;
  t.after(async () => {
    try { await context?.close(); }
    finally {
      server.closeAllConnections();
      await new Promise((resolveClose) => server.close(resolveClose));
    }
  });
  context = await browser.newContext();
  if (admin) await context.addInitScript((profile) => {
    localStorage.setItem("hypersync_session_active", "true");
    localStorage.setItem("hypersync_remember_me", "true");
    localStorage.setItem("hypersync_user_profile", JSON.stringify(profile));
  }, user);
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(origin);
  await page.locator("main").waitFor({ state: "visible" });
  // The normal first-visit account overlay intentionally blocks navigation.
  // Continue as a guest so these tests exercise the underlying offline shell.
  const guestButton = page.locator(".auth-overlay").getByRole("button", { name: "or use without account", exact: true });
  // The auth overlay is now a lazy chunk; wait for it to mount before deciding
  // whether this fresh context needs to dismiss the first-visit prompt.
  await guestButton.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  if (await guestButton.isVisible().catch(() => false)) await guestButton.click();
  await page.getByText("Loading page...", { exact: true }).waitFor({ state: "hidden" });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  assert.deepEqual(pageErrors, [], "online application must mount without uncaught errors");
  return { page, context, origin, state, html, pageErrors };
}

async function cachedHtml(page) {
  return page.evaluate(async (name) => {
    const cache = await caches.open(name);
    return (await cache.match("/"))?.text();
  }, `hypersync-app-shell-${shellManifest.revision}`);
}

test("built application reloads offline under its actual service worker", { timeout: 45000 }, async (t) => {
  const { page, context, state, html, pageErrors } = await fixture(t);
  assert.equal(await cachedHtml(page), html);
  await context.setOffline(true);
  const response = await page.reload();
  assert.equal(response.status(), 200);
  await page.locator("main").waitFor({ state: "visible" });
  assert.deepEqual(pageErrors, [], "offline modules must execute without uncaught errors");
  state.mode = "recovered";
  await context.setOffline(false);
  await page.reload();
  await page.locator("main").waitFor({ state: "visible" });
  assert.equal(await page.locator("html").getAttribute("data-network-recovered"), "true");
});

test("built application navigates through an upstream 503 using cached HTML", { timeout: 45000 }, async (t) => {
  const { page, origin, state, pageErrors } = await fixture(t);
  state.mode = "outage";
  const response = await page.goto(`${origin}/library`);
  assert.equal(response.status(), 200);
  await page.locator("main").waitFor({ state: "visible" });
  assert.deepEqual(pageErrors, []);
});

test("a stalled real navigation preload falls back within the configured deadline", { timeout: 45000 }, async (t) => {
  const { page, origin, state } = await fixture(t);
  state.mode = "stalled";
  const started = Date.now();
  assert.equal((await page.goto(`${origin}/library`)).status(), 200);
  await page.locator("main").waitFor({ state: "visible" });
  assert.ok(Date.now() - started < 8000, "navigation must recover without waiting for the stalled server");
});

test("failed bundle update reports failure and preserves a runnable offline app", { timeout: 45000 }, async (t) => {
  const { page, context, state, html, pageErrors } = await fixture(t);
  state.mode = "broken-update";
  const reply = await page.evaluate(() => new Promise((resolveReply, reject) => {
    const requestId = "browser-preparation";
    const timer = setTimeout(() => {
      navigator.serviceWorker.removeEventListener("message", onMessage);
      reject(new Error("No preparation acknowledgement"));
    }, 10000);
    function onMessage(event) {
      if (event.data?.requestId !== requestId) return;
      clearTimeout(timer);
      navigator.serviceWorker.removeEventListener("message", onMessage);
      resolveReply(event.data);
    }
    navigator.serviceWorker.addEventListener("message", onMessage);
    navigator.serviceWorker.controller.postMessage({ type: "HYPERSYNC_PREPARE_OFFLINE_APP", requestId });
  }));
  assert.equal(reply.ok, false);
  assert.equal(reply.type, "HYPERSYNC_PREPARE_OFFLINE_APP_COMPLETE");
  assert.equal(await cachedHtml(page), html);
  await context.setOffline(true);
  // Chromium can still reach a loopback fixture while offline emulation is
  // enabled. Stall the fixture explicitly so this verifies the cached fallback,
  // not a successful response from the local test server.
  state.mode = "stalled";
  assert.equal((await page.reload()).status(), 200);
  await page.locator("main").waitFor({ state: "visible" });
  assert.deepEqual(pageErrors, []);
});

test("a rejected new worker install keeps the incumbent controller and runnable offline app", { timeout: 45000 }, async (t) => {
  const { page, context, state, html } = await fixture(t);
  state.build = "failed";
  state.mode = "broken-update";
  const outcome = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    const previous = navigator.serviceWorker.controller;
    const failed = new Promise((resolveFailure, reject) => {
      const timer = setTimeout(() => reject(new Error("New worker did not reach a failed installation")), 20000);
      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        installing.addEventListener("statechange", () => {
          if (installing.state === "redundant") { clearTimeout(timer); resolveFailure(installing.state); }
        });
      }, { once: true });
    });
    await registration.update();
    return { state: await failed, incumbent: navigator.serviceWorker.controller === previous };
  });
  assert.deepEqual(outcome, { state: "redundant", incumbent: true });
  assert.equal(await cachedHtml(page), html);
  await context.setOffline(true);
  // Force the local fixture to stop responding because loopback may remain
  // reachable under Chromium's offline emulation.
  state.mode = "stalled";
  assert.equal((await page.reload()).status(), 200);
  await page.locator("main").waitFor({ state: "visible" });
});

test("an unvisited deferred Search page opens offline", { timeout: 45000 }, async (t) => {
  const { page, context, pageErrors } = await fixture(t);
  assert.equal(await page.evaluate(() => performance.getEntriesByType("resource").some((entry) => entry.name.includes("SearchPage-"))), false);
  await context.setOffline(true);
  await page.getByRole("navigation", { name: "Desktop navigation" }).getByRole("button", { name: "Search", exact: true }).click();
  await page.getByText("Loading page...", { exact: true }).waitFor({ state: "hidden" });
  await page.locator(".hs-search-console").first().waitFor({ state: "visible" });
  assert.deepEqual(pageErrors, []);
});

test("admin paging bounds DOM rows and preserves selection across pages and hidden-state release", { timeout: 45000 }, async (t) => {
  const { page, state, pageErrors } = await fixture(t, { admin: true });
  const navigation = page.getByRole("navigation", { name: "Desktop navigation" });
  await navigation.getByRole("button", { name: "Media Catalog", exact: true }).click();
  const catalog = page.locator(".admin-catalog-explorer-page");
  await catalog.getByPlaceholder("Search files, artists, albums, or genres...").fill("Song");
  await page.waitForFunction(() => document.querySelectorAll(".admin-explorer-file").length === 100);
  await catalog.locator(".admin-explorer-file").first().click({ button: "right" });
  await catalog.getByRole("button", { name: "Select all shown", exact: true }).click();
  await catalog.getByText("100 songs selected", { exact: true }).waitFor();
  await catalog.getByRole("navigation", { name: "Catalog pages" }).first().getByRole("button", { name: "Next", exact: true }).click();
  await catalog.getByText("Song 100", { exact: true }).waitFor();
  assert.equal(await catalog.locator(".admin-explorer-file").count(), 100);
  await navigation.getByRole("button", { name: "Home", exact: true }).click();
  await catalog.waitFor({ state: "hidden" });
  await navigation.getByRole("button", { name: "Media Catalog", exact: true }).click();
  await catalog.getByText("Song 100", { exact: true }).waitFor();
  await catalog.getByText("100 songs selected", { exact: true }).waitFor();
  assert.ok(state.catalogFetches >= 4, "released catalog must load its two pages again");
  await catalog.getByRole("button", { name: "Catalog", exact: true }).click();
  await catalog.getByRole("button", { name: /^Artists/ }).click();
  await catalog.getByRole("button", { name: /^Fixture Artist/ }).click({ button: "right" });
  await catalog.getByText("261 songs selected", { exact: true }).waitFor();
  assert.deepEqual(pageErrors, []);
});

test("worker updates retain one complete prior build for old tabs and prune older builds", { timeout: 60000 }, async (t) => {
  const { page, state } = await fixture(t);
  const baseCache = `hypersync-app-shell-${shellManifest.revision}`;
  await page.evaluate(async (name) => {
    const cache = await caches.open(name);
    await cache.put("/assets/legacy-fixture-aa11.js", new Response("window.__legacyFixture = true;", { headers: { "Content-Type": "text/javascript" } }));
  }, baseCache);
  async function update(build, expectedCaches, priorCache) {
    state.build = build;
    await page.evaluate(async ({ expectedCaches, activeCache, priorCache }) => {
      const activationKey = "/__hypersync/shell-activation";
      const readOrder = async (name) => {
        const cache = await caches.open(name);
        return Number((await (await cache.match(activationKey))?.json().catch(() => null))?.order) || 0;
      };
      const priorOrder = await readOrder(priorCache);
      const changed = new Promise((resolveChange, reject) => {
        const onChange = () => { clearTimeout(timer); resolveChange(); };
        const timer = setTimeout(() => {
          navigator.serviceWorker.removeEventListener("controllerchange", onChange);
          reject(new Error("Worker update did not take control"));
        }, 20000);
        navigator.serviceWorker.addEventListener("controllerchange", onChange, { once: true });
      });
      await (await navigator.serviceWorker.getRegistration()).update();
      await changed;
      // controllerchange precedes completion of activate.waitUntil; wait for both
      // the new activation stamp and the cache-pruning side effect before proceeding.
      await new Promise((resolveWait, rejectWait) => {
        const deadline = Date.now() + 10000;
        const poll = async () => {
          const names = (await caches.keys()).filter((name) => name.startsWith("hypersync-app-shell-")).sort();
          if (await readOrder(activeCache) > priorOrder && JSON.stringify(names) === JSON.stringify([...expectedCaches].sort())) return resolveWait();
          if (Date.now() >= deadline) return rejectWait(new Error("Worker activation cleanup did not settle"));
          setTimeout(poll, 50);
        };
        poll();
      });
    }, { expectedCaches, priorCache, activeCache: `hypersync-app-shell-${build === 'rollback' ? shellManifest.revision : build === 'base' ? shellManifest.revision : `${shellManifest.revision}-${build}`}` });
  }
  await update("b", [baseCache, `${baseCache}-b`], baseCache);
  assert.ok((await page.evaluate(() => caches.keys())).includes(baseCache));
  await page.evaluate(() => new Promise((resolveLoad, reject) => {
    const script = document.createElement("script");
    script.src = "/assets/legacy-fixture-aa11.js";
    script.onload = resolveLoad;
    script.onerror = reject;
    document.body.append(script);
  }));
  assert.equal(await page.evaluate(() => window.__legacyFixture), true);
  await update("rollback", [baseCache, `${baseCache}-b`], `${baseCache}-b`);
  await update("c", [baseCache, `${baseCache}-c`], baseCache);
  // controllerchange can fire before the worker's activate waitUntil cleanup settles.
  await page.waitForFunction(async (expected) => {
    const names = (await caches.keys()).filter((name) => name.startsWith("hypersync-app-shell-")).sort();
    return JSON.stringify(names) === JSON.stringify([...expected].sort());
  }, [baseCache, `${baseCache}-c`], { timeout: 10000 });
  const names = (await page.evaluate(() => caches.keys())).filter((name) => name.startsWith("hypersync-app-shell-"));
  assert.deepEqual(names.sort(), [baseCache, `${baseCache}-c`].sort());
});

test("cache quota exhaustion cannot break a successful online script", { timeout: 45000 }, async (t) => {
  const { page, context, origin } = await fixture(t);
  const session = await context.newCDPSession(page);
  await session.send("Storage.overrideQuotaForOrigin", { origin, quotaSize: 1 });
  await page.evaluate(() => new Promise((resolveLoad, reject) => {
    const script = document.createElement("script");
    script.src = "/assets/quota-fixture-aa11.js";
    script.onload = resolveLoad;
    script.onerror = reject;
    document.body.append(script);
  }));
  assert.equal(await page.evaluate(() => window.__quotaFixture), true);
  assert.equal(await page.evaluate(async () => {
    try { await (await caches.open("quota-proof")).put("/quota-proof", new Response("bytes")); return false; }
    catch (error) { return error.name === "QuotaExceededError"; }
  }), true, "the scenario must actually exhaust storage");
});

test("IndexedDB media survives reload and supports offline range, decoding, playback and seek", { timeout: 45000 }, async (t) => {
  const { page, context, pageErrors } = await fixture(t);
  const fileSize = await page.evaluate(async () => {
    const samples = 64000;
    const data = new ArrayBuffer(44 + samples * 2);
    const view = new DataView(data);
    const ascii = (offset, text) => [...text].forEach((letter, index) => view.setUint8(offset + index, letter.charCodeAt(0)));
    ascii(0, "RIFF"); view.setUint32(4, data.byteLength - 8, true); ascii(8, "WAVEfmt ");
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    ascii(36, "data"); view.setUint32(40, samples * 2, true);
    for (let sample = 0; sample < samples; sample += 1) view.setInt16(44 + sample * 2, Math.sin(sample * 2 * Math.PI * 440 / 8000) * 1000, true);
    const db = await new Promise((resolveOpen, reject) => {
      const request = indexedDB.open("hypersynced-media-v1", 2);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("media")) request.result.createObjectStore("media", { keyPath: "key" });
        if (!request.result.objectStoreNames.contains("chunks")) request.result.createObjectStore("chunks", { keyPath: "key" }).createIndex("mediaKey", "mediaKey");
      };
      request.onsuccess = () => resolveOpen(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolveWrite, reject) => {
      const tx = db.transaction(["media", "chunks"], "readwrite");
      tx.objectStore("media").put({ key: "browser-audio:v1", trackId: "browser-audio", mediaVersion: "v1", mimeType: "audio/wav", fileSize: data.byteLength, state: "PINNED", cachedBytes: data.byteLength, expiresAt: null });
      tx.objectStore("chunks").put({ key: "browser-audio:v1:0", mediaKey: "browser-audio:v1", chunkIndex: 0, byteStart: 0, byteEnd: data.byteLength - 1, byteLength: data.byteLength, data });
      tx.oncomplete = resolveWrite;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return data.byteLength;
  });

  await context.setOffline(true);
  await page.reload();
  await page.locator("main").waitFor({ state: "visible" });
  // This test verifies the offline media pipeline independently of account
  // playback restoration, which is database-backed and covered separately.
  const guestButton = page.locator(".auth-overlay").getByRole("button", { name: "or use without account", exact: true });
  await guestButton.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  if (await guestButton.isVisible().catch(() => false)) await guestButton.click();
  await page.getByText("Loading page...", { exact: true }).waitFor({ state: "hidden" });

  const range = await page.evaluate(async () => {
    const response = await fetch("/__hypersync/media/browser-audio/v1", { headers: { Range: "bytes=10-19" } });
    return { status: response.status, range: response.headers.get("Content-Range"), bytes: (await response.arrayBuffer()).byteLength };
  });
  assert.deepEqual(range, { status: 206, range: `bytes 10-19/${fileSize}`, bytes: 10 });

  const playback = await page.evaluate(async () => {
    const audio = document.createElement("audio");
    audio.preload = "auto";
    audio.src = "/__hypersync/media/browser-audio/v1";
    document.body.append(audio);
    await new Promise((resolveMetadata, reject) => {
      const timer = setTimeout(() => reject(new Error("Offline media metadata did not load")), 10000);
      audio.addEventListener("loadedmetadata", () => { clearTimeout(timer); resolveMetadata(); }, { once: true });
      audio.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Offline media could not be decoded")); }, { once: true });
      audio.load();
    });
    assert.ok(Math.abs(audio.duration - 8) < 0.1, "offline WAV duration must be decoded");
    await audio.play();
    await new Promise((resolveProgress, reject) => {
      const timer = setTimeout(() => reject(new Error("Offline audio playback did not advance")), 5000);
      const check = () => {
        if (audio.currentTime > 0.05) { clearTimeout(timer); audio.removeEventListener("timeupdate", check); resolveProgress(); }
      };
      audio.addEventListener("timeupdate", check);
      check();
    });
    audio.pause();
    const seeked = new Promise((resolveSeek, reject) => {
      const timer = setTimeout(() => reject(new Error("Offline audio seek did not complete")), 5000);
      audio.addEventListener("seeked", () => { clearTimeout(timer); resolveSeek(audio.currentTime); }, { once: true });
    });
    audio.currentTime = 1;
    const position = await seeked;
    audio.remove();
    return { duration: audio.duration, position };
  });
  assert.ok(Math.abs(playback.duration - 8) < 0.1);
  assert.ok(Math.abs(playback.position - 1) < 0.1);
  assert.deepEqual(pageErrors, []);
});
