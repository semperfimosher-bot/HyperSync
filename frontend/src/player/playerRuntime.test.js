import assert from "node:assert/strict";

import {
  beforeEach,
  test,
} from "node:test";

import {
  _resetPlaybackSessionsForTests,
  beginPlaybackSession,
  cancelActivePlaybackSession,
  getActivePlaybackSession,
  isPlaybackSessionCurrent,
} from "./playbackSession.js";


beforeEach(() => {
  _resetPlaybackSessionsForTests();
});


test(
  "new playback supersedes the previous playback session",
  () => {
    const first =
      beginPlaybackSession(
        "track-a",
      );

    assert.equal(
      isPlaybackSessionCurrent(
        first,
      ),
      true,
    );


    const second =
      beginPlaybackSession(
        "track-b",
      );


    assert.equal(
      first.signal.aborted,
      true,
    );

    assert.equal(
      isPlaybackSessionCurrent(
        first,
      ),
      false,
    );

    assert.equal(
      second.signal.aborted,
      false,
    );

    assert.equal(
      isPlaybackSessionCurrent(
        second,
      ),
      true,
    );


    assert.equal(
      getActivePlaybackSession(),
      second,
    );
  },
);


test(
  "cancelling playback removes ownership from the active session",
  () => {
    const session =
      beginPlaybackSession(
        "track-a",
      );


    const cancelled =
      cancelActivePlaybackSession();


    assert.equal(
      cancelled,
      true,
    );

    assert.equal(
      session.signal.aborted,
      true,
    );

    assert.equal(
      isPlaybackSessionCurrent(
        session,
      ),
      false,
    );

    assert.equal(
      getActivePlaybackSession(),
      null,
    );
  },
);


test(
  "cancelling with no active playback is harmless",
  () => {
    assert.equal(
      cancelActivePlaybackSession(),
      false,
    );

    assert.equal(
      getActivePlaybackSession(),
      null,
    );
  },
);
