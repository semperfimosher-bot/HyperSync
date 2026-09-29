import assert from "node:assert/strict";
import test from "node:test";

import { expectedJamPosition, jamPlaybackAction, jamPlaybackStillWanted,
  shouldAdvanceJamOnEnded } from "./jamSync.js";

const snapshot = {
  host_id: "host",
  mode: "everyone",
  paused: false,
  current_track_id: "track-a",
  current_track: { id: "track-a", duration_seconds: 100 },
  position_seconds: 12,
  server_time: "2026-09-29T00:00:00Z",
};

test("remote position uses server time and caps at duration", () => {
  assert.equal(expectedJamPosition(snapshot, Date.parse(snapshot.server_time) + 2000), 14);
  assert.equal(expectedJamPosition(snapshot, Date.parse(snapshot.server_time) + 200_000), 100);
});

test("device clock skew cannot jump remote playback to the end", () => {
  const received = 1000;
  assert.equal(expectedJamPosition({ ...snapshot, received_at_ms: received }, received + 2000), 14);
});

test("remote audio requires explicit opt in and host mode silences guest Jam audio", () => {
  assert.equal(jamPlaybackAction(snapshot, { userId: "guest", optIn: false,
    managedTrackId: null, local: { trackId: null }, nowMs: Date.parse(snapshot.server_time) }), null);
  assert.equal(jamPlaybackAction({ ...snapshot, mode: "host" }, { userId: "guest", optIn: true,
    managedTrackId: "track-a", local: { trackId: "track-a", paused: false },
    nowMs: Date.parse(snapshot.server_time) }).type, "pause");
  assert.equal(jamPlaybackAction({ ...snapshot, mode: "host" }, { userId: "guest", optIn: true,
    managedTrackId: "track-a", local: { trackId: "solo-b", paused: false },
    nowMs: Date.parse(snapshot.server_time) }), null);
});

test("a second queue item for the same track starts at its own position", () => {
  const nowMs = Date.parse(snapshot.server_time);
  const second = { ...snapshot, current_item_id: "second", position_seconds: 0 };
  assert.equal(jamPlaybackAction(second, { userId: "host", optIn: true,
    managedTrackId: "track-a", managedItemId: "first",
    local: { trackId: "track-a", currentTime: 90, paused: false }, nowMs }).type, "play");
});

test("a delayed play is discarded after opt-out, removal, or account change", () => {
  const state = { id: "jam", current_item_id: "item" };
  const target = { userId: "owner", activeUserId: "owner", jamId: "jam",
    itemId: "item", optIn: true };
  assert.equal(jamPlaybackStillWanted(state, target), true);
  assert.equal(jamPlaybackStillWanted(state, { ...target, optIn: false }), false);
  assert.equal(jamPlaybackStillWanted(null, target), false);
  assert.equal(jamPlaybackStillWanted(state, { ...target, activeUserId: "other" }), false);
  assert.equal(jamPlaybackStillWanted({ ...state, current_item_id: "next" }, target), false);
});

test("natural end advances only the owned queue item with playback permission", () => {
  const current = { ...snapshot, current_item_id: "second", allow_guest_control: false };
  assert.equal(shouldAdvanceJamOnEnded(current, { userId: "host", trackId: "track-a",
    managedTrackId: "track-a", managedItemId: "second", optIn: true }), true);
  assert.equal(shouldAdvanceJamOnEnded(current, { userId: "guest", trackId: "track-a",
    managedTrackId: "track-a", managedItemId: "second", optIn: true }), false);
  assert.equal(shouldAdvanceJamOnEnded({ ...current, allow_guest_control: true }, {
    userId: "guest", trackId: "track-a", managedTrackId: "track-a",
    managedItemId: "second", optIn: true }), true);
  assert.equal(shouldAdvanceJamOnEnded({ ...current, allow_guest_control: true, mode: "host" }, {
    userId: "guest", trackId: "track-a", managedTrackId: "track-a",
    managedItemId: "second", optIn: true }), false);
  assert.equal(shouldAdvanceJamOnEnded({ ...current, allow_guest_control: true, paused: true }, {
    userId: "guest", trackId: "track-a", managedTrackId: "track-a",
    managedItemId: "second", optIn: true }), false);
  assert.equal(shouldAdvanceJamOnEnded(current, { userId: "host", trackId: "track-a",
    managedTrackId: "track-a", managedItemId: "first", optIn: true }), false);
});

test("reconnect changes track and only seeks when drift exceeds threshold", () => {
  const nowMs = Date.parse(snapshot.server_time);
  assert.equal(jamPlaybackAction(snapshot, { userId: "guest", optIn: true,
    managedTrackId: null, local: { trackId: null }, nowMs }).type, "play");
  assert.equal(jamPlaybackAction(snapshot, { userId: "guest", optIn: true,
    managedTrackId: "track-a", local: { trackId: "track-a", currentTime: 11.1, paused: false },
    nowMs }), null);
  assert.equal(jamPlaybackAction(snapshot, { userId: "guest", optIn: true,
    managedTrackId: "track-a", local: { trackId: "track-a", currentTime: 9, paused: false },
    nowMs }).type, "seek");
});
