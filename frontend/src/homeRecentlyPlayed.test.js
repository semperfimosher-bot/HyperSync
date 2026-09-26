import test from "node:test";
import assert from "node:assert/strict";

import {
  getHomeRecentlyPlayed,
} from "./homeRecentlyPlayed.js";


test(
  "returns recently played tracks in backend order",
  () => {
    const profile = {
      recently_played: [
        { id: "3", title: "Third" },
        { id: "2", title: "Second" },
        { id: "1", title: "First" },
      ],
    };

    assert.deepEqual(
      getHomeRecentlyPlayed(profile),
      profile.recently_played,
    );
  },
);


test(
  "returns the complete recently played history without a limit",
  () => {
    const profile = {
      recently_played: Array.from(
        { length: 40 },
        (_, index) => ({
          id: String(index + 1),
        }),
      ),
    };

    assert.deepEqual(
      getHomeRecentlyPlayed(
        profile,
      ),
      profile.recently_played,
    );
  },
);


test(
  "returns an empty list when there is no history",
  () => {
    assert.deepEqual(
      getHomeRecentlyPlayed(null),
      [],
    );

    assert.deepEqual(
      getHomeRecentlyPlayed({}),
      [],
    );
  },
);
