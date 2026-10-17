import assert from "node:assert/strict";
import test from "node:test";
import { saveAuthSession, clearAuthSession } from "./api/storage.js";

function item() {
  return { file: new File(["audio"], "song.mp3", { type: "audio/mpeg" }),
    title: "Song", artist: "Artist", album: "", duration: 100 };
}

test("a failed direct transport falls back and avoids repeating it for the next song", async (t) => {
  const { uploadTrack } = await import("./api/uploads.js?recovery-network");
  saveAuthSession("upload-test-token");
  t.after(clearAuthSession);
  let now = 100000;
  t.mock.method(Date, "now", () => now);
  let preparations = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).endsWith("/prepare")) {
      preparations++;
      return Response.json({ direct_upload: true, object_key: "audio/test.mp3",
        upload_url: "https://storage.example.test/test.mp3", content_type: "audio/mpeg" });
    }
    return Response.json({ success: true });
  });
  const calls = [];
  const previousXHR = globalThis.XMLHttpRequest;
  globalThis.XMLHttpRequest = class {
    upload = {};
    open(method, url) { this.method = method; calls.push([method, url]); }
    setRequestHeader() {}
    send() {
      queueMicrotask(() => {
        if (this.method === "PUT") { this.onerror(); return; }
        this.status = 200;
        this.responseText = JSON.stringify({ success: true, track_id: "stored" });
        this.onload();
      });
    }
  };
  t.after(() => { globalThis.XMLHttpRequest = previousXHR; });
  assert.equal((await uploadTrack(item())).success, true);
  assert.equal((await uploadTrack(item())).success, true);
  assert.equal(preparations, 1);
  assert.equal(calls.filter(([method]) => method === "PUT").length, 1);
  assert.equal(calls.filter(([method]) => method === "POST").length, 2);
  now += 120001;
  await uploadTrack(item());
  assert.equal(preparations, 2, "direct uploads are tried again after cooldown");
  assert.equal(calls.filter(([method]) => method === "PUT").length, 2);
});

test("duplicate prepare conflict does not fall through to an upload", async (t) => {
  const { uploadTrack } = await import("./api/uploads.js?recovery-duplicate");
  saveAuthSession("upload-test-token");
  t.after(clearAuthSession);
  t.mock.method(globalThis, "fetch", async () => Response.json(
    { detail: "Duplicate track prevented" }, { status: 409 },
  ));
  await assert.rejects(uploadTrack(item()), (error) => error.status === 409);
});

for (const failure of ["abort", "http"]) {
  test(`direct ${failure} failure does not disable the next direct attempt`, async (t) => {
    const { uploadTrack } = await import(`./api/uploads.js?recovery-${failure}`);
    saveAuthSession("upload-test-token");
    t.after(clearAuthSession);
    let preparations = 0;
    t.mock.method(globalThis, "fetch", async (url) => {
      if (String(url).endsWith("/prepare")) {
        preparations++;
        return Response.json({ direct_upload: true, object_key: "audio/test.mp3",
          upload_url: "https://storage.example.test/test.mp3", content_type: "audio/mpeg" });
      }
      return Response.json({ success: true, track_id: "stored" });
    });
    let puts = 0;
    let posts = 0;
    const previousXHR = globalThis.XMLHttpRequest;
    globalThis.XMLHttpRequest = class {
      upload = {};
      open(method) { this.method = method; }
      setRequestHeader() {}
      send() {
        queueMicrotask(() => {
          if (this.method === "PUT") {
            puts++;
            if (puts === 1 && failure === "abort") { this.onabort(); return; }
          } else { posts++; }
          this.status = puts === 1 && failure === "http" && this.method === "PUT" ? 403 : 200;
          this.responseText = JSON.stringify({ success: true, track_id: "stored" });
          this.onload();
        });
      }
    };
    t.after(() => { globalThis.XMLHttpRequest = previousXHR; });
    if (failure === "abort") {
      await assert.rejects(uploadTrack(item()), (error) => error.name === "AbortError");
      assert.equal(posts, 0, "cancellation must not start a backend upload");
    } else {
      assert.equal((await uploadTrack(item())).success, true);
      assert.equal(posts, 1, "an HTTP failure still permits backend fallback");
    }
    assert.equal((await uploadTrack(item())).success, true);
    assert.equal(preparations, 2);
    assert.equal(puts, 2);
  });
}

test("a browser batch sends fallback uploads to the server one at a time", async (t) => {
  const { uploadTrack } = await import("./api/uploads.js?recovery-batch-fallback");
  saveAuthSession("upload-test-token");
  t.after(clearAuthSession);
  t.mock.method(globalThis, "fetch", async () => Response.json({ direct_upload: false }));
  const pending = [];
  const previousXHR = globalThis.XMLHttpRequest;
  globalThis.XMLHttpRequest = class {
    upload = {};
    open() {}
    setRequestHeader() {}
    send() { pending.push(this); }
  };
  t.after(() => { globalThis.XMLHttpRequest = previousXHR; });
  const results = [uploadTrack(item()), uploadTrack(item()), uploadTrack(item())];
  for (let index = 0; index < 3; index++) {
    await new Promise(setImmediate);
    assert.equal(pending.length, index + 1, "only the next server upload starts");
    const xhr = pending[index];
    xhr.status = 200;
    xhr.responseText = JSON.stringify({ success: true });
    xhr.onload();
  }
  assert.equal((await Promise.all(results)).length, 3);
});

