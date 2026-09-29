export function expectedJamPosition(snapshot, nowMs = Date.now()) {
  if (!snapshot?.current_track_id) return 0;
  const serverMs = Number(snapshot.received_at_ms) || Date.parse(snapshot.server_time);
  const elapsed = snapshot.paused || !Number.isFinite(serverMs)
    ? 0 : Math.max(0, (nowMs - serverMs) / 1000);
  const duration = Number(snapshot.current_track?.duration_seconds) || 86400;
  return Math.min(duration, Math.max(0, Number(snapshot.position_seconds || 0) + elapsed));
}

export function jamPlaybackStillWanted(snapshot, { userId, activeUserId, jamId, itemId, optIn }) {
  return Boolean(optIn && userId === activeUserId && snapshot?.id === jamId
    && snapshot.current_item_id === itemId);
}

export function shouldAdvanceJamOnEnded(snapshot, {
  userId, trackId, managedTrackId, managedItemId, optIn,
}) {
  return Boolean(optIn && !snapshot?.paused && snapshot?.current_track_id === trackId
    && managedTrackId === trackId && managedItemId === snapshot.current_item_id
    && (snapshot.host_id === userId
      || (snapshot.mode === "everyone" && snapshot.allow_guest_control)));
}

export function jamPlaybackAction(snapshot, { userId, optIn, managedTrackId, managedItemId, local, nowMs }) {
  const ownsLocalTrack = Boolean(managedTrackId && local?.trackId === managedTrackId);
  if (!snapshot) return ownsLocalTrack && !local.paused ? { type: "pause" } : null;
  const listenHere = snapshot.mode === "everyone" || snapshot.host_id === userId;
  if (!optIn || !listenHere || snapshot.ended || !snapshot.current_track_id) {
    return ownsLocalTrack && !local.paused ? { type: "pause" } : null;
  }
  if (local?.trackId !== snapshot.current_track_id || managedTrackId !== snapshot.current_track_id
    || (managedItemId && managedItemId !== snapshot.current_item_id)) {
    return snapshot.paused ? null : { type: "play", track: snapshot.current_track,
      position: expectedJamPosition(snapshot, nowMs) };
  }
  if (snapshot.paused) return local?.paused ? null : { type: "pause" };
  if (local?.paused) return { type: "resume", position: expectedJamPosition(snapshot, nowMs) };
  const position = expectedJamPosition(snapshot, nowMs);
  return Math.abs(position - Number(local?.currentTime || 0)) > 1.5
    ? { type: "seek", position } : null;
}
