import assert from "node:assert/strict";
import test from "node:test";

import {
  getLibraryRenderItems,
  getNextLibraryRenderCount,
  LIBRARY_RENDER_BATCH_SIZE,
} from "./libraryRenderWindow.js";


test(
  "large Library lists render a bounded first batch without changing order",
  () => {
    const items = Array.from(
      { length: 100_000 },
      (_, index) => ({
        id: "track-" + index,
      }),
    );

    const firstPage =
      getLibraryRenderItems(items);

    assert.equal(
      LIBRARY_RENDER_BATCH_SIZE,
      100,
    );
    assert.equal(firstPage.length, 100);
    assert.equal(firstPage[0].id, "track-0");
    assert.equal(firstPage[99].id, "track-99");

    const secondCount =
      getNextLibraryRenderCount(
        firstPage.length,
        items.length,
      );

    const secondPage =
      getLibraryRenderItems(
        items,
        secondCount,
      );

    assert.equal(secondPage.length, 200);
    assert.equal(secondPage[199].id, "track-199");
  },
);


test(
  "Library render batching safely handles invalid counts and final partial pages",
  () => {
    const items = ["a", "b", "c", "d", "e"];

    assert.deepEqual(
      getLibraryRenderItems(items, -10),
      [],
    );

    assert.deepEqual(
      getLibraryRenderItems(items, Number.NaN),
      items,
    );

    assert.equal(
      getNextLibraryRenderCount(90, 95, 100),
      95,
    );

    assert.equal(
      getNextLibraryRenderCount(200, 95),
      95,
    );

    assert.equal(
      getNextLibraryRenderCount(-20, 95),
      95,
    );
  },
);
