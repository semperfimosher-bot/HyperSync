import test from "node:test";
import assert from "node:assert/strict";

import {
  getHomeRecentlyPlayed,
  notifyListeningHistoryChanged,
  subscribeListeningHistoryChanged,
  canRecordListeningHistory,
} from "./homeRecentlyPlayed.js";

test("remembered sessions record history while their access token is refreshing", () => {
  assert.equal(canRecordListeningHistory(null, true), true);
  assert.equal(canRecordListeningHistory("token", false), true);
  assert.equal(canRecordListeningHistory(null, false), false);
});


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
  "limits home recently played to twelve tracks",
  () => {
    const profile = {
      recently_played: Array.from(
        { length: 40 },
        (_, index) => ({
          id: String(index + 1),
        }),
      ),
    };

    assert.equal(
      getHomeRecentlyPlayed(
        profile,
      ).length,
      12,
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


test(
  "notifies active Home listeners when listening history changes",
  () => {
    const target =
      new EventTarget();

    let calls = 0;

    const unsubscribe =
      subscribeListeningHistoryChanged(
        () => {
          calls += 1;
        },
        target,
      );

    assert.equal(
      notifyListeningHistoryChanged(
        target,
      ),
      true,
    );

    assert.equal(
      calls,
      1,
    );

    unsubscribe();

    notifyListeningHistoryChanged(
      target,
    );

    assert.equal(
      calls,
      1,
    );
  },
);

 test("older history responses cannot overwrite newer playback or another account", async () => {
  const { isCurrentHistoryResponse } = await import("./homeRecentlyPlayed.js");
  assert.equal(isCurrentHistoryResponse(1, 2, "alice", "alice"), false);
  assert.equal(isCurrentHistoryResponse(2, 2, "alice", "bob"), false);
  assert.equal(isCurrentHistoryResponse(2, 2, "alice", "alice"), true);
});
