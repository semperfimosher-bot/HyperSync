import test from "node:test";
import assert from "node:assert/strict";


async function loadMediaRangeModule() {
  return import("./mediaRange.js")
    .catch(() => ({}));
}


test(
  "bounded HTTP byte range parses into normalized positions",
  async () => {
    const mediaRange =
      await loadMediaRangeModule();

    assert.equal(
      typeof mediaRange.parseMediaRangeHeader,
      "function",
    );

    assert.deepEqual(
      mediaRange.parseMediaRangeHeader(
        "bytes=300000-700000",
        1_000_000,
      ),
      {
        byteStart:
          300_000,
        byteEnd:
          700_000,
      },
    );
  },
);

test(
  "bounded HTTP range clamps its end to the final file byte",
  async () => {
    const mediaRange =
      await loadMediaRangeModule();

    assert.deepEqual(
      mediaRange.parseMediaRangeHeader(
        "bytes=900000-1200000",
        1_000_000,
      ),
      {
        byteStart:
          900_000,
        byteEnd:
          999_999,
      },
    );
  },
);

test(
  "bounded HTTP range is unsatisfiable when start is beyond the file",
  async () => {
    const mediaRange =
      await loadMediaRangeModule();

    assert.throws(
      () =>
        mediaRange.parseMediaRangeHeader(
          "bytes=1200000-1300000",
          1_000_000,
        ),
      {
        name: "RangeError",
        message:
          "Media byte range is unsatisfiable.",
      },
    );
  },
);

test(
  "open-ended HTTP range extends to the final file byte",
  async () => {
    const mediaRange =
      await loadMediaRangeModule();

    assert.deepEqual(
      mediaRange.parseMediaRangeHeader(
        "bytes=300000-",
        1_000_000,
      ),
      {
        byteStart:
          300_000,
        byteEnd:
          999_999,
      },
    );
  },
);

test(
  "suffix HTTP range selects the final bytes of the file",
  async () => {
    const mediaRange =
      await loadMediaRangeModule();

    assert.deepEqual(
      mediaRange.parseMediaRangeHeader(
        "bytes=-500",
        1_000_000,
      ),
      {
        byteStart:
          999_500,
        byteEnd:
          999_999,
      },
    );
  },
);

test(
  "suffix HTTP range larger than the file selects the whole file",
  async () => {
    const mediaRange =
      await loadMediaRangeModule();

    assert.deepEqual(
      mediaRange.parseMediaRangeHeader(
        "bytes=-2000000",
        1_000_000,
      ),
      {
        byteStart:
          0,
        byteEnd:
          999_999,
      },
    );
  },
);

test(
  "zero-length suffix HTTP range is unsatisfiable",
  async () => {
    const mediaRange =
      await loadMediaRangeModule();

    assert.throws(
      () =>
        mediaRange.parseMediaRangeHeader(
          "bytes=-0",
          1_000_000,
        ),
      {
        name: "RangeError",
        message:
          "Media byte range is unsatisfiable.",
      },
    );
  },
);

test(
  "bounded HTTP range cannot end before it starts",
  async () => {
    const mediaRange =
      await loadMediaRangeModule();

    assert.throws(
      () =>
        mediaRange.parseMediaRangeHeader(
          "bytes=700000-300000",
          1_000_000,
        ),
      {
        name: "RangeError",
        message:
          "Media byte range end cannot be before start.",
      },
    );
  },
);

test(
  "HTTP byte range is unsatisfiable for an empty file",
  async () => {
    const mediaRange =
      await loadMediaRangeModule();

    assert.throws(
      () =>
        mediaRange.parseMediaRangeHeader(
          "bytes=0-10",
          0,
        ),
      {
        name: "RangeError",
        message:
          "Media byte range is unsatisfiable.",
      },
    );
  },
);

test(
  "multiple HTTP byte ranges are rejected",
  async () => {
    const mediaRange =
      await loadMediaRangeModule();

    assert.throws(
      () =>
        mediaRange.parseMediaRangeHeader(
          "bytes=0-10,20-30",
          1_000_000,
        ),
      {
        name: "RangeError",
        message:
          "Multiple media byte ranges are not supported.",
      },
    );
  },
);