test("direct B2 transfers stay parallel while their server finalizations serialize", async (t) => {
  const { uploadTrack } = await import("./api/uploads.js?recovery-batch-direct");
  saveAuthSession("upload-test-token");
  t.after(clearAuthSession);
  const finalizations = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).endsWith("/prepare")) {
      return Response.json({ direct_upload: true, object_key: "audio/test.mp3",
        upload_url: "https://storage.example.test/test.mp3", content_type: "audio/mpeg" });
    }
    assert.ok(String(url).endsWith("/finalize"));
    return new Promise((resolve) => { finalizations.push(resolve); });
  });
  let puts = 0;
  const previousXHR = globalThis.XMLHttpRequest;
  globalThis.XMLHttpRequest = class {
    upload = {};
    open(method) { assert.equal(method, "PUT"); puts++; }
    setRequestHeader() {}
    send() { queueMicrotask(() => { this.status = 200; this.onload(); }); }
  };
  t.after(() => { globalThis.XMLHttpRequest = previousXHR; });
  const results = [uploadTrack(item()), uploadTrack(item()), uploadTrack(item())];
  for (let index = 0; index < 3; index++) {
    await new Promise(setImmediate);
    assert.equal(puts, 3, "B2 transfers are not serialized by the server gate");
    assert.equal(finalizations.length, index + 1);
    finalizations[index](Response.json({ success: true }));
  }
  assert.equal((await Promise.all(results)).length, 3);
});

for (const failure of ["network", "abort"]) {
  test(`finalize ${failure} failure preserves audio that may already be committed`, async (t) => {
    const { uploadTrack } = await import(`./api/uploads.js?finalize-ownership-${failure}`);
    saveAuthSession("upload-test-token");
    t.after(clearAuthSession);
    const calls = [];
    t.mock.method(globalThis, "fetch", async (url) => {
      calls.push(String(url));
      if (String(url).endsWith("/prepare")) {
        return Response.json({ direct_upload: true, object_key: "audio/test.mp3",
          upload_url: "https://storage.example.test/test.mp3", content_type: "audio/mpeg" });
      }
      if (String(url).endsWith("/finalize")) {
        throw failure === "abort" ? new DOMException("cancelled", "AbortError") : new TypeError("lost response");
      }
      return Response.json({ success: true });
    });
    const previousXHR = globalThis.XMLHttpRequest;
    globalThis.XMLHttpRequest = class {
      upload = {};
      open() {}
      setRequestHeader() {}
      send() { queueMicrotask(() => { this.status = 200; this.onload(); }); }
    };
    t.after(() => { globalThis.XMLHttpRequest = previousXHR; });
    await assert.rejects(uploadTrack(item()));
    assert.equal(calls.filter((url) => url.endsWith("/finalize")).length, 1);
    assert.equal(calls.filter((url) => url.endsWith("/cancel")).length, 0);
  });
}

test("cancelling a queued finalization cleans its unsubmitted prepared audio", async (t) => {
  const { uploadTrack } = await import("./api/uploads.js?finalize-ownership-queued");
  saveAuthSession("upload-test-token");
  t.after(clearAuthSession);
  const calls = [];
  let finishActive;
  t.mock.method(globalThis, "fetch", async (url) => {
    calls.push(String(url));
    if (String(url).endsWith("/prepare")) {
      return Response.json({ direct_upload: true, object_key: "audio/test.mp3",
        upload_url: "https://storage.example.test/test.mp3", content_type: "audio/mpeg" });
    }
    if (String(url).endsWith("/finalize")) {
      return new Promise((resolve) => { finishActive = resolve; });
    }
    return Response.json({ success: true });
  });
  const previousXHR = globalThis.XMLHttpRequest;
  globalThis.XMLHttpRequest = class {
    upload = {};
    open() {}
    setRequestHeader() {}
    send() { queueMicrotask(() => { this.status = 200; this.onload(); }); }
    abort() { this.onabort(); }
  };
  t.after(() => { globalThis.XMLHttpRequest = previousXHR; });
  const first = uploadTrack(item());
  const controller = new AbortController();
  const second = uploadTrack(item(), { signal: controller.signal });
  const rejected = assert.rejects(second, { name: "AbortError" });
  await new Promise(setImmediate);
  assert.equal(calls.filter((url) => url.endsWith("/finalize")).length, 1);
  controller.abort();
  await rejected;
  assert.equal(calls.filter((url) => url.endsWith("/cancel")).length, 1);
  finishActive(Response.json({ success: true }));
  await first;
});
