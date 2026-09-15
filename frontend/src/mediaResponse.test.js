import assert from "node:assert/strict";
import test from "node:test";

async function loadMediaResponseModule() {
  return import(
    `./mediaResponse.js?test=${Date.now()}-${Math.random()}`
  );
}

test(
  "media range response returns exact partial-content metadata and bytes",
  async () => {
    const mediaResponse =
      await loadMediaResponseModule();

    assert.equal(
      typeof mediaResponse.createMediaRangeResponse,
      "function",
    );

    const data =
      new Uint8Array([
        0xaa,
        0xbb,
        0xcc,
        0xdd,
      ]).buffer;

    const response =
      mediaResponse.createMediaRangeResponse({
        data,
        byteStart: 262142,
        byteEnd: 262145,
        fileSize: 1_000_000,
        mimeType: "audio/mpeg",
      });

    assert.ok(
      response instanceof Response,
    );

    assert.equal(
      response.status,
      206,
    );

    assert.equal(
      response.headers.get(
        "Content-Range",
      ),
      "bytes 262142-262145/1000000",
    );

    assert.equal(
      response.headers.get(
        "Content-Length",
      ),
      "4",
    );

    assert.equal(
      response.headers.get(
        "Accept-Ranges",
      ),
      "bytes",
    );

    assert.equal(
      response.headers.get(
        "Content-Type",
      ),
      "audio/mpeg",
    );

    assert.deepEqual(
      Array.from(
        new Uint8Array(
          await response.arrayBuffer(),
        ),
      ),
      [
        0xaa,
        0xbb,
        0xcc,
        0xdd,
      ],
    );
  },
);

test(
  "media range response rejects a body whose length does not match the range",
  async () => {
    const mediaResponse =
      await loadMediaResponseModule();

    const data =
      new Uint8Array([
        0xaa,
        0xbb,
        0xcc,
      ]).buffer;

    assert.throws(
      () =>
        mediaResponse.createMediaRangeResponse({
          data,
          byteStart: 10,
          byteEnd: 13,
          fileSize: 100,
          mimeType: "audio/mpeg",
        }),
      {
        name: "RangeError",
        message:
          "Media range body length does not match requested byte range.",
      },
    );
  },
);
