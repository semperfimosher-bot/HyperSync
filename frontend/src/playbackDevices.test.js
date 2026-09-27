import assert from "node:assert/strict";
import test from "node:test";

import {
  getPlaybackDeviceDescriptor,
  resolvePlaybackControlTarget,
} from "./playbackDevices.js";

import {
  applyPlaybackRemoteCommand,
} from "./playbackRemoteCommands.js";


test(
  "playback device descriptor identifies common browsers and platforms",
  () => {
    assert.deepEqual(
      getPlaybackDeviceDescriptor({
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/154.0.0.0 Safari/537.36",
        platform:
          "Win32",
      }),
      {
        name:
          "Chrome on Windows",
        deviceType:
          "desktop",
      },
    );

    assert.deepEqual(
      getPlaybackDeviceDescriptor({
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1",
        platform:
          "iPhone",
      }),
      {
        name:
          "Safari on iPhone",
        deviceType:
          "mobile",
      },
    );
  },
);


test(
  "remote commands call the matching player controls",
  async () => {
    const calls = [];

    const fakePlayer = {
      state: {
        paused:
          true,
      },

      getState() {
        return this.state;
      },

      async togglePlay() {
        calls.push(
          "play",
        );

        this.state = {
          ...this.state,
          paused:
            false,
        };
      },

      pausePlayback() {
        calls.push(
          "pause",
        );

        this.state = {
          ...this.state,
          paused:
            true,
        };
      },

      async skipToNext() {
        calls.push(
          "next",
        );
      },

      async skipToPrevious() {
        calls.push(
          "previous",
        );
      },

      seekTo(value) {
        calls.push([
          "seek",
          value,
        ]);
      },

      setVolume(value) {
        calls.push([
          "volume",
          value,
        ]);
      },

      async restoreAccountPlayback(
        track,
        position,
      ) {
        calls.push([
          "transfer",
          track.id,
          position,
        ]);

        this.state = {
          trackId:
            track.id,
          paused:
            true,
        };
      },
    };

    await applyPlaybackRemoteCommand(
      {
        action:
          "play",
      },
      {
        player:
          fakePlayer,
      },
    );

    await applyPlaybackRemoteCommand(
      {
        action:
          "seek",
        value:
          42,
      },
      {
        player:
          fakePlayer,
      },
    );

    await applyPlaybackRemoteCommand(
      {
        action:
          "volume",
        value:
          0.4,
      },
      {
        player:
          fakePlayer,
      },
    );

    await applyPlaybackRemoteCommand(
      {
        action:
          "next",
      },
      {
        player:
          fakePlayer,
      },
    );

    await applyPlaybackRemoteCommand(
      {
        action:
          "previous",
      },
      {
        player:
          fakePlayer,
      },
    );

    assert.deepEqual(
      calls,
      [
        "play",
        [
          "seek",
          42,
        ],
        [
          "volume",
          0.4,
        ],
        "next",
        "previous",
      ],
    );
  },
);


test(
  "transfer restores account playback and starts it when the snapshot is playing",
  async () => {
    const calls = [];

    const fakePlayer = {
      state: {
        paused:
          true,
      },

      getState() {
        return this.state;
      },

      async restoreAccountPlayback(
        track,
        position,
      ) {
        calls.push([
          "restore",
          track.id,
          position,
        ]);

        this.state = {
          trackId:
            track.id,
          paused:
            true,
        };
      },

      async togglePlay() {
        calls.push(
          "play",
        );

        this.state = {
          ...this.state,
          paused:
            false,
        };
      },

      pausePlayback() {
        calls.push(
          "pause",
        );
      },
    };

    await applyPlaybackRemoteCommand(
      {
        action:
          "transfer",
      },
      {
        player:
          fakePlayer,

        snapshot: {
          track: {
            id:
              "track-1",
          },
          position_seconds:
            30,
          paused:
            false,
        },

        snapshotPosition:
          (snapshot) =>
            snapshot.position_seconds,
      },
    );

    assert.deepEqual(
      calls,
      [
        [
          "restore",
          "track-1",
          30,
        ],
        "play",
      ],
    );
  },
);



test(
  "play-track remote command restores the authoritative snapshot and starts it",
  async () => {
    const calls = [];

    const fakePlayer = {
      state: {
        trackId:
          "old-track",
        paused:
          true,
      },

      getState() {
        return this.state;
      },

      async runWithLocalPlaybackControl(
        callback,
      ) {
        calls.push(
          "local-control",
        );

        return callback();
      },

      async restoreAccountPlayback(
        track,
        position,
      ) {
        calls.push([
          "restore",
          track.id,
          position,
        ]);

        this.state = {
          trackId:
            track.id,
          paused:
            true,
        };
      },

      async togglePlay() {
        calls.push(
          "play",
        );

        this.state = {
          ...this.state,
          paused:
            false,
        };
      },

      pausePlayback() {
        calls.push(
          "pause",
        );
      },

      stopTrack() {
        calls.push(
          "stop",
        );
      },
    };

    await applyPlaybackRemoteCommand(
      {
        action:
          "play_track",
      },
      {
        player:
          fakePlayer,

        snapshot: {
          track: {
            id:
              "new-track",
          },
          position_seconds:
            0,
          paused:
            false,
        },

        snapshotPosition:
          (snapshot) =>
            snapshot.position_seconds,
      },
    );

    assert.deepEqual(
      calls,
      [
        "local-control",
        [
          "restore",
          "new-track",
          0,
        ],
        "play",
      ],
    );
  },
);


