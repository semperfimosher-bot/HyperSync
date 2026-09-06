import assert from "node:assert/strict";
import test from "node:test";

import * as constants
  from "./constants.js";


test(
  "search exposes six functional quick commands",
  () => {
    assert.deepEqual(
      constants.SEARCH_QUICK_COMMANDS,
      [
        {
          id: "most-played",
          label: "Most Played",
          query: "my most played",
          filter: "tracks",
          focus: false,
        },
        {
          id: "recently-played",
          label: "Recently Played",
          query: "recent songs",
          filter: "tracks",
          focus: false,
        },
        {
          id: "top-artists",
          label: "Top Artists",
          query: "top artists",
          filter: "artists",
          focus: false,
        },
        {
          id: "top-albums",
          label: "Top Albums",
          query: "top albums",
          filter: "albums",
          focus: false,
        },
        {
          id: "find-people",
          label: "Find People",
          query: "",
          filter: "people",
          focus: true,
        },
        {
          id: "new-releases",
          label: "New Releases",
          query: "new releases",
          filter: "tracks",
          focus: false,
        },
      ],
    );
  },
);
