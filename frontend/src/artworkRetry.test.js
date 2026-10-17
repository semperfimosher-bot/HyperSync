import assert from "node:assert/strict";
import test from "node:test";

import {
  resetArtworkRetry,
  retryTransientArtwork,
} from "./artworkRetry.js";


test(
  "retries local API artwork failures with bounded backoff",
  () => {
    const scheduled = [];
    const previousWindow = globalThis.window;
    globalThis.window = {
      setTimeout(callback, delay) {
        scheduled.push({ callback, delay });
        return scheduled.length;
      },
    };

    try {
      const image = {
        dataset: {},
        src: "https://api.example.test/api/catalog/tracks/track-1/artwork",
        currentSrc: "https://api.example.test/api/catalog/tracks/track-1/artwork",
        isConnected: true,
      };

      for (let attempt = 0; attempt < 3; attempt += 1) {
        assert.equal(
          retryTransientArtwork(
            { currentTarget: image },
            image.src,
          ),
          true,
        );
      }

      assert.equal(
        retryTransientArtwork(
          { currentTarget: image },
          image.src,
        ),
        false,
      );
      assert.equal(scheduled.length, 3);
      assert.ok(scheduled.every(({ delay }) => delay >= 750 && delay < 5_000));

      scheduled[0].callback();
      assert.equal(image.src, image.dataset.artworkRetrySource);

      resetArtworkRetry(image);
      assert.equal(image.dataset.artworkRetryCount, undefined);
      assert.equal(image.dataset.artworkRetrySource, undefined);
    } finally {
      if (previousWindow === undefined) {
        delete globalThis.window;
      } else {
        globalThis.window = previousWindow;
      }
    }
  },
);


test(
  "does not retry external or presigned artwork URLs",
  () => {
    const image = {
      dataset: {},
      src: "https://f005.backblazeb2.com/file/hypersync-media/artwork.jpg",
      currentSrc: "https://f005.backblazeb2.com/file/hypersync-media/artwork.jpg",
      isConnected: true,
    };

    assert.equal(
      retryTransientArtwork(
        { currentTarget: image },
        image.src,
      ),
      false,
    );
  },
);



test(
  "does not let a pending retry overwrite artwork after the track changes",
  () => {
    const scheduled = [];
    const previousWindow = globalThis.window;
    globalThis.window = {
      setTimeout(callback, delay) {
        scheduled.push({ callback, delay });
        return scheduled.length;
      },
    };

    try {
      const originalSource =
        "https://api.example.test/api/catalog/tracks/track-old/artwork";
      const nextSource =
        "https://api.example.test/api/catalog/tracks/track-new/artwork";

      const image = {
        dataset: {},
        src: originalSource,
        currentSrc: originalSource,
        isConnected: true,
        getAttribute(name) {
          return name === "src" ? this.src : null;
        },
      };

      assert.equal(
        retryTransientArtwork({ currentTarget: image }, originalSource),
        true,
      );

      // React reuses the <img> for a different track before the first timer fires.
      image.src = nextSource;
      image.currentSrc = nextSource;

      assert.equal(
        retryTransientArtwork({ currentTarget: image }, nextSource),
        true,
      );
      assert.equal(image.dataset.artworkRetryCount, "1");
      assert.equal(image.dataset.artworkRetrySource, nextSource);

      scheduled[0].callback();
      assert.equal(image.src, nextSource);

      scheduled[1].callback();
      assert.equal(image.src, nextSource);
    } finally {
      if (previousWindow === undefined) {
        delete globalThis.window;
      } else {
        globalThis.window = previousWindow;
      }
    }
  },
);



test(
  "restores a previously hidden image and hides its fallback after success",
  () => {
    const image = {
      dataset: {
        artworkRetryCount: "3",
        artworkRetrySource: "https://api.example.test/api/catalog/tracks/track-1/artwork",
      },
      style: { display: "none" },
      nextElementSibling: { style: { display: "grid" } },
    };

    resetArtworkRetry(image);

    assert.equal(image.dataset.artworkRetryCount, undefined);
    assert.equal(image.dataset.artworkRetrySource, undefined);
    assert.equal(image.style.display, "");
    assert.equal(image.nextElementSibling.style.display, "none");
  },
);