test(
  "duplicate transfer command does not restart already matching playback",
  async () => {
    const calls = [];

    const fakePlayer = {
      state: {
        trackId:
          "track-1",
        paused:
          false,
      },

      getState() {
        return this.state;
      },

      async runWithLocalPlaybackControl(
        callback,
      ) {
        calls.push(
          "local-control",
        );

        return callback();
      },

      async restoreAccountPlayback() {
        calls.push(
          "restore",
        );
      },

      async togglePlay() {
        calls.push(
          "play",
        );
      },

      pausePlayback() {
        calls.push(
          "pause",
        );
      },
    };

    await applyPlaybackRemoteCommand(
      {
        action:
          "transfer",
      },
      {
        player:
          fakePlayer,

        snapshot: {
          track: {
            id:
              "track-1",
          },
          position_seconds:
            22,
          paused:
            false,
        },

        snapshotPosition:
          (snapshot) =>
            snapshot.position_seconds,
      },
    );

    assert.deepEqual(
      calls,
      [
        "local-control",
      ],
    );
  },
);


test(
  "remote stop command stays inside local-control bypass",
  async () => {
    const calls = [];

    const fakePlayer = {
      getState() {
        return {
          paused:
            true,
        };
      },

      async runWithLocalPlaybackControl(
        callback,
      ) {
        calls.push(
          "local-control",
        );

        return callback();
      },

      stopTrack() {
        calls.push(
          "stop",
        );
      },
    };

    await applyPlaybackRemoteCommand(
      {
        action:
          "stop",
      },
      {
        player:
          fakePlayer,
      },
    );

    assert.deepEqual(
      calls,
      [
        "local-control",
        "stop",
      ],
    );
  },
);



test(
  "remote play-track installs the controller queue before playing",
  async () => {
    const calls = [];

    const fakePlayer = {
      state: {
        trackId:
          "old-track",
        paused:
          true,
      },

      getState() {
        return this.state;
      },

      async runWithLocalPlaybackControl(
        callback,
      ) {
        calls.push(
          "local-control",
        );

        return callback();
      },

      async playTrackQueue(
        queue,
        index,
      ) {
        calls.push([
          "queue",
          queue.map(
            (track) =>
              track.id,
          ),
          index,
        ]);

        this.state = {
          trackId:
            queue[index].id,
          paused:
            false,
        };
      },

      async restoreAccountPlayback() {
        calls.push(
          "restore",
        );
      },

      async togglePlay() {
        calls.push(
          "play",
        );
      },

      pausePlayback() {
        calls.push(
          "pause",
        );
      },

      stopTrack() {
        calls.push(
          "stop",
        );
      },
    };

    await applyPlaybackRemoteCommand(
      {
        action:
          "play_track",
        queue_index:
          1,
        queue: [
          {
            id:
              "track-1",
            title:
              "First",
            artist:
              "Artist",
          },
          {
            id:
              "track-2",
            title:
              "Second",
            artist:
              "Artist",
          },
          {
            id:
              "track-3",
            title:
              "Third",
            artist:
              "Artist",
          },
        ],
      },
      {
        player:
          fakePlayer,

        snapshot: {
          track: {
            id:
              "track-2",
          },
          position_seconds:
            0,
          paused:
            false,
        },

        snapshotPosition:
          (snapshot) =>
            snapshot.position_seconds,
      },
    );

    assert.deepEqual(
      calls,
      [
        "local-control",
        [
          "queue",
          [
            "track-1",
            "track-2",
            "track-3",
          ],
          1,
        ],
      ],
    );

    assert.equal(
      fakePlayer.state.trackId,
      "track-2",
    );

    assert.equal(
      fakePlayer.state.paused,
      false,
    );
  },
);



test(
  "active playback owner becomes the control target on every device",
  () => {
    const devices = [
      {
        device_id: "desktop",
        is_online: true,
        is_active: false,
      },
      {
        device_id: "phone",
        is_online: true,
        is_active: true,
      },
    ];

    assert.equal(
      resolvePlaybackControlTarget({
        devices,
        currentDeviceId: "desktop",
        activeDeviceId: "phone",
        controlledDeviceId: "desktop",
      }),
      "phone",
    );

    assert.equal(
      resolvePlaybackControlTarget({
        devices,
        currentDeviceId: "phone",
        activeDeviceId: "phone",
        controlledDeviceId: "desktop",
      }),
      "phone",
    );
  },
);


test(
  "control target flips symmetrically when playback moves back",
  () => {
    const devices = [
      {
        device_id: "desktop",
        is_online: true,
        is_active: true,
      },
      {
        device_id: "phone",
        is_online: true,
        is_active: false,
      },
    ];

    assert.equal(
      resolvePlaybackControlTarget({
        devices,
        currentDeviceId: "desktop",
        activeDeviceId: "desktop",
        controlledDeviceId: "phone",
      }),
      "desktop",
    );

    assert.equal(
      resolvePlaybackControlTarget({
        devices,
        currentDeviceId: "phone",
        activeDeviceId: "desktop",
        controlledDeviceId: "phone",
      }),
      "desktop",
    );
  },
);


test(
  "offline former player cannot remain the control target",
  () => {
    const devices = [
      {
        device_id: "desktop",
        is_online: true,
        is_active: false,
      },
      {
        device_id: "phone",
        is_online: false,
        is_active: true,
      },
    ];

    assert.equal(
      resolvePlaybackControlTarget({
        devices,
        currentDeviceId: "desktop",
        activeDeviceId: "phone",
        controlledDeviceId: "phone",
      }),
      "desktop",
    );
  },
);
