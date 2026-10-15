import assert from "node:assert/strict";
import test from "node:test";

import {
  searchFilterCount,
  totalSearchResultCount,
} from "./searchCounts.js";


test(
  "totalSearchResultCount adds each supported search category",
  () => {
    assert.equal(
      totalSearchResultCount({
        tracks: 4,
        artists: 2,
        collaborations: 3,
        albums: 5,
        people: 1,
        playlists: 6,
      }),
      21,
    );
  },
);


test(
  "searchFilterCount returns the total for all and a category count otherwise",
  () => {
    const counts = {
      tracks: 4,
      artists: 2,
      collaborations: 3,
      albums: 5,
      people: 1,
      playlists: 6,
    };

    assert.equal(searchFilterCount("all", counts), 21);
    assert.equal(searchFilterCount("tracks", counts), 4);
    assert.equal(searchFilterCount("artists", counts), 2);
    assert.equal(searchFilterCount("missing", counts), 0);
  },
);


test(
  "search result counts tolerate missing or null count data",
  () => {
    assert.equal(totalSearchResultCount(undefined), 0);
    assert.equal(totalSearchResultCount(null), 0);
    assert.equal(searchFilterCount("tracks", undefined), 0);
    assert.equal(searchFilterCount("all", { tracks: "3", albums: 2 }), 5);
  },
);
