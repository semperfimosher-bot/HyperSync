import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { chromium } from "playwright";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function fixture(t) {
  const html = await readFile(resolve(dist, "index.html"), "utf8");
  const state = { mode: "healthy" };
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
        send(404, JSON.stringify({ detail: "Shell fixture has no backend" }), "application/json");
      } else if (path === "/" || path === "/library") {
        if (state.mode === "outage") send(503, "upstream unavailable");
        else if (state.mode === "broken-update") send(200, '<html><body><div id="root"></div><script type="module" src="/assets/missing-update.js"></script></body></html>');
        else if (state.mode === "recovered") send(200, html.replace("<html", '<html data-network-recovered="true"'));
        else send(200, html);
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
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(origin);
  await page.locator("main").waitFor({ state: "visible" });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  assert.deepEqual(pageErrors, [], "online application must mount without uncaught errors");
  return { page, context, origin, state, html, pageErrors };
}

async function cachedHtml(page) {
  return page.evaluate(async () => {
    const cache = await caches.open("hypersync-app-shell-v3");
    return (await cache.match("/"))?.text();
  });
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
  assert.equal((await page.reload()).status(), 200);
  await page.locator("main").waitFor({ state: "visible" });
  assert.deepEqual(pageErrors, []);
});
